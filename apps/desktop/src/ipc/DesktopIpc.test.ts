import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as DesktopAppWindowRegistry from "../window/DesktopAppWindowRegistry.ts";
import * as DesktopIpc from "./DesktopIpc.ts";

it.effect("answers only registered application windows' top frames", () =>
  Effect.gen(function* () {
    const mainFrame = {};
    const secondFrame = {};
    const invoke = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const sync = new Map<string, DesktopIpc.DesktopIpcSyncListener>();
    const appWindows = yield* DesktopAppWindowRegistry.make;
    const appWindow = (id: number, webContentsId: number, mainFrame: object) =>
      ({
        id,
        isDestroyed: () => false,
        on: () => undefined,
        webContents: { id: webContentsId, isDestroyed: () => false, mainFrame },
      }) as unknown as Electron.BrowserWindow;
    yield* appWindows.register(appWindow(10, 1, mainFrame), null);
    yield* appWindows.register(appWindow(20, 2, secondFrame), "collection:work");
    const ipc = yield* DesktopIpc.DesktopIpc.pipe(
      Effect.provide(
        DesktopIpc.layer({
          removeHandler: (channel) => void invoke.delete(channel),
          handle: (channel, listener) => void invoke.set(channel, listener),
          removeAllListeners: (channel) => void sync.delete(channel),
          on: (channel, listener) => void sync.set(channel, listener),
        }).pipe(
          Layer.provide(
            Layer.succeed(
              DesktopAppWindowRegistry.DesktopAppWindowRegistry,
              appWindows,
            ),
          ),
        ),
      ),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: "token",
        payload: Schema.Void,
        result: Schema.String,
        handler: () => Effect.succeed("secret"),
      }),
    );
    yield* ipc.handleSync({ channel: "token-sync", handler: () => Effect.succeed("secret") });

    const senders = {
      app: { sender: { id: 1 }, senderFrame: mainFrame },
      secondApp: { sender: { id: 2 }, senderFrame: secondFrame },
      appSubframe: { sender: { id: 1 }, senderFrame: {} },
      previewGuest: { sender: { id: 3 }, senderFrame: {} },
    };
    const results: Record<string, unknown> = {};
    for (const [name, sender] of Object.entries(senders)) {
      const event = { ...sender, returnValue: "unset" as unknown };
      sync.get("token-sync")!(event);
      results[name] = [
        yield* Effect.promise(() =>
          Promise.resolve(invoke.get("token")!(sender, undefined)).catch(() => "rejected"),
        ),
        event.returnValue,
      ];
    }
    assert.deepEqual(results, {
      app: ["secret", "secret"],
      secondApp: ["secret", "secret"],
      appSubframe: ["rejected", undefined],
      previewGuest: ["rejected", undefined],
    });
  }),
);
