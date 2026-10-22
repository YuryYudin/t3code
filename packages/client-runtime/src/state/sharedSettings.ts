import type {
  ExecutionEnvironmentCapabilities,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";
import * as Struct from "effect/Struct";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";

export type DedicatedServerSettingKey = "projectCollections";
type GenericServerSettingKey = Exclude<
  keyof ServerSettings & keyof ServerSettingsPatch,
  DedicatedServerSettingKey
>;

/** Server keys that hold a user preference rather than machine config. */
const SHARED_SERVER_SETTING_KEYS = [
  "continueThreadsAfterServerUpdate",
  "sidebarAutoSettleAfterDays",
  "sidebarAutoSettleOnMerge",
  "autoResumeLimitedThreads",
  "snoozeLimitedThreads",
  "newWorktreesStartFromOrigin",
  "sourceControlWritingStyle",
  "textGenerationModelSelection",
] as const satisfies ReadonlyArray<GenericServerSettingKey>;

export type SharedServerSettingKey = (typeof SHARED_SERVER_SETTING_KEYS)[number];
export type DedicatedServerSettingsPatch = Pick<ServerSettingsPatch, DedicatedServerSettingKey>;
export type GenericServerSettingsPatch = Omit<ServerSettingsPatch, DedicatedServerSettingKey>;

const SHARED_KEY_SET = new Set<string>(SHARED_SERVER_SETTING_KEYS);

/** Split a server patch into generic shared, primary-only, and dedicated acknowledged inputs. */
export function splitSharedServerPatch(patch: ServerSettingsPatch): {
  sharedPatch: GenericServerSettingsPatch;
  localPatch: GenericServerSettingsPatch;
  dedicatedPatch?: DedicatedServerSettingsPatch;
} {
  const sharedPatch: Record<string, unknown> = {};
  const localPatch: Record<string, unknown> = {};
  const dedicatedPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "projectCollections") {
      dedicatedPatch[key] = value;
    } else if (SHARED_KEY_SET.has(key)) {
      sharedPatch[key] = value;
    } else {
      localPatch[key] = value;
    }
  }
  return {
    sharedPatch: sharedPatch as GenericServerSettingsPatch,
    localPatch: localPatch as GenericServerSettingsPatch,
    ...(Object.keys(dedicatedPatch).length > 0
      ? { dedicatedPatch: dedicatedPatch as DedicatedServerSettingsPatch }
      : {}),
  };
}

export function filterSharedServerPatch(
  patch: ServerSettingsPatch,
  capabilities: Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation"> | undefined,
  settings?: ServerSettings,
  sourceSettings = settings,
  targetIsSource = false,
): GenericServerSettingsPatch {
  patch = Struct.omit(patch, ["projectCollections"]);
  const instanceId =
    patch.textGenerationModelSelection?.instanceId ??
    sourceSettings?.textGenerationModelSelection.instanceId;
  if (
    !targetIsSource &&
    patch.textGenerationModelSelection &&
    (!settings ||
      (instanceId !== undefined &&
        (sourceSettings?.providerInstances[instanceId]?.driver ?? instanceId) !==
          (settings.providerInstances[instanceId]?.driver ?? instanceId)) ||
      !isModelSelectionProviderEnabled(settings, {
        ...settings.textGenerationModelSelection,
        ...patch.textGenerationModelSelection,
      }))
  ) {
    patch = Struct.omit(patch, ["textGenerationModelSelection"]);
  }
  return capabilities?.threadRestartContinuation === true
    ? patch
    : Struct.omit(patch, ["continueThreadsAfterServerUpdate"]);
}

export function pickSharedServerSettings(
  settings: ServerSettings,
  capabilities?: Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation">,
): GenericServerSettingsPatch {
  return filterSharedServerPatch(
    Struct.pick(settings, SHARED_SERVER_SETTING_KEYS),
    capabilities,
    settings,
  );
}

export function supportsSharedSettingsSync(environment: {
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "threadAutoSettlement">;
    };
  } | null;
}): boolean {
  return (
    environment.connection.phase === "connected" &&
    environment.serverConfig?.environment.capabilities.threadAutoSettlement === true
  );
}
