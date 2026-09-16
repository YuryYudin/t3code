import {
  DesktopServerExposureModeSchema,
  DesktopUpdateChannelSchema,
  type DesktopServerExposureMode,
  type DesktopUpdateChannel,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import {
  DEFAULT_LINUX_PASSWORD_STORE,
  normalizeLinuxPasswordStorePreference,
  type LinuxPasswordStorePreference,
} from "../linuxSecretStorage.ts";
import { resolveDefaultDesktopUpdateChannel } from "../updates/updateChannels.ts";
import { isValidDistroName } from "../wsl/wslPathParsing.ts";

/**
 * One window to restore on the next launch, in launch order. Record 0 is the
 * main window; `scope` is the opaque per-window collection scope the renderer
 * reports, which the desktop never interprets.
 */
export interface DesktopWindowRecord {
  readonly bounds: DesktopWindowBounds | null;
  readonly maximized: boolean;
  readonly scope: string | null;
}

export interface DesktopSettings {
  readonly localEnvironmentEnabled: boolean;
  readonly linuxPasswordStore: LinuxPasswordStorePreference;
  // Mirrors `windows[0]` so a build without multi-window support still restores
  // its main window from a document this build wrote.
  readonly mainWindowBounds: DesktopWindowBounds | null;
  readonly mainWindowMaximized: boolean;
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly tailscaleServeEnabled: boolean;
  readonly tailscaleServePort: number;
  readonly updateChannel: DesktopUpdateChannel;
  readonly updateChannelConfiguredByUser: boolean;
  // Was a "local" | "wsl" swap mode in an earlier iteration of the WSL
  // integration. We now run Windows and WSL backends side by side, so the
  // setting is just whether the WSL backend should be running alongside the
  // primary. Persisted documents that still carry the legacy `wslMode: "wsl"`
  // value are migrated to `wslBackendEnabled: true` on load.
  readonly wslBackendEnabled: boolean;
  readonly wslDistro: string | null;
  readonly windows: readonly DesktopWindowRecord[];
  // When true (and wslBackendEnabled is also true) the desktop runs only
  // the WSL backend as the primary, and the Windows-side Node backend is
  // not started. Designed for users who develop entirely inside WSL and
  // don't want a second backend process running. Defaults to false so
  // existing setups stay on the parallel-backends behavior. Changing
  // this requires a desktop restart because the pool's primary spec is
  // chosen once at layer init.
  readonly wslOnly: boolean;
}

export interface DesktopSettingsChange {
  readonly settings: DesktopSettings;
  readonly changed: boolean;
}

const DEFAULT_TAILSCALE_SERVE_PORT = 443;
const MIN_MAIN_WINDOW_SIZE = {
  width: 840,
  height: 620,
} as const;
export const DesktopWindowBoundsSchema = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAIN_WINDOW_SIZE.width)),
  height: Schema.Int.check(Schema.isGreaterThanOrEqualTo(MIN_MAIN_WINDOW_SIZE.height)),
});
export type DesktopWindowBounds = typeof DesktopWindowBoundsSchema.Type;
export const DEFAULT_MAIN_WINDOW_SIZE = {
  width: 1100,
  height: 780,
} as const;

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  localEnvironmentEnabled: true,
  linuxPasswordStore: DEFAULT_LINUX_PASSWORD_STORE,
  mainWindowBounds: null,
  mainWindowMaximized: false,
  serverExposureMode: "local-only",
  tailscaleServeEnabled: false,
  tailscaleServePort: DEFAULT_TAILSCALE_SERVE_PORT,
  updateChannel: "latest",
  updateChannelConfiguredByUser: false,
  wslBackendEnabled: false,
  wslDistro: null,
  windows: [],
  wslOnly: false,
};

/** Guards against a corrupted document opening an unbounded number of windows. */
const MAX_PERSISTED_WINDOWS = 16;
const EMPTY_WINDOW_RECORD: DesktopWindowRecord = {
  bounds: null,
  maximized: false,
  scope: null,
};

const DesktopWindowBoundsDocument = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const DesktopSettingsDocument = Schema.Struct({
  localEnvironmentEnabled: Schema.optionalKey(Schema.Boolean),
  linuxPasswordStore: Schema.optionalKey(Schema.Unknown),
  mainWindowBounds: Schema.optionalKey(Schema.NullOr(DesktopWindowBoundsDocument)),
  mainWindowMaximized: Schema.optionalKey(Schema.Boolean),
  serverExposureMode: Schema.optionalKey(DesktopServerExposureModeSchema),
  tailscaleServeEnabled: Schema.optionalKey(Schema.Boolean),
  tailscaleServePort: Schema.optionalKey(Schema.Number),
  updateChannel: Schema.optionalKey(DesktopUpdateChannelSchema),
  updateChannelConfiguredByUser: Schema.optionalKey(Schema.Boolean),
  // Newer form of the WSL toggle. `wslMode` is still accepted on load so
  // existing on-disk settings keep working; on the next persist we write the
  // new boolean and the legacy key drops out.
  wslBackendEnabled: Schema.optionalKey(Schema.Boolean),
  wslMode: Schema.optionalKey(Schema.Literals(["local", "wsl"])),
  wslDistro: Schema.optionalKey(Schema.NullOr(Schema.String)),
  // Kept lenient on purpose: a malformed window list must cost the user their
  // window layout, not every other desktop setting in the document.
  windows: Schema.optionalKey(Schema.Unknown),
  wslOnly: Schema.optionalKey(Schema.Boolean),
});

type DesktopSettingsDocument = typeof DesktopSettingsDocument.Type;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const DesktopSettingsJson = fromLenientJson(DesktopSettingsDocument);
const decodeDesktopSettingsJson = Schema.decodeEffect(DesktopSettingsJson);
const encodeDesktopSettingsJson = Schema.encodeEffect(DesktopSettingsJson);
const decodeDesktopWindowBounds = Schema.decodeUnknownOption(DesktopWindowBoundsSchema);
const desktopWindowBoundsEquivalence = Schema.toEquivalence(DesktopWindowBoundsSchema);

const settingsChange = (settings: DesktopSettings, changed: boolean): DesktopSettingsChange => ({
  settings,
  changed,
});

const DesktopSettingsWriteOperation = Schema.Literals([
  "create-temporary-file-name",
  "encode-document",
  "create-directory",
  "write-temporary-file",
  "replace-settings-file",
]);
type DesktopSettingsWriteOperation = typeof DesktopSettingsWriteOperation.Type;

export class DesktopSettingsWriteError extends Schema.TaggedError<DesktopSettingsWriteError>()(
  "DesktopSettingsWriteError",
  {
    operation: DesktopSettingsWriteOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop settings write failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopAppSettings extends Context.Service<
  DesktopAppSettings,
  {
    readonly load: Effect.Effect<DesktopSettings>;
    readonly get: Effect.Effect<DesktopSettings>;
    readonly setLocalEnvironmentEnabled: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setMainWindowBounds: (
      bounds: DesktopWindowBounds,
      isMaximized: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    /**
     * Writes one window's restore record, extending the list with empty records
     * when a later window is persisted before an earlier one.
     */
    readonly setWindowRecord: (
      index: number,
      record: DesktopWindowRecord,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    /** Drops a closed window's record and re-indexes the ones behind it. */
    readonly removeWindowRecord: (
      index: number,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setServerExposureMode: (
      mode: DesktopServerExposureMode,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setTailscaleServe: (input: {
      readonly enabled: boolean;
      readonly port: Option.Option<number>;
    }) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setUpdateChannel: (
      channel: DesktopUpdateChannel,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslBackendEnabled: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslDistro: (
      distro: string | null,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly setWslOnly: (
      enabled: boolean,
    ) => Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError>;
    readonly applyWslWindowsFallback: Effect.Effect<
      DesktopSettingsChange,
      DesktopSettingsWriteError
    >;
    readonly applyWslWindowsFallbackInMemory: Effect.Effect<DesktopSettingsChange>;
  }
>()("@t3tools/desktop/settings/DesktopAppSettings") {}

export function resolveDefaultDesktopSettings(appVersion: string): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    updateChannel: resolveDefaultDesktopUpdateChannel(appVersion),
  };
}

function normalizeTailscaleServePort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65_535
    ? value
    : DEFAULT_TAILSCALE_SERVE_PORT;
}

function normalizeWslDistro(value: unknown): string | null {
  return typeof value === "string" && isValidDistroName(value) ? value : null;
}

export function normalizeMainWindowBounds(value: unknown): DesktopWindowBounds | null {
  return Option.getOrNull(decodeDesktopWindowBounds(value));
}

/**
 * Documents written before multi-window support only knew the main window, so
 * their saved bounds become the single restore record. Entries that are not
 * objects are dropped; an entry with unusable bounds keeps its place and opens
 * with default bounds, because the window itself is still worth restoring.
 */
function normalizeWindowRecords(
  value: unknown,
  legacy: DesktopWindowRecord,
): readonly DesktopWindowRecord[] {
  if (!Array.isArray(value)) {
    return legacy.bounds === null ? [] : [legacy];
  }
  const records: DesktopWindowRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const candidate = entry as {
      readonly bounds?: unknown;
      readonly maximized?: unknown;
      readonly scope?: unknown;
    };
    const bounds = normalizeMainWindowBounds(candidate.bounds);
    records.push({
      bounds,
      maximized: bounds !== null && candidate.maximized === true,
      scope: typeof candidate.scope === "string" ? candidate.scope : null,
    });
    if (records.length === MAX_PERSISTED_WINDOWS) break;
  }
  return records;
}

function normalizeDesktopSettingsDocument(
  parsed: DesktopSettingsDocument,
  appVersion: string,
): DesktopSettings {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);
  const mainWindowBounds = normalizeMainWindowBounds(parsed.mainWindowBounds);
  const parsedUpdateChannel = Option.fromNullishOr(parsed.updateChannel);
  const isLegacySettings = parsed.updateChannelConfiguredByUser === undefined;
  const updateChannelConfiguredByUser =
    parsed.updateChannelConfiguredByUser === true ||
    (isLegacySettings && Option.contains(parsedUpdateChannel, "nightly"));

  // Newer form wins when both are present; otherwise fall back to the legacy
  // `wslMode === "wsl"` signal so users coming off the swap-mode build keep
  // their WSL backend enabled.
  const wslBackendEnabled =
    parsed.wslBackendEnabled === true ||
    (parsed.wslBackendEnabled === undefined && parsed.wslMode === "wsl");

  const legacyWindowRecord: DesktopWindowRecord = {
    bounds: mainWindowBounds,
    maximized: mainWindowBounds !== null && parsed.mainWindowMaximized === true,
    scope: null,
  };
  const windows = normalizeWindowRecords(parsed.windows, legacyWindowRecord);
  const firstWindow = windows[0] ?? legacyWindowRecord;

  return {
    localEnvironmentEnabled: parsed.localEnvironmentEnabled !== false,
    linuxPasswordStore: normalizeLinuxPasswordStorePreference(parsed.linuxPasswordStore),
    mainWindowBounds: firstWindow.bounds,
    mainWindowMaximized: firstWindow.maximized,
    windows,
    serverExposureMode:
      parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
    tailscaleServeEnabled: parsed.tailscaleServeEnabled === true,
    tailscaleServePort: normalizeTailscaleServePort(parsed.tailscaleServePort),
    updateChannel: updateChannelConfiguredByUser
      ? Option.getOrElse(parsedUpdateChannel, () => defaultSettings.updateChannel)
      : defaultSettings.updateChannel,
    updateChannelConfiguredByUser,
    wslBackendEnabled,
    wslDistro: normalizeWslDistro(parsed.wslDistro),
    wslOnly: parsed.wslOnly === true,
  };
}

function toDesktopSettingsDocument(
  settings: DesktopSettings,
  defaults: DesktopSettings,
): DesktopSettingsDocument {
  const document: Mutable<DesktopSettingsDocument> = {};

  if (settings.localEnvironmentEnabled !== defaults.localEnvironmentEnabled) {
    document.localEnvironmentEnabled = settings.localEnvironmentEnabled;
  }

  if (settings.linuxPasswordStore !== defaults.linuxPasswordStore) {
    document.linuxPasswordStore = settings.linuxPasswordStore;
  }
  if (settings.mainWindowBounds !== null) {
    document.mainWindowBounds = settings.mainWindowBounds;
  }
  if (settings.mainWindowMaximized) {
    document.mainWindowMaximized = true;
  }
  if (settings.serverExposureMode !== defaults.serverExposureMode) {
    document.serverExposureMode = settings.serverExposureMode;
  }
  if (settings.tailscaleServeEnabled !== defaults.tailscaleServeEnabled) {
    document.tailscaleServeEnabled = settings.tailscaleServeEnabled;
  }
  if (settings.tailscaleServePort !== defaults.tailscaleServePort) {
    document.tailscaleServePort = settings.tailscaleServePort;
  }
  if (settings.updateChannel !== defaults.updateChannel) {
    document.updateChannel = settings.updateChannel;
  }
  if (settings.updateChannelConfiguredByUser !== defaults.updateChannelConfiguredByUser) {
    document.updateChannelConfiguredByUser = settings.updateChannelConfiguredByUser;
  }
  if (settings.wslBackendEnabled !== defaults.wslBackendEnabled) {
    document.wslBackendEnabled = settings.wslBackendEnabled;
  }
  if (settings.wslDistro !== defaults.wslDistro) {
    document.wslDistro = settings.wslDistro;
  }
  if (settings.wslOnly !== defaults.wslOnly) {
    document.wslOnly = settings.wslOnly;
  }
  if (settings.windows.length > 0) {
    document.windows = settings.windows;
  }

  return document;
}

function setServerExposureMode(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

function windowRecordsEqual(left: DesktopWindowRecord, right: DesktopWindowRecord): boolean {
  if (left.maximized !== right.maximized || left.scope !== right.scope) return false;
  if (left.bounds === null || right.bounds === null) return left.bounds === right.bounds;
  return desktopWindowBoundsEquivalence(left.bounds, right.bounds);
}

// Keeps `mainWindowBounds`/`mainWindowMaximized` mirroring record 0. With no
// records left (every window closed before quit) the last known main window
// bounds are kept, so the next launch still opens where the user left it.
function withWindowRecords(
  settings: DesktopSettings,
  windows: readonly DesktopWindowRecord[],
): DesktopSettings {
  const first = windows[0];
  return {
    ...settings,
    windows,
    mainWindowBounds: first?.bounds ?? settings.mainWindowBounds,
    mainWindowMaximized: first?.bounds == null ? settings.mainWindowMaximized : first.maximized,
  };
}

function setWindowRecord(
  settings: DesktopSettings,
  index: number,
  record: DesktopWindowRecord,
): DesktopSettings {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PERSISTED_WINDOWS) return settings;
  const existing = settings.windows[index];
  if (existing !== undefined && windowRecordsEqual(existing, record)) return settings;
  const windows = [...settings.windows];
  while (windows.length < index) windows.push(EMPTY_WINDOW_RECORD);
  windows[index] = record;
  return withWindowRecords(settings, windows);
}

function removeWindowRecord(settings: DesktopSettings, index: number): DesktopSettings {
  if (!Number.isInteger(index) || index < 0 || index >= settings.windows.length) return settings;
  return withWindowRecords(settings, settings.windows.toSpliced(index, 1));
}

function setMainWindowBounds(
  settings: DesktopSettings,
  bounds: DesktopWindowBounds,
  isMaximized: boolean,
): DesktopSettings {
  return setWindowRecord(settings, 0, {
    bounds,
    maximized: isMaximized,
    scope: settings.windows[0]?.scope ?? null,
  });
}

function setTailscaleServe(
  settings: DesktopSettings,
  input: { readonly enabled: boolean; readonly port: Option.Option<number> },
): DesktopSettings {
  const port = Option.match(input.port, {
    onNone: () => settings.tailscaleServePort,
    onSome: normalizeTailscaleServePort,
  });
  return settings.tailscaleServeEnabled === input.enabled && settings.tailscaleServePort === port
    ? settings
    : {
        ...settings,
        tailscaleServeEnabled: input.enabled,
        tailscaleServePort: port,
      };
}

function setUpdateChannel(
  settings: DesktopSettings,
  requestedChannel: DesktopUpdateChannel,
): DesktopSettings {
  return settings.updateChannel === requestedChannel
    ? settings
    : {
        ...settings,
        updateChannel: requestedChannel,
        updateChannelConfiguredByUser: true,
      };
}

function setWslBackendEnabled(settings: DesktopSettings, enabled: boolean): DesktopSettings {
  return settings.wslBackendEnabled === enabled
    ? settings
    : {
        ...settings,
        wslBackendEnabled: enabled,
      };
}

function setWslDistro(settings: DesktopSettings, distro: string | null): DesktopSettings {
  const normalized = normalizeWslDistro(distro);
  return settings.wslDistro === normalized
    ? settings
    : {
        ...settings,
        wslDistro: normalized,
      };
}

function setWslOnly(settings: DesktopSettings, enabled: boolean): DesktopSettings {
  return settings.wslOnly === enabled
    ? settings
    : {
        ...settings,
        wslOnly: enabled,
      };
}

function setLocalEnvironmentEnabled(settings: DesktopSettings, enabled: boolean): DesktopSettings {
  return settings.localEnvironmentEnabled === enabled
    ? settings
    : { ...settings, localEnvironmentEnabled: enabled };
}

function applyWslWindowsFallback(settings: DesktopSettings): DesktopSettings {
  return setWslOnly(setWslBackendEnabled(settings, false), false);
}

function readSettings(
  fileSystem: FileSystem.FileSystem,
  settingsPath: string,
  appVersion: string,
): Effect.Effect<DesktopSettings> {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);

  return fileSystem.readFileString(settingsPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(defaultSettings),
        onSome: (raw) =>
          decodeDesktopSettingsJson(raw).pipe(
            Effect.map((parsed) => normalizeDesktopSettingsDocument(parsed, appVersion)),
            Effect.orElseSucceed(() => defaultSettings),
          ),
      }),
    ),
  );
}

const writeSettings = Effect.fn("desktop.settings.writeSettings")(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly settings: DesktopSettings;
  readonly defaultSettings: DesktopSettings;
  readonly suffix: string;
}): Effect.fn.Return<void, DesktopSettingsWriteError> {
  const directory = input.path.dirname(input.settingsPath);
  const tempPath = `${input.settingsPath}.${process.pid}.${input.suffix}.tmp`;
  const encoded = yield* encodeDesktopSettingsJson(
    toDesktopSettingsDocument(input.settings, input.defaultSettings),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "encode-document",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.makeDirectory(directory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "create-directory",
          path: directory,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "write-temporary-file",
          path: tempPath,
          cause,
        }),
    ),
  );
  yield* input.fileSystem.rename(tempPath, input.settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSettingsWriteError({
          operation: "replace-settings-file",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const settingsRef = yield* SynchronizedRef.make(environment.defaultDesktopSettings);

  const updateInMemory = (update: (settings: DesktopSettings) => DesktopSettings) =>
    SynchronizedRef.modify(settingsRef, (settings) => {
      const nextSettings = update(settings);
      return [settingsChange(nextSettings, nextSettings !== settings), nextSettings] as const;
    });

  const persist = (
    update: (settings: DesktopSettings) => DesktopSettings,
  ): Effect.Effect<DesktopSettingsChange, DesktopSettingsWriteError> =>
    SynchronizedRef.modifyEffect(settingsRef, (settings) => {
      const nextSettings = update(settings);
      if (nextSettings === settings) {
        return Effect.succeed([settingsChange(settings, false), settings] as const);
      }

      return crypto.randomUUIDv4.pipe(
        Effect.map((uuid) => uuid.replace(/-/g, "")),
        Effect.mapError(
          (cause) =>
            new DesktopSettingsWriteError({
              operation: "create-temporary-file-name",
              path: environment.desktopSettingsPath,
              cause,
            }),
        ),
        Effect.flatMap((suffix) =>
          writeSettings({
            fileSystem,
            path,
            settingsPath: environment.desktopSettingsPath,
            settings: nextSettings,
            defaultSettings: environment.defaultDesktopSettings,
            suffix,
          }),
        ),
        Effect.as([settingsChange(nextSettings, true), nextSettings] as const),
      );
    });

  return DesktopAppSettings.of({
    get: SynchronizedRef.get(settingsRef),
    load: Effect.gen(function* () {
      const settings = yield* readSettings(
        fileSystem,
        environment.desktopSettingsPath,
        environment.appVersion,
      );
      return yield* SynchronizedRef.setAndGet(settingsRef, settings);
    }).pipe(Effect.withSpan("desktop.settings.load")),
    setMainWindowBounds: (bounds, isMaximized) =>
      persist((settings) => setMainWindowBounds(settings, bounds, isMaximized)).pipe(
        Effect.withSpan("desktop.settings.setMainWindowBounds", {
          attributes: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized,
          },
        }),
      ),
    setWindowRecord: (index, record) =>
      persist((settings) => setWindowRecord(settings, index, record)).pipe(
        Effect.withSpan("desktop.settings.setWindowRecord", {
          attributes: { index, maximized: record.maximized, hasScope: record.scope !== null },
        }),
      ),
    removeWindowRecord: (index) =>
      persist((settings) => removeWindowRecord(settings, index)).pipe(
        Effect.withSpan("desktop.settings.removeWindowRecord", { attributes: { index } }),
      ),
    setServerExposureMode: (mode) =>
      persist((settings) => setServerExposureMode(settings, mode)).pipe(
        Effect.withSpan("desktop.settings.setServerExposureMode", { attributes: { mode } }),
      ),
    setTailscaleServe: (input) =>
      persist((settings) => setTailscaleServe(settings, input)).pipe(
        Effect.withSpan("desktop.settings.setTailscaleServe", { attributes: input }),
      ),
    setUpdateChannel: (channel) =>
      persist((settings) => setUpdateChannel(settings, channel)).pipe(
        Effect.withSpan("desktop.settings.setUpdateChannel", { attributes: { channel } }),
      ),
    setWslBackendEnabled: (enabled) =>
      persist((settings) => setWslBackendEnabled(settings, enabled)).pipe(
        Effect.withSpan("desktop.settings.setWslBackendEnabled", { attributes: { enabled } }),
      ),
    setWslDistro: (distro) =>
      persist((settings) => setWslDistro(settings, distro)).pipe(
        Effect.withSpan("desktop.settings.setWslDistro", {
          attributes: { distro: distro ?? null },
        }),
      ),
    setWslOnly: (enabled) =>
      persist((settings) => setWslOnly(settings, enabled)).pipe(
        Effect.withSpan("desktop.settings.setWslOnly", { attributes: { enabled } }),
      ),
    setLocalEnvironmentEnabled: (enabled) =>
      persist((settings) => setLocalEnvironmentEnabled(settings, enabled)).pipe(
        Effect.withSpan("desktop.settings.setLocalEnvironmentEnabled", { attributes: { enabled } }),
      ),
    applyWslWindowsFallback: persist(applyWslWindowsFallback).pipe(
      Effect.withSpan("desktop.settings.applyWslWindowsFallback"),
    ),
    applyWslWindowsFallbackInMemory: updateInMemory(applyWslWindowsFallback).pipe(
      Effect.withSpan("desktop.settings.applyWslWindowsFallbackInMemory"),
    ),
  });
});

export const layer = Layer.effect(DesktopAppSettings, make);

export const layerTest = (initialSettings: DesktopSettings = DEFAULT_DESKTOP_SETTINGS) =>
  Layer.effect(
    DesktopAppSettings,
    Effect.gen(function* () {
      const settingsRef = yield* SynchronizedRef.make(initialSettings);
      const update = (f: (settings: DesktopSettings) => DesktopSettings) =>
        SynchronizedRef.modify(settingsRef, (settings) => {
          const nextSettings = f(settings);
          return [
            {
              settings: nextSettings,
              changed: nextSettings !== settings,
            },
            nextSettings,
          ] as const;
        });

      return DesktopAppSettings.of({
        get: SynchronizedRef.get(settingsRef),
        load: SynchronizedRef.get(settingsRef),
        setMainWindowBounds: (bounds, isMaximized) =>
          update((settings) => setMainWindowBounds(settings, bounds, isMaximized)),
        setWindowRecord: (index, record) =>
          update((settings) => setWindowRecord(settings, index, record)),
        removeWindowRecord: (index) => update((settings) => removeWindowRecord(settings, index)),
        setServerExposureMode: (mode) =>
          update((settings) => setServerExposureMode(settings, mode)),
        setTailscaleServe: (input) => update((settings) => setTailscaleServe(settings, input)),
        setUpdateChannel: (channel) => update((settings) => setUpdateChannel(settings, channel)),
        setWslBackendEnabled: (enabled) =>
          update((settings) => setWslBackendEnabled(settings, enabled)),
        setWslDistro: (distro) => update((settings) => setWslDistro(settings, distro)),
        setWslOnly: (enabled) => update((settings) => setWslOnly(settings, enabled)),
        setLocalEnvironmentEnabled: (enabled) =>
          update((settings) => setLocalEnvironmentEnabled(settings, enabled)),
        applyWslWindowsFallback: update(applyWslWindowsFallback),
        applyWslWindowsFallbackInMemory: update(applyWslWindowsFallback),
      });
    }),
  );
