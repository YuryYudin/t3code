import * as Schema from "effect/Schema";
import {
  CommandId,
  IsoDateTime,
  MessageId,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ChatAttachment } from "./chatAttachment.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

// Jenkins keeps using this small HTTP interface while the installed environment
// and the candidate being repaired may run different orchestration versions.
export const MaintenanceCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread.create"),
    commandId: CommandId,
    threadId: ThreadId,
    projectId: ProjectId,
    title: TrimmedNonEmptyString,
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    branch: Schema.NullOr(TrimmedNonEmptyString),
    worktreePath: Schema.NullOr(TrimmedNonEmptyString),
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.meta.update"),
    commandId: CommandId,
    threadId: ThreadId,
    title: Schema.optionalKey(TrimmedNonEmptyString),
    branch: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
    worktreePath: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.session.stop"),
    commandId: CommandId,
    threadId: ThreadId,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.turn.start"),
    commandId: CommandId,
    threadId: ThreadId,
    message: Schema.Struct({
      messageId: MessageId,
      role: Schema.Literal("user"),
      text: TrimmedNonEmptyString,
      attachments: Schema.Array(ChatAttachment),
    }),
    modelSelection: ModelSelection,
    runtimeMode: RuntimeMode,
    interactionMode: ProviderInteractionMode,
    createdAt: IsoDateTime,
  }),
]);
export type MaintenanceCommand = typeof MaintenanceCommand.Type;
