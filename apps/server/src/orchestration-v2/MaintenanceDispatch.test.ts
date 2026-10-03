import { expect, it } from "@effect/vitest";
import {
  CommandId,
  MaintenanceCommand,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import { dispatchMaintenanceCommand } from "./MaintenanceDispatch.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import type { ProviderAdapterV2Shape } from "./ProviderAdapter.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("This test does not launch a provider"),
} as ProviderAdapterV2Shape;
const orchestratorLayer = makeOrchestratorV2ReplayLayerWithRegistry(
  { name: "maintenance-dispatch" },
  ProviderAdapterRegistry.makeLayer([adapter]),
  { databaseLayer: SqlitePersistenceMemory, runEffectWorker: false },
);
const testLayer = Layer.mergeAll(
  orchestratorLayer,
  ThreadManagementService.layer.pipe(Layer.provide(orchestratorLayer)),
  OrchestrationEventStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
);
const decode = Schema.decodeSync(MaintenanceCommand);

it.effect(
  "legacy maintenance commands preserve one worker, its workspace, and durable repair requests on v2",
  () =>
    Effect.gen(function* () {
      const orchestrator = yield* Orchestrator.OrchestratorV2;
      const threadId = ThreadId.make("t3-fork-maintenance-integration");
      const modelSelection = { instanceId, model: "gpt-6-sol" };
      const createdAt = "2026-10-03T00:00:00.000Z";
      const create = decode({
        type: "thread.create",
        commandId: CommandId.make("maintenance:create"),
        threadId,
        projectId: ProjectId.make("maintenance"),
        title: "Automatic fork maintenance",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: "/first",
        createdAt,
      });
      const first = yield* dispatchMaintenanceCommand(create);
      const repeat = yield* dispatchMaintenanceCommand(create);
      expect(repeat.sequence).toBe(first.sequence);
      yield* dispatchMaintenanceCommand(
        decode({
          type: "thread.session.stop",
          commandId: CommandId.make("maintenance:idle-stop"),
          threadId,
          createdAt,
        }),
      );
      yield* dispatchMaintenanceCommand(
        decode({
          type: "thread.meta.update",
          commandId: CommandId.make("maintenance:workspace"),
          threadId,
          branch: null,
          worktreePath: "/repair",
        }),
      );
      const start = decode({
        type: "thread.turn.start",
        commandId: CommandId.make("maintenance:request"),
        threadId,
        message: {
          messageId: MessageId.make("maintenance:message"),
          role: "user",
          text: "Repair the frozen checkout",
          attachments: [],
        },
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt,
      });
      const receipt = yield* dispatchMaintenanceCommand(start);
      const replay = yield* dispatchMaintenanceCommand(start);
      expect(replay.sequence).toBe(receipt.sequence);
      const projection = yield* orchestrator.getThreadProjection(threadId);
      expect(projection.thread.worktreePath).toBe("/repair");
      expect(projection.messages.map((message) => message.text)).toEqual([
        "Repair the frozen checkout",
      ]);
      expect(projection.runs).toHaveLength(1);
      const interrupted = yield* dispatchMaintenanceCommand(
        decode({
          type: "thread.session.stop",
          commandId: CommandId.make("maintenance:active-stop"),
          threadId,
          createdAt,
        }),
      );
      expect(interrupted.sequence).toBeGreaterThan(receipt.sequence);
      expect(
        (yield* orchestrator.getShellSnapshot()).threads.filter((thread) => thread.id === threadId),
      ).toHaveLength(1);
    }).pipe(Effect.provide(testLayer)),
);
