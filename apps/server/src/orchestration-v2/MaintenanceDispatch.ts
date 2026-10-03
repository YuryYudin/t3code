import {
  CommandId,
  type MaintenanceCommand,
  type ThreadExternalAlertUpsertCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as OrchestrationEventStore from "../persistence/Services/OrchestrationEventStore.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export const dispatchMaintenanceCommand = Effect.fn("orchestrationV2.maintenance.dispatch")(
  function* (command: MaintenanceCommand | ThreadExternalAlertUpsertCommand) {
    const service = yield* ThreadManagementService.ThreadManagementService;
    switch (command.type) {
      case "thread.external-alert.upsert":
        return yield* service.dispatch(command);
      case "thread.create":
        return yield* service.dispatch({
          ...command,
          createdBy: "system",
          creationSource: "server",
        });
      case "thread.meta.update":
        return yield* service.dispatch({ ...command, type: "thread.metadata.update" });
      case "thread.session.stop": {
        const { thread } = yield* service.getThreadRecords(command.threadId, []);
        const result = yield* service.interruptThread({
          commandId: command.commandId,
          threadId: command.threadId,
          projectId: thread.projectId,
        });
        if (result.type === "interrupt_requested") return result.dispatch;
        const events = yield* OrchestrationEventStore.OrchestrationEventStore;
        return { sequence: yield* events.latestApplicationSequence };
      }
      case "thread.turn.start": {
        const { thread } = yield* service.getThreadRecords(command.threadId, []);
        yield* service.dispatch({
          type: "thread.runtime-mode.set",
          commandId: CommandId.make(`${command.commandId}:runtime-mode`),
          threadId: command.threadId,
          runtimeMode: command.runtimeMode,
        });
        yield* service.dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make(`${command.commandId}:interaction-mode`),
          threadId: command.threadId,
          interactionMode: command.interactionMode,
        });
        const result = yield* service.sendToThread({
          commandId: command.commandId,
          threadId: command.threadId,
          projectId: thread.projectId,
          messageId: command.message.messageId,
          text: command.message.text,
          attachments: command.message.attachments,
          modelSelection: command.modelSelection,
          mode: "queue",
          createdBy: "user",
          creationSource: "server",
        });
        return result.dispatch;
      }
    }
  },
);
