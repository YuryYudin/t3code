import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import type * as Electron from "electron";

const { focusedWebContents, ownerWindow } = vi.hoisted(() => ({
  focusedWebContents: vi.fn(),
  ownerWindow: vi.fn(),
}));
vi.mock("electron", () => ({
  webContents: { getFocusedWebContents: focusedWebContents },
  BrowserWindow: { fromWebContents: ownerWindow },
}));

import * as NodeServices from "@effect/platform-node/NodeServices";

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import type { DesktopSettings } from "../../settings/DesktopAppSettings.ts";
import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopWslEnvironment from "../../wsl/DesktopWslEnvironment.ts";
import * as DesktopAppWindowRegistry from "../../window/DesktopAppWindowRegistry.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import {
  getLocalEnvironmentBootstraps,
  getWindowFullscreenState,
  openWindow,
  pasteAsText,
  pickFolder,
  pickProjectFavicon,
  setWindowScope,
} from "./window.ts";

// Fake app windows, keyed the way Electron keys them: a window id plus the
// webContents id its renderer sends IPC from.
function makeAppWindow(id: number, options: { readonly fullscreen?: boolean } = {}) {
  const window = {
    id,
    webContents: { id: id + 100, isDestroyed: () => false },
    isDestroyed: () => false,
    isFocused: () => false,
    isFullScreen: () => options.fullscreen ?? false,
    on: () => window,
  };
  return window as unknown as Electron.BrowserWindow & { readonly id: number };
}

// Registers the given windows in creation order, so the last one is the
// "most recently focused" fallback while nothing is focused.
const appWindowRegistryLayer = (windows: readonly Electron.BrowserWindow[]) =>
  Layer.effect(
    DesktopAppWindowRegistry.DesktopAppWindowRegistry,
    Effect.gen(function* () {
      const registry = yield* DesktopAppWindowRegistry.make;
      for (const window of windows) yield* registry.register(window, null);
      return registry;
    }),
  );

const readyWslConfig: DesktopBackendManager.DesktopBackendStartConfig = {
  executablePath: "wsl.exe",
  args: ["-d", "Ubuntu", "--", "node", "/app/bin.mjs"],
  entryPath: "/app/bin.mjs",
  cwd: "/app",
  env: {},
  extendEnv: false,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3774,
    host: "0.0.0.0",
    desktopBootstrapToken: "bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "stdin",
  httpBaseUrl: new URL("http://127.0.0.1:3774"),
  captureOutput: true,
  preflightFailure: Option.none(),
  runningDistro: "Ubuntu",
};

const defaultWslInstance: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.BackendInstanceId("wsl:default"),
  label: Effect.succeed("WSL (default distro)"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(Option.some(readyWslConfig)),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(123),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

describe("getLocalEnvironmentBootstraps", () => {
  it.effect("publishes the concrete running distro without replacing the stable instance id", () =>
    Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();

      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (Ubuntu)",
          runningDistro: "Ubuntu",
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([defaultWslInstance]))),
  );

  it.effect("publishes a pending bootstrap only while a transient retry is scheduled", () => {
    const retryingConfig: DesktopBackendManager.DesktopBackendStartConfig = {
      ...readyWslConfig,
      preflightFailure: Option.some({
        reason: "WSL probe timed out",
        fatal: false,
        retryLimit: 12,
      }),
    };
    const retryingInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeed(Option.some(retryingConfig)),
      snapshot: Effect.succeed({
        desiredRunning: true,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 2,
        restartScheduled: true,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (default distro)",
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([retryingInstance])));
  });

  it.effect("omits a bounded transient bootstrap after retries stop", () => {
    const stoppedInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeed(
        Option.some({
          ...readyWslConfig,
          preflightFailure: Option.some({
            reason: "WSL probe timed out",
            fatal: false,
            retryLimit: 12,
          }),
        }),
      ),
      snapshot: Effect.succeed({
        desiredRunning: false,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 12,
        restartScheduled: false,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, []);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([stoppedInstance])));
  });
});

describe("getWindowFullscreenState", () => {
  it.effect("reads the state of the window that asked, not the most recent one", () => {
    const fullscreen = makeAppWindow(1, { fullscreen: true });
    const windowed = makeAppWindow(2);

    return Effect.gen(function* () {
      assert.isTrue(
        yield* getWindowFullscreenState.handler({
          sender: { id: fullscreen.webContents.id },
          returnValue: undefined,
        }),
      );
      assert.isFalse(
        yield* getWindowFullscreenState.handler({
          sender: { id: windowed.webContents.id },
          returnValue: undefined,
        }),
      );
      // No event (or an unknown sender): fall back to the most recent window.
      assert.isFalse(yield* getWindowFullscreenState.handler());
    }).pipe(Effect.provide(appWindowRegistryLayer([fullscreen, windowed])));
  });
});

describe("pasteAsText", () => {
  it.effect(
    "pastes into the focused guest only after the main renderer acknowledges the menu action",
    () => {
      const paste = vi.fn();
      const mainPaste = vi.fn();
      const window = {
        webContents: { id: 42, paste: mainPaste },
        isDestroyed: () => false,
      } as unknown as Electron.BrowserWindow;
      focusedWebContents.mockReturnValue({ paste, isDestroyed: () => false });
      ownerWindow.mockReturnValue(window);

      return Effect.gen(function* () {
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        assert.equal(mainPaste.mock.calls.length, 0);

        yield* pasteAsText.handler(undefined, { sender: { id: 99 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue({}); // A focused PiP/other BrowserWindow.
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue(null); // Detached contents.
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue(window);
        focusedWebContents.mockReturnValue({ paste, isDestroyed: () => true });
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        focusedWebContents.mockReturnValue(null);
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
      }).pipe(
        Effect.provide(
          Layer.mock(ElectronWindow.ElectronWindow)({
            main: Effect.succeed(Option.some(window)),
          }),
        ),
      );
    },
  );
});

describe("pickProjectFavicon", () => {
  const pickerLayer = (pickFiles: () => Effect.Effect<Array<string>>, settings?: DesktopSettings) =>
    Layer.mergeAll(
      Layer.mock(ElectronDialog.ElectronDialog)({ pickFiles }),
      appWindowRegistryLayer([]),
      DesktopAppSettings.layerTest(settings),
    );

  it.effect("opens a single-image picker from the project directory", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon
        .handler("/project")
        .pipe(Effect.provide(pickerLayer(pickFiles)));

      assert.strictEqual(result, "/pictures/icon.png");
      assert.deepEqual(pickFiles.mock.calls, [
        [
          {
            owner: Option.none(),
            defaultPath: Option.some("/project"),
            multiple: false,
            filters: [
              {
                name: "Images",
                extensions: ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"],
              },
            ],
          },
        ],
      ]);
    }),
  );

  it.effect("does not open a picker while the local environment is off", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon.handler("/project").pipe(
        Effect.provide(
          pickerLayer(pickFiles, {
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            localEnvironmentEnabled: false,
          }),
        ),
      );

      assert.strictEqual(result, null);
      assert.strictEqual(pickFiles.mock.calls.length, 0);
    }),
  );
});

const environmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/repo",
  isPackaged: false,
  resourcesPath: "/repo/resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

describe("pickFolder", () => {
  it.effect("attaches the folder dialog to the window that asked", () => {
    const first = makeAppWindow(11);
    const second = makeAppWindow(12);
    const owners: Array<Option.Option<Electron.BrowserWindow>> = [];

    return Effect.gen(function* () {
      const result = yield* pickFolder.handler(undefined, {
        sender: { id: first.webContents.id },
      });

      assert.strictEqual(result, "/projects/app");
      assert.deepEqual(owners, [Option.some(first)]);

      // An unknown sender still attaches the dialog to a visible window.
      yield* pickFolder.handler(undefined, { sender: { id: 9_999 } });
      assert.deepEqual(owners[1], Option.some(second));
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ElectronDialog.ElectronDialog)({
            pickFolder: (input) => {
              owners.push(input.owner);
              return Effect.succeed(Option.some("/projects/app"));
            },
          }),
          appWindowRegistryLayer([first, second]),
          DesktopAppSettings.layerTest(),
          DesktopWslEnvironment.layerTest(),
          DesktopEnvironment.layer(environmentInput).pipe(
            Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({}))),
          ),
        ),
      ),
    );
  });
});

describe("openWindow", () => {
  it.effect("opens a window for the requested scope and rejects an invalid one", () =>
    Effect.gen(function* () {
      const created: unknown[] = [];
      const layer = Layer.mock(DesktopWindow.DesktopWindow)({
        create: (input) =>
          Effect.sync(() => created.push(input)).pipe(Effect.as({} as Electron.BrowserWindow)),
      });

      yield* openWindow.handler({ scope: "collection:abc" }).pipe(Effect.provide(layer));
      yield* openWindow.handler({}).pipe(Effect.provide(layer));
      assert.deepEqual(created, [{ scope: "collection:abc" }, {}]);

      const rejected = yield* Effect.exit(
        openWindow.handler({ scope: " untrimmed " }).pipe(Effect.provide(layer)),
      );
      assert.equal(rejected._tag, "Failure");
      assert.equal(created.length, 2);
    }),
  );
});

describe("setWindowScope", () => {
  it.effect("routes the scope to the window that reported it", () => {
    const first = makeAppWindow(21);
    const second = makeAppWindow(22);
    const applied: { readonly windowId: number; readonly scope: string | null }[] = [];

    return Effect.gen(function* () {
      const registry = yield* DesktopAppWindowRegistry.DesktopAppWindowRegistry;
      yield* setWindowScope.handler("collection:one", { sender: { id: first.webContents.id } });
      assert.deepEqual(applied, [{ windowId: first.id, scope: "collection:one" }]);
      assert.isNull(Option.getOrThrow(yield* registry.findBySender(second.webContents.id)).scope);

      // A renderer that is not an app window cannot move another window's scope.
      yield* setWindowScope.handler("collection:two", { sender: { id: 9_999 } });
      assert.deepEqual(applied, [{ windowId: first.id, scope: "collection:one" }]);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          appWindowRegistryLayer([first, second]),
          Layer.mock(DesktopWindow.DesktopWindow)({
            setWindowScope: (window, scope) =>
              Effect.sync(() => {
                applied.push({ windowId: window.id, scope });
              }),
          }),
        ),
      ),
    );
  });
});
