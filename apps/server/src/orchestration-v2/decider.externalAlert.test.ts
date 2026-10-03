import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  type ThreadExternalAlertUpsertCommand,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { planExternalAlertCommand } from "./ExternalAlert.ts";

const NOW = "2026-09-14T10:00:00.000Z";
const projectId = ProjectId.make("fork-maintenance");
const threadId = ThreadId.make("t3-fork-incident-42");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
};

const command = (
  overrides: Partial<ThreadExternalAlertUpsertCommand> = {},
): ThreadExternalAlertUpsertCommand => ({
  type: "thread.external-alert.upsert",
  commandId: CommandId.make("jenkins:issue:42:failure:build:123"),
  projectId,
  threadId,
  incidentKey: "jenkins:YuryYudin/t3code:stable:workflow",
  title: "Fork maintenance failed",
  state: "failing",
  summary: "Stable validation failed",
  detail: "See Jenkins for sanitized details.",
  url: "http://kubuntu:8080/job/t3code/job/main/123/",
  createdAt: NOW,
  ...overrides,
});

const thread = (overrides: Partial<OrchestrationV2AppThread> = {}): OrchestrationV2AppThread => ({
  createdBy: "system",
  creationSource: "server",
  id: threadId,
  projectId,
  title: "Fork maintenance failed",
  providerInstanceId: modelSelection.instanceId,
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  createdAt: DateTime.makeUnsafe(NOW),
  updatedAt: DateTime.makeUnsafe(NOW),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  lastVisitedAt: null,
  deletedAt: null,
  ...overrides,
});

const incidentItem = (incidentKey = command().incidentKey): OrchestrationV2TurnItem => ({
  id: TurnItemId.make("turn-item:external-alert:first"),
  threadId,
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed",
  title: command().title,
  startedAt: DateTime.makeUnsafe(NOW),
  completedAt: DateTime.makeUnsafe(NOW),
  updatedAt: DateTime.makeUnsafe(NOW),
  type: "notification",
  source: { kind: "monitor" },
  outcome: "failed",
  summary: command().summary,
  externalAlert: { incidentKey, state: "failing", url: command().url },
});

it.effect("creates a passive incident thread with the project's default model", () =>
  Effect.gen(function* () {
    const plan = yield* planExternalAlertCommand({
      command: command(),
      project: { defaultModelSelection: modelSelection },
      thread: null,
      turnItems: [],
    });
    expect(plan).toEqual({ createThread: true, modelSelection, ordinal: 1 });
  }),
);

it.effect("appends recovery to the same incident without creating another thread", () =>
  Effect.gen(function* () {
    const plan = yield* planExternalAlertCommand({
      command: command({ state: "recovered" }),
      project: { defaultModelSelection: modelSelection },
      thread: thread(),
      turnItems: [incidentItem()],
    });
    expect(plan).toEqual({ createThread: false, modelSelection, ordinal: 2 });
  }),
);

it.effect("adopts an empty passive incident thread created by a legacy server", () =>
  Effect.gen(function* () {
    const plan = yield* planExternalAlertCommand({
      command: command({ state: "recovered" }),
      project: { defaultModelSelection: modelSelection },
      thread: thread(),
      turnItems: [],
    });
    expect(plan.createThread).toBe(false);
  }),
);

it.effect.each([
  ["recovery before creation", command({ state: "recovered" }), null, [], modelSelection],
  ["missing default model", command(), null, [], null],
  [
    "different incident",
    command({ incidentKey: "different-incident" }),
    thread(),
    [incidentItem()],
    modelSelection,
  ],
] as const)("rejects %s", (_label, alert, existingThread, turnItems, defaultModelSelection) =>
  planExternalAlertCommand({
    command: alert,
    project: { defaultModelSelection },
    thread: existingThread,
    turnItems,
  }).pipe(
    Effect.flip,
    Effect.tap((error) =>
      Effect.sync(() => expect(error._tag).toBe("ExternalAlertInvariantError")),
    ),
  ),
);
