import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import type * as Electron from "electron";

import * as DesktopAppWindowRegistry from "./DesktopAppWindowRegistry.ts";

function makeWindow(id: number) {
  const focusListeners: Array<() => void> = [];
  let focused = false;
  let destroyed = false;
  const window = {
    id,
    webContents: {
      id: id + 100,
      isDestroyed: () => destroyed,
      send: vi.fn(),
    },
    isDestroyed: () => destroyed,
    isFocused: () => focused,
    on: (event: string, listener: () => void) => {
      if (event === "focus") focusListeners.push(listener);
      return window;
    },
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    focus: () => {
      focused = true;
      for (const listener of focusListeners) listener();
    },
    blur: () => {
      focused = false;
    },
    close: () => {
      destroyed = true;
    },
  };
  return window as unknown as Electron.BrowserWindow & typeof window;
}

describe("DesktopAppWindowRegistry", () => {
  it.effect("prefers the focused window, then the most recently focused live window", () =>
    Effect.gen(function* () {
      const registry = yield* DesktopAppWindowRegistry.make;
      const first = makeWindow(1);
      const second = makeWindow(2);
      yield* registry.register(first, null);
      yield* registry.register(second, "collection:a");

      assert.strictEqual(Option.getOrThrow(yield* registry.focusedOrRecent).window, second);
      first.focus();
      assert.strictEqual(Option.getOrThrow(yield* registry.focusedOrRecent).window, first);
      first.blur();
      // Nothing focused: the window focused most recently still wins.
      assert.strictEqual(Option.getOrThrow(yield* registry.focusedOrRecent).window, first);
      first.close();
      assert.strictEqual(Option.getOrThrow(yield* registry.focusedOrRecent).window, second);
      assert.deepEqual(
        (yield* registry.all).map((record) => record.window),
        [second],
      );
    }),
  );

  it.effect("resolves a window from its renderer and forgets unregistered windows", () =>
    Effect.gen(function* () {
      const registry = yield* DesktopAppWindowRegistry.make;
      const window = makeWindow(3);
      yield* registry.register(window, null);

      assert.strictEqual(
        Option.getOrThrow(yield* registry.findBySender(window.webContents.id)).window,
        window,
      );
      assert.isTrue(Option.isNone(yield* registry.findBySender(999)));

      yield* registry.unregister(window);
      assert.isTrue(Option.isNone(yield* registry.findBySender(window.webContents.id)));
      assert.isTrue(Option.isNone(yield* registry.focusedOrRecent));
    }),
  );

  it.effect("tracks readiness and the per-window scope", () =>
    Effect.gen(function* () {
      const registry = yield* DesktopAppWindowRegistry.make;
      const window = makeWindow(4);
      yield* registry.register(window, "all");

      const initial = Option.getOrThrow(yield* registry.focusedOrRecent);
      assert.strictEqual(initial.scope, "all");
      assert.isFalse(initial.ready);

      yield* registry.setScope(window, "collection:xyz");
      yield* registry.setReady(window, true);
      const updated = Option.getOrThrow(yield* registry.findBySender(window.webContents.id));
      assert.strictEqual(updated.scope, "collection:xyz");
      assert.isTrue(updated.ready);
    }),
  );

  it.effect("broadcasts to, and destroys, only registered app windows", () =>
    Effect.gen(function* () {
      const registry = yield* DesktopAppWindowRegistry.make;
      const first = makeWindow(5);
      const second = makeWindow(6);
      const unregistered = makeWindow(7);
      yield* registry.register(first, null);
      yield* registry.register(second, null);

      yield* registry.sendAll("desktop:test", { ok: true });
      assert.deepEqual(first.webContents.send.mock.calls, [["desktop:test", { ok: true }]]);
      assert.deepEqual(second.webContents.send.mock.calls, [["desktop:test", { ok: true }]]);
      assert.equal(unregistered.webContents.send.mock.calls.length, 0);

      const synced: Electron.BrowserWindow[] = [];
      yield* registry.syncAllAppearance((window) => Effect.sync(() => synced.push(window)));
      assert.deepEqual(synced, [first, second]);

      yield* registry.destroyAll;
      assert.equal(first.destroy.mock.calls.length, 1);
      assert.equal(second.destroy.mock.calls.length, 1);
      assert.equal(unregistered.destroy.mock.calls.length, 0);
      assert.deepEqual(yield* registry.all, []);
    }),
  );
});
