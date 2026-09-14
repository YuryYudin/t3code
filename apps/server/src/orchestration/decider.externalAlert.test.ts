import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-09-14T10:00:00.000Z";
const projectId = ProjectId.make("fork-maintenance");
const threadId = ThreadId.make("fork-maintenance-42");

const makeReadModel = (withDefaultModel = true): OrchestrationReadModel => ({
  snapshotSequence: 0,
  projects: [
    {
      id: projectId,
      title: "T3 Fork Maintenance",
      workspaceRoot: "/srv/t3code-fork-maintenance",
      defaultModelSelection: withDefaultModel
        ? { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" }
        : null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
  ],
  threads: [],
  updatedAt: NOW,
});

const command = (overrides: Partial<OrchestrationCommand> = {}) =>
  ({
    type: "thread.external-alert.upsert",
    commandId: CommandId.make("jenkins:issue:42:failure:build:123"),
    projectId,
    threadId,
    incidentKey:
      "jenkins:YuryYudin/t3code:t3code/main:automatic-stable-release:stable:0.0.40:validation",
    title: "Fork maintenance failed",
    state: "failing",
    summary: "Stable validation failed",
    detail: "See Jenkins for sanitized details.",
    url: "http://kubuntu:8080/job/t3code/job/main/123/",
    createdAt: NOW,
    ...overrides,
  }) as Extract<OrchestrationCommand, { type: "thread.external-alert.upsert" }>;

it.layer(NodeServices.layer)("external alert decider", (it) => {
  it.effect("atomically creates one passive thread and incident activity", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: command(),
        readModel: makeReadModel(),
      });
      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "thread.created",
        "thread.activity-appended",
      ]);
      const created = events[0];
      if (created?.type !== "thread.created") throw new Error("Expected thread.created");
      expect(created.payload).toMatchObject({
        projectId,
        threadId,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      const activity = events[1];
      if (activity?.type !== "thread.activity-appended") {
        throw new Error("Expected thread.activity-appended");
      }
      expect(activity.payload.activity).toMatchObject({
        tone: "error",
        kind: "ci.incident",
        turnId: null,
        payload: {
          incidentKey: command().incidentKey,
          state: "failing",
        },
      });
    }),
  );

  it.effect("appends recovery to the same incident without starting a turn", () =>
    Effect.gen(function* () {
      const initial = yield* decideOrchestrationCommand({
        command: command(),
        readModel: makeReadModel(),
      });
      const initialEvents = Array.isArray(initial) ? initial : [initial];
      let readModel = makeReadModel();
      for (const [index, event] of initialEvents.entries()) {
        readModel = yield* projectEvent(readModel, { ...event, sequence: index + 1 });
      }

      const recovered = yield* decideOrchestrationCommand({
        command: command({
          commandId: CommandId.make("jenkins:issue:42:recovered:stable:0.0.41:validation"),
          state: "recovered",
          summary: "Stable validation recovered",
        }),
        readModel,
      });
      const events = Array.isArray(recovered) ? recovered : [recovered];

      expect(events.map((event) => event.type)).toEqual(["thread.activity-appended"]);
      const activity = events[0];
      if (activity?.type !== "thread.activity-appended") {
        throw new Error("Expected thread.activity-appended");
      }
      expect(activity.payload.activity.tone).toBe("info");
      expect(activity.payload.activity.payload).toMatchObject({ state: "recovered" });
    }),
  );

  it.effect("adopts an empty passive incident thread created by a v0.0.40 server", () =>
    Effect.gen(function* () {
      const legacyThreadId = ThreadId.make("t3-fork-incident-42");
      const readModel = makeReadModel();
      const created = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("jenkins:issue:42:legacy-create"),
          threadId: legacyThreadId,
          projectId,
          title: "Fork maintenance failed (#42)",
          modelSelection: readModel.projects[0]!.defaultModelSelection!,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: NOW,
        },
        readModel,
      });
      const createdEvent = Array.isArray(created) ? created[0] : created;
      if (createdEvent?.type !== "thread.created") {
        throw new Error("Expected one thread.created event");
      }
      const withLegacyThread = yield* projectEvent(readModel, {
        ...createdEvent,
        sequence: 1,
      });

      const recovered = yield* decideOrchestrationCommand({
        command: command({
          commandId: CommandId.make("jenkins:issue:42:recovered:stable:0.0.41:validation"),
          threadId: legacyThreadId,
          state: "recovered",
          summary: "Stable validation recovered",
        }),
        readModel: withLegacyThread,
      });
      const events = Array.isArray(recovered) ? recovered : [recovered];

      expect(events.map((event) => event.type)).toEqual(["thread.activity-appended"]);
      const activity = events[0];
      if (activity?.type !== "thread.activity-appended") {
        throw new Error("Expected thread.activity-appended");
      }
      expect(activity.payload.activity.payload).toMatchObject({ state: "recovered" });
    }),
  );

  it.effect("rejects recovery before the incident thread exists", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: command({ state: "recovered" }),
        readModel: makeReadModel(),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("requires a project default model for first creation", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: command(),
        readModel: makeReadModel(false),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );

  it.effect("rejects reusing a thread for a different incident", () =>
    Effect.gen(function* () {
      const initial = yield* decideOrchestrationCommand({
        command: command(),
        readModel: makeReadModel(),
      });
      const initialEvents = Array.isArray(initial) ? initial : [initial];
      let readModel = makeReadModel();
      for (const [index, event] of initialEvents.entries()) {
        readModel = yield* projectEvent(readModel, { ...event, sequence: index + 1 });
      }

      const error = yield* decideOrchestrationCommand({
        command: command({ incidentKey: "different-incident" }),
        readModel,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
