import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2TurnItem,
  type ThreadExternalAlertUpsertCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ExternalAlertInvariantError extends Schema.TaggedError<ExternalAlertInvariantError>()(
  "ExternalAlertInvariantError",
  {
    commandType: Schema.Literal("thread.external-alert.upsert"),
    detail: Schema.String,
  },
) {}

export interface ExternalAlertPlan {
  readonly createThread: boolean;
  readonly modelSelection: ModelSelection;
  readonly ordinal: number;
}

/** Decide the passive incident update before the orchestrator allocates and commits events. */
export const planExternalAlertCommand = Effect.fn("planExternalAlertCommand")(function* (input: {
  readonly command: ThreadExternalAlertUpsertCommand;
  readonly project: { readonly defaultModelSelection: ModelSelection | null } | null;
  readonly thread: OrchestrationV2AppThread | null;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
}): Effect.fn.Return<ExternalAlertPlan, ExternalAlertInvariantError> {
  const { command, project, thread, turnItems } = input;
  const reject = (detail: string) =>
    new ExternalAlertInvariantError({ commandType: command.type, detail });

  if (project === null) {
    return yield* reject(`Project '${command.projectId}' cannot receive an external alert.`);
  }

  if (thread !== null) {
    if (thread.deletedAt !== null) {
      return yield* reject(`Thread '${command.threadId}' is deleted.`);
    }
    if (thread.projectId !== command.projectId) {
      return yield* reject(
        `Thread '${command.threadId}' does not belong to project '${command.projectId}'.`,
      );
    }
    const firstIncident = turnItems.find(
      (item) => item.type === "notification" && item.externalAlert !== undefined,
    );
    const isLegacyIncidentThread =
      turnItems.length === 0 && thread.id.startsWith("t3-fork-incident-");
    if (
      !isLegacyIncidentThread &&
      (firstIncident?.type !== "notification" ||
        firstIncident.externalAlert?.incidentKey !== command.incidentKey)
    ) {
      return yield* reject(
        `Thread '${command.threadId}' is not owned by incident '${command.incidentKey}'.`,
      );
    }
    return {
      createThread: false,
      modelSelection: thread.modelSelection,
      ordinal: turnItems.reduce((latest, item) => Math.max(latest, item.ordinal), 0) + 1,
    };
  }

  if (command.state === "recovered") {
    return yield* reject(
      `Incident '${command.incidentKey}' cannot recover before its thread exists.`,
    );
  }
  if (project.defaultModelSelection === null) {
    return yield* reject(
      `Project '${command.projectId}' requires a default model before receiving external alerts.`,
    );
  }

  return {
    createThread: true,
    modelSelection: project.defaultModelSelection,
    ordinal: 1,
  };
});
