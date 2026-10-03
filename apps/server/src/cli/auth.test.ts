// @effect-diagnostics nodeBuiltinImport:off - CLI integration owns isolated temporary state.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import * as CliError from "effect/unstable/cli/CliError";
import { Command } from "effect/unstable/cli";

import { cli } from "../binCli.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);
const runCli = (args: ReadonlyArray<string>) => Command.runWith(cli, { version: "0.0.0" })(args);

const captureStdout = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    yield* effect;
    return (
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      ""
    );
  }).pipe(Effect.provide(Layer.mergeAll(CliRuntimeLayer, TestConsole.layer)));

it.effect("issues a restricted session and normalizes duplicate scopes", () =>
  Effect.gen(function* () {
    const baseDir = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-auth-scope-"))),
      (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
    );
    const output = yield* captureStdout(
      runCli([
        "auth",
        "session",
        "issue",
        "--base-dir",
        baseDir,
        "--scope",
        "orchestration:operate",
        "--scope",
        "orchestration:operate",
        "--json",
      ]),
    );
    // @effect-diagnostics-next-line preferSchemaOverJson:off - assertion reads CLI JSON output.
    const issued = JSON.parse(output) as { readonly scopes: ReadonlyArray<string> };

    assert.deepEqual(issued.scopes, ["orchestration:operate"]);
  }).pipe(Effect.scoped),
);

it.effect("rejects unsupported session scopes before issuing a token", () =>
  runCli([
    "auth",
    "session",
    "issue",
    "--scope",
    "administrator:everything",
  ]).pipe(
    Effect.provide(CliRuntimeLayer),
    Effect.flip,
    Effect.tap((error) => Effect.sync(() => assert.isTrue(CliError.isCliError(error)))),
  ),
);
