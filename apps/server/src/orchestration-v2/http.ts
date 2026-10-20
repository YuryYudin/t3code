import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  type ForkMaintenanceDispatchCommand,
  type OrchestrationV2Command,
  type OrchestrationV2InternalCommand,
  type OrchestrationV2ServerCommand,
  type OrchestrationProjectShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as SqlClient from "effect/sql/SqlClient";

import {
  annotateEnvironmentRequest,
  failEnvironmentInternal,
  failEnvironmentInvalidRequest,
  failEnvironmentNotFound,
  requireEnvironmentScope,
} from "../auth/http.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { traceLocalHandlerWork } from "../cloud/traceRelayRequest.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import {
  buildBoundedThreadProjection,
  decodeThreadHistoryCursor,
  InvalidThreadHistoryCursorError,
  THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
  THREAD_HISTORY_PAGE_POLICY,
  OLDER_THREAD_USER_TURN_LIMIT,
} from "./threadHistoryPaging.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import { buildActiveShellSnapshot, loadShellSnapshotParts } from "./ShellStream.ts";
import { boundedSnapshotResponseFields } from "./ThreadStream.ts";
import { projectThreadProjectionForWire } from "./WireProjection.ts";

const isThreadTranscriptTooLargeError = Schema.is(
  ThreadManagementService.ThreadTranscriptTooLargeError,
);

function isThreadNotFound(error: unknown): boolean {
  return (
    Predicate.hasProperty(error, "cause") &&
    Predicate.hasProperty(error.cause, "_tag") &&
    error.cause._tag === "ProjectionStoreThreadNotFoundError"
  );
}

/** Keep Jenkins' frozen V1 maintenance wire commands compatible with the V2 orchestrator. */
function adaptForkMaintenanceCommand(
  command: ForkMaintenanceDispatchCommand,
): OrchestrationV2ServerCommand {
  switch (command.type) {
    case "thread.external-alert.upsert":
      return command;
    case "thread.create":
      return {
        ...command,
        createdBy: "system",
        creationSource: "server",
      } satisfies Extract<OrchestrationV2Command, { readonly type: "thread.create" }> & {
        readonly createdAt: string;
      };
    case "thread.session.stop":
      return {
        type: "thread.stop",
        commandId: command.commandId,
        threadId: command.threadId,
        reason: "Superseded by a new fork maintenance repair request.",
      } satisfies Extract<OrchestrationV2InternalCommand, { readonly type: "thread.stop" }>;
    case "thread.meta.update":
      return {
        type: "thread.metadata.update",
        commandId: command.commandId,
        threadId: command.threadId,
        ...(command.branch === undefined ? {} : { branch: command.branch }),
        ...(command.worktreePath === undefined ? {} : { worktreePath: command.worktreePath }),
      } satisfies Extract<OrchestrationV2Command, { readonly type: "thread.metadata.update" }>;
    case "thread.turn.start":
      return {
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "server",
        commandId: command.commandId,
        threadId: command.threadId,
        messageId: command.message.messageId,
        text: command.message.text,
        attachments: command.message.attachments,
        ...(command.message.context === undefined ? {} : { context: command.message.context }),
        ...(command.modelSelection === undefined
          ? {}
          : { modelSelection: command.modelSelection }),
        dispatchMode: { type: "start_immediately" },
      } satisfies Extract<OrchestrationV2Command, { readonly type: "message.dispatch" }>;
  }
}

/**
 * Serves orchestration V2 snapshots over HTTP so clients can load the
 * (potentially large) shell and thread projections off the socket; gzip
 * compressible and cacheable — and then resume the WebSocket subscription via
 * `afterSequence`.
 */
export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "orchestration",
  Effect.fnUntraced(function* (handlers) {
    const sql = yield* SqlClient.SqlClient;
    const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
    const threadManagement = yield* ThreadManagementService.ThreadManagementService;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
    const projectStore = yield* ProjectStore.ProjectStoreV2;
    const projectEnrichment = yield* ProjectEnrichmentService.ProjectEnrichmentService;

    const enrichProjectShells = Effect.fn("http.orchestration.enrichProjectShells")(
      (projects: ReadonlyArray<OrchestrationProjectShell>) =>
        Effect.forEach(
          projects,
          (project) =>
            // Use immediately available enrichment only. Awaiting git-backed
            // identity resolution can exceed the client shell-snapshot budget
            // (ProcessRunner allows probes up to one minute).
            projectEnrichment.getAvailable(project.workspaceRoot).pipe(
              Effect.map((enrichment) => ({
                ...project,
                repositoryIdentity: enrichment.repositoryIdentity,
              })),
            ),
          { concurrency: 16 },
        ),
    );

    const loadShellSnapshot = Effect.fn("http.orchestration.loadShellSnapshot")(function* () {
      const base = buildActiveShellSnapshot(
        yield* loadShellSnapshotParts({
          sql,
          readThreads: threadManagement.readShellSnapshot({ location: "active" }),
          listProjects: projectStore.listShells(),
          latestSequence: applicationEvents.latestApplicationSequence,
        }),
      );
      const projects = yield* enrichProjectShells(base.projects);
      return { ...base, projects };
    });

    const loadThreadSnapshot = Effect.fn("http.orchestration.loadThreadSnapshot")(function* (
      threadId: Parameters<typeof threadManagement.getThreadSnapshot>[0],
      failureReason:
        | "orchestration_thread_snapshot_failed"
        | "orchestration_thread_bounded_snapshot_failed"
        | "orchestration_thread_history_failed",
    ) {
      return yield* threadManagement.getThreadSnapshot(threadId).pipe(
        Effect.map((snapshot) => ({
          ...snapshot,
          projection: projectThreadProjectionForWire(snapshot.projection),
        })),
        Effect.catch(
          Effect.fnUntraced(function* (error) {
            if (isThreadNotFound(error)) {
              return yield* failEnvironmentNotFound("thread_not_found");
            }
            return yield* failEnvironmentInternal(failureReason, error);
          }),
        ),
      );
    });

    const loadThreadSnapshotWindow = Effect.fn("http.orchestration.loadThreadSnapshotWindow")(
      function* (
        threadId: Parameters<typeof threadManagement.getThreadSnapshot>[0],
        anchorItemId?: Parameters<
          typeof threadManagement.getThreadSnapshotWindow
        >[1]["anchorItemId"],
        anchorThreadId?: Parameters<
          typeof threadManagement.getThreadSnapshotWindow
        >[1]["anchorThreadId"],
      ) {
        return yield* threadManagement
          .getThreadSnapshotWindow(threadId, {
            rowLimit: THREAD_HISTORY_SNAPSHOT_ROW_LIMIT,
            userTurnLimit:
              anchorItemId === undefined
                ? THREAD_HISTORY_PAGE_POLICY.maxUserTurns
                : OLDER_THREAD_USER_TURN_LIMIT,
            ...(anchorItemId === undefined ? {} : { anchorItemId }),
            ...(anchorThreadId === undefined ? {} : { anchorThreadId }),
          })
          .pipe(
            Effect.map((snapshot) => ({
              ...snapshot,
              projection: projectThreadProjectionForWire(snapshot.projection),
            })),
            Effect.catch(
              Effect.fnUntraced(function* (error) {
                if (isThreadNotFound(error)) {
                  return yield* failEnvironmentNotFound("thread_not_found");
                }
                return yield* failEnvironmentInternal("orchestration_thread_history_failed", error);
              }),
            ),
          );
      },
    );

    return handlers
      .handle(
        "dispatch",
        Effect.fn("environment.orchestration.dispatch")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationOperateScope);
          return yield* orchestrator.dispatch(adaptForkMaintenanceCommand(args.payload)).pipe(
            Effect.map(({ sequence }) => ({ sequence })),
            Effect.catch(() => failEnvironmentInvalidRequest("invalid_command")),
          );
        }),
      )
      .handle(
        "shellSnapshot",
        Effect.fn("environment.orchestration.shellSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* loadShellSnapshot().pipe(
            traceLocalHandlerWork,
            Effect.catch((cause) =>
              failEnvironmentInternal("orchestration_snapshot_failed", cause),
            ),
          );
        }),
      )
      .handle(
        "threadSnapshot",
        Effect.fn("environment.orchestration.threadSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const snapshot = yield* loadThreadSnapshot(
            args.params.threadId,
            "orchestration_thread_snapshot_failed",
          ).pipe(traceLocalHandlerWork);
          return {
            snapshotSequence: snapshot.snapshotSequence,
            projection: snapshot.projection,
          };
        }),
      )
      .handle(
        "threadTranscript",
        Effect.fn("environment.orchestration.threadTranscript")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* threadManagement.getThreadTranscript(args.params.threadId).pipe(
            Effect.provideService(ServerEnvironment.ServerEnvironmentIdentity, environment),
            traceLocalHandlerWork,
            Effect.catch(
              Effect.fnUntraced(function* (error) {
                if (isThreadTranscriptTooLargeError(error)) {
                  return yield* failEnvironmentInvalidRequest("thread_transcript_too_large");
                }
                if (isThreadNotFound(error)) {
                  return yield* failEnvironmentNotFound("thread_not_found");
                }
                return yield* failEnvironmentInternal(
                  "orchestration_thread_snapshot_failed",
                  error,
                );
              }),
            ),
          );
        }),
      )
      .handle(
        "threadBoundedSnapshot",
        Effect.fn("environment.orchestration.threadBoundedSnapshot")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          const snapshot = yield* loadThreadSnapshotWindow(args.params.threadId).pipe(
            traceLocalHandlerWork,
          );
          const bounded = buildBoundedThreadProjection({
            projection: snapshot.projection,
            snapshotSequence: snapshot.snapshotSequence,
          });
          return {
            snapshotSequence: snapshot.snapshotSequence,
            ...boundedSnapshotResponseFields({
              bounded,
              compactTurnItems: args.query.compactTurnItems === "1",
            }),
          };
        }),
      )
      .handle(
        "threadHistoryPage",
        Effect.fn("environment.orchestration.threadHistoryPage")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          try {
            decodeThreadHistoryCursor(args.query.cursor);
          } catch (cause) {
            if (cause instanceof InvalidThreadHistoryCursorError)
              return yield* failEnvironmentInvalidRequest("invalid_history_cursor");
            return yield* failEnvironmentInternal("orchestration_thread_history_failed", cause);
          }
          return yield* threadManagement
            .getThreadHistoryPage(
              args.params.threadId,
              args.query.cursor,
              args.query.throughEntryId,
              args.query.view === "conversation",
            )
            .pipe(
              traceLocalHandlerWork,
              Effect.catch(
                Effect.fnUntraced(function* (cause) {
                  if (isThreadNotFound(cause))
                    return yield* failEnvironmentNotFound("thread_not_found");
                  return yield* failEnvironmentInternal(
                    "orchestration_thread_history_failed",
                    cause,
                  );
                }),
              ),
            );
        }),
      );
  }),
);
