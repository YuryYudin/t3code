import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type * as Electron from "electron";

/**
 * One live application window. `scope` is the opaque per-window collection
 * scope the renderer reports over IPC; the desktop never interprets it.
 * `focusOrder` grows on every focus so the most recently used window wins when
 * nothing is focused (menu actions, dialogs opened without a calling window).
 */
export interface DesktopAppWindowRecord {
  readonly window: Electron.BrowserWindow;
  readonly scope: string | null;
  readonly createdOrder: number;
  readonly focusOrder: number;
  readonly ready: boolean;
}

interface MutableDesktopAppWindowRecord {
  readonly window: Electron.BrowserWindow;
  readonly createdOrder: number;
  scope: string | null;
  focusOrder: number;
  ready: boolean;
}

const snapshot = (record: MutableDesktopAppWindowRecord): DesktopAppWindowRecord => ({
  window: record.window,
  scope: record.scope,
  createdOrder: record.createdOrder,
  focusOrder: record.focusOrder,
  ready: record.ready,
});

/**
 * The main process' source of truth for application windows. The WSL
 * connecting splash is deliberately never registered, so "is there a real app
 * window?" is answered by this registry alone.
 */
export class DesktopAppWindowRegistry extends Context.Service<
  DesktopAppWindowRegistry,
  {
    readonly register: (
      window: Electron.BrowserWindow,
      scope: string | null,
    ) => Effect.Effect<void>;
    readonly unregister: (window: Electron.BrowserWindow) => Effect.Effect<void>;
    readonly setReady: (window: Electron.BrowserWindow, ready: boolean) => Effect.Effect<void>;
    readonly setScope: (
      window: Electron.BrowserWindow,
      scope: string | null,
    ) => Effect.Effect<void>;
    /** Resolves the window that owns a renderer's webContents id. */
    readonly findBySender: (
      webContentsId: number,
    ) => Effect.Effect<Option.Option<DesktopAppWindowRecord>>;
    readonly focusedOrRecent: Effect.Effect<Option.Option<DesktopAppWindowRecord>>;
    readonly all: Effect.Effect<readonly DesktopAppWindowRecord[]>;
    readonly sendAll: (channel: string, ...args: readonly unknown[]) => Effect.Effect<void>;
    readonly destroyAll: Effect.Effect<void>;
    readonly syncAllAppearance: <E, R>(
      sync: (window: Electron.BrowserWindow) => Effect.Effect<void, E, R>,
    ) => Effect.Effect<void, E, R>;
  }
>()("@t3tools/desktop/window/DesktopAppWindowRegistry") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.sync(() => {
  const records = new Map<number, MutableDesktopAppWindowRecord>();
  let sequence = 0;

  const isLive = (record: MutableDesktopAppWindowRecord) =>
    !record.window.isDestroyed() && !record.window.webContents.isDestroyed();

  // Destroyed windows are pruned on read: Electron fires "closed" after the
  // window is already unusable, and a window can also die with the renderer.
  const liveRecords = () => {
    for (const [id, record] of records) {
      if (!isLive(record)) records.delete(id);
    }
    return [...records.values()];
  };

  const update = (
    window: Electron.BrowserWindow,
    change: (record: MutableDesktopAppWindowRecord) => void,
  ) =>
    Effect.sync(() => {
      const record = records.get(window.id);
      if (record !== undefined) change(record);
    });

  return DesktopAppWindowRegistry.of({
    register: (window, scope) =>
      Effect.sync(() => {
        const order = ++sequence;
        records.set(window.id, {
          window,
          scope,
          createdOrder: order,
          focusOrder: order,
          ready: false,
        });
        window.on("focus", () => {
          const record = records.get(window.id);
          if (record !== undefined) record.focusOrder = ++sequence;
        });
      }),
    unregister: (window) =>
      Effect.sync(() => {
        records.delete(window.id);
      }),
    setReady: (window, ready) => update(window, (record) => (record.ready = ready)),
    setScope: (window, scope) => update(window, (record) => (record.scope = scope)),
    findBySender: (webContentsId) =>
      Effect.sync(() => {
        const record = liveRecords().find(
          (candidate) => candidate.window.webContents.id === webContentsId,
        );
        return record === undefined ? Option.none() : Option.some(snapshot(record));
      }),
    focusedOrRecent: Effect.sync(() => {
      const candidates = liveRecords();
      const focused = candidates.find((record) => record.window.isFocused());
      const selected =
        focused ?? candidates.toSorted((left, right) => right.focusOrder - left.focusOrder)[0];
      return selected === undefined ? Option.none() : Option.some(snapshot(selected));
    }),
    all: Effect.sync(() => liveRecords().map(snapshot)),
    sendAll: (channel, ...args) =>
      Effect.sync(() => {
        for (const record of liveRecords()) record.window.webContents.send(channel, ...args);
      }),
    destroyAll: Effect.sync(() => {
      for (const record of liveRecords()) record.window.destroy();
      records.clear();
    }),
    syncAllAppearance: (sync) =>
      Effect.forEach(liveRecords(), (record) => sync(record.window), { discard: true }),
  });
});

export const layer = Layer.effect(DesktopAppWindowRegistry, make);
