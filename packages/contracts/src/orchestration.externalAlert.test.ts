import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ProjectId } from "./baseSchemas.ts";
import {
  ForkMaintenanceDispatchCommand,
  ThreadExternalAlertUpsertCommand,
} from "./orchestrationV2.ts";

const decodeExternalAlert = Schema.decodeUnknownEffect(ThreadExternalAlertUpsertCommand);
const decodeForkMaintenanceCommand = Schema.decodeUnknownEffect(ForkMaintenanceDispatchCommand);

it.effect("decodes a bounded passive external alert command", () =>
  Effect.gen(function* () {
    const command = yield* decodeExternalAlert({
      type: "thread.external-alert.upsert",
      commandId: "jenkins:issue:42:failure:job:t3code%2Fmain:build:123:class:validation",
      projectId: "fork-maintenance",
      threadId: "fork-maintenance-42",
      incidentKey:
        "jenkins:YuryYudin/t3code:t3code/main:automatic-stable-release:stable:0.0.40:validation",
      title: "Fork maintenance failed",
      state: "failing",
      summary: "Stable validation failed",
      detail: "See the Jenkins build for sanitized details.",
      url: "http://kubuntu:8080/job/t3code/job/main/123/",
      createdAt: "2026-09-14T10:00:00.000Z",
    });

    assert.strictEqual(command.state, "failing");
    assert.strictEqual(command.projectId, ProjectId.make("fork-maintenance"));
  }),
);

it.effect("rejects non-http external alert URLs", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decodeExternalAlert({
        type: "thread.external-alert.upsert",
        commandId: "alert-invalid-url",
        projectId: "fork-maintenance",
        threadId: "fork-maintenance-42",
        incidentKey: "incident-key",
        title: "Fork maintenance failed",
        state: "failing",
        summary: "Stable validation failed",
        url: "file:///tmp/build.log",
        createdAt: "2026-09-14T10:00:00.000Z",
      }),
    );

    assert.isTrue(Exit.isFailure(exit));
  }),
);

it.effect("decodes the frozen Jenkins repair lifecycle commands", () =>
  Effect.gen(function* () {
    const createdAt = "2026-09-14T10:00:00.000Z";
    const modelSelection = { instanceId: "codex", model: "gpt-5-codex" };
    const commands = [
      {
        type: "thread.create",
        commandId: "fork-maintenance:create",
        threadId: "t3-fork-maintenance-integration",
        projectId: "fork-maintenance",
        title: "Automatic fork maintenance",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: "/var/tmp/fork-repair/checkout",
        createdAt,
      },
      {
        type: "thread.session.stop",
        commandId: "fork-maintenance:stop-previous",
        threadId: "t3-fork-maintenance-integration",
        createdAt,
      },
      {
        type: "thread.meta.update",
        commandId: "fork-maintenance:workspace",
        threadId: "t3-fork-maintenance-integration",
        branch: null,
        worktreePath: "/var/tmp/fork-repair/checkout",
      },
      {
        type: "thread.turn.start",
        commandId: "fork-maintenance:repair",
        threadId: "t3-fork-maintenance-integration",
        message: {
          messageId: "fork-maintenance:repair",
          role: "user",
          text: "Repair the integration.",
          attachments: [],
        },
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt,
      },
    ];

    const decoded = yield* Effect.forEach(commands, (command) =>
      decodeForkMaintenanceCommand(command),
    );
    assert.deepEqual(
      decoded.map(({ type }) => type),
      ["thread.create", "thread.session.stop", "thread.meta.update", "thread.turn.start"],
    );
  }),
);
