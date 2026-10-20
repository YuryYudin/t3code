import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  type ModelSelection,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ThreadExternalAlertUpsertCommand,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const NOW = "2026-09-14T10:00:00.000Z";
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
} satisfies ModelSelection;
const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("external alerts never start a provider session"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectStore.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "external-alert" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const seedProject = (name: string, defaultModelSelection: ModelSelection | null) => {
  const projectId = ProjectId.make(`project:external-alert:${name}`);
  return Effect.gen(function* () {
    const projects = yield* ProjectStore.ProjectStoreV2;
    yield* projects.apply({
      sequence: 0,
      eventId: EventId.make(`event:external-alert:${name}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: NOW,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: "T3 Fork Maintenance",
        workspaceRoot: `/srv/t3code-fork-maintenance/${name}`,
        defaultModelSelection,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    return projectId;
  });
};

const command = (
  name: string,
  projectId: ProjectId,
  overrides: Partial<ThreadExternalAlertUpsertCommand> = {},
): ThreadExternalAlertUpsertCommand => ({
  type: "thread.external-alert.upsert",
  commandId: CommandId.make(`jenkins:${name}:failure:123`),
  projectId,
  threadId: ThreadId.make(`thread:external-alert:${name}`),
  incidentKey: `jenkins:YuryYudin/t3code:${name}`,
  title: "Fork maintenance failed",
  state: "failing",
  summary: "Stable validation failed",
  detail: "See Jenkins for sanitized details.",
  url: "http://kubuntu:8080/job/t3code/job/main/123/",
  createdAt: NOW,
  ...overrides,
});

it.layer(layerTest)("external alert orchestration", (it) => {
  it.effect("atomically creates one passive thread and incident notification", () =>
    Effect.gen(function* () {
      const projectId = yield* seedProject("create", modelSelection);
      const alert = command("create", projectId);
      const orchestrator = yield* Orchestrator.OrchestratorV2;

      const result = yield* orchestrator.dispatch(alert);
      assert.deepEqual(
        result.storedEvents.map(({ event }) => event.type),
        ["thread.created", "turn-item.updated"],
      );
      const projection = yield* orchestrator.getThreadRecords(alert.threadId, [
        "runs",
        "messages",
        "turnItems",
      ]);
      assert.lengthOf(projection.runs, 0);
      assert.lengthOf(projection.messages, 0);
      assert.lengthOf(projection.turnItems, 1);
      const item = projection.turnItems[0];
      assert.equal(item?.type, "notification");
      if (item?.type !== "notification") return;
      assert.deepEqual(item.externalAlert, {
        incidentKey: alert.incidentKey,
        state: "failing",
        url: alert.url,
      });
      assert.equal(item.outcome, "failed");
    }),
  );

  it.effect("appends recovery to the same incident without starting a turn", () =>
    Effect.gen(function* () {
      const projectId = yield* seedProject("recover", modelSelection);
      const failing = command("recover", projectId);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      yield* orchestrator.dispatch(failing);

      const recovered = command("recover", projectId, {
        commandId: CommandId.make("jenkins:recover:recovered:124"),
        state: "recovered",
        summary: "Stable validation recovered",
      });
      const result = yield* orchestrator.dispatch(recovered);
      assert.deepEqual(
        result.storedEvents.map(({ event }) => event.type),
        ["turn-item.updated"],
      );
      const projection = yield* orchestrator.getThreadRecords(failing.threadId, [
        "runs",
        "messages",
        "turnItems",
      ]);
      assert.lengthOf(projection.runs, 0);
      assert.lengthOf(projection.messages, 0);
      assert.deepEqual(
        projection.turnItems.map((item) =>
          item.type === "notification" ? item.externalAlert?.state : undefined,
        ),
        ["failing", "recovered"],
      );
    }),
  );

  it.effect("adopts a legacy passive incident thread for recovery", () =>
    Effect.gen(function* () {
      const projectId = yield* seedProject("legacy", modelSelection);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("t3-fork-incident-legacy");
      yield* orchestrator.dispatch({
        type: "thread.create",
        commandId: CommandId.make("jenkins:legacy:create"),
        threadId,
        projectId,
        title: "Legacy incident",
        createdBy: "system",
        creationSource: "server",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      });
      const result = yield* orchestrator.dispatch(
        command("legacy", projectId, { threadId, state: "recovered" }),
      );
      assert.deepEqual(
        result.storedEvents.map(({ event }) => event.type),
        ["turn-item.updated"],
      );
      const projection = yield* orchestrator.getThreadRecords(threadId, [
        "runs",
        "messages",
        "turnItems",
      ]);
      assert.lengthOf(projection.runs, 0);
      assert.lengthOf(projection.messages, 0);
      assert.lengthOf(projection.turnItems, 1);
      const item = projection.turnItems[0];
      assert.equal(item?.type, "notification");
      if (item?.type === "notification") assert.equal(item.externalAlert?.state, "recovered");
    }),
  );

  it.effect("rejects recovery before the incident thread exists", () =>
    Effect.gen(function* () {
      const projectId = yield* seedProject("missing", modelSelection);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const error = yield* orchestrator
        .dispatch(command("missing", projectId, { state: "recovered" }))
        .pipe(Effect.flip);

      assert.equal(error._tag, "OrchestratorDispatchError");
    }),
  );

  it.effect("requires a project default model for first creation", () =>
    Effect.gen(function* () {
      const projectId = yield* seedProject("modeless", null);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const error = yield* orchestrator.dispatch(command("modeless", projectId)).pipe(Effect.flip);

      assert.equal(error._tag, "OrchestratorDispatchError");
    }),
  );

  it.effect("rejects reusing a thread for a different incident", () =>
    Effect.gen(function* () {
      const projectId = yield* seedProject("ownership", modelSelection);
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const first = command("ownership", projectId);
      yield* orchestrator.dispatch(first);
      const ownershipError = yield* orchestrator
        .dispatch(
          command("ownership", projectId, {
            commandId: CommandId.make("jenkins:ownership:different"),
            incidentKey: "different-incident",
          }),
        )
        .pipe(Effect.flip);
      assert.equal(ownershipError._tag, "OrchestratorDispatchError");
    }),
  );
});
