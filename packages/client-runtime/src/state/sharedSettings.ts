/**
 * Shared server settings.
 *
 * Every server keeps its own `settings.json`, but some keys are user
 * preferences that only live on the server because the server has to act on
 * them (auto-settlement runs with no client attached). A user does not want
 * those to differ per machine. Clients write these keys to every shared-settings
 * sync target, and warn when another target still holds a different value so
 * the user can push their current value out.
 */
import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";
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
  "newWorktreesStartFromOrigin",
  "sourceControlWritingStyle",
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

/** Omit restart recovery on servers that cannot persist its preference. */
export function filterSharedServerPatch(
  patch: ServerSettingsPatch,
  capabilities: Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation"> | undefined,
): GenericServerSettingsPatch {
  patch = Struct.omit(patch, ["projectCollections"]);
  return capabilities?.threadRestartContinuation === true
    ? patch
    : Struct.omit(patch, ["continueThreadsAfterServerUpdate"]);
}

/** The shared subset supported by one environment. */
export function pickSharedServerSettings(
  settings: ServerSettings,
  capabilities?: Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation">,
): GenericServerSettingsPatch {
  return filterSharedServerPatch(Struct.pick(settings, SHARED_SERVER_SETTING_KEYS), capabilities);
}

/**
 * Whether an environment can participate in shared-settings sync right now.
 * Auto-settlement establishes baseline support; newer preferences are filtered separately.
 */
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

export interface SharedSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly syncEligible: boolean;
  readonly settings: ServerSettings | null;
  readonly capabilities?:
    | Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation">
    | undefined;
}

/**
 * Shared-settings sync targets whose values differ from the primary
 * environment's. Other environments are skipped: nothing can be read from or
 * written to them, or their server lacks baseline shared-settings support. With no
 * primary settings loaded there is nothing to compare against, so nothing is
 * reported. Callers must pass the real loaded settings, never a default
 * fallback, or "apply to all" would push defaults over real values.
 */
export function findSharedSettingsMismatches(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primarySettings: ServerSettings | null;
  readonly primaryCapabilities?:
    | Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation">
    | undefined;
  readonly environments: ReadonlyArray<SharedSettingsEnvironment>;
}): ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }> {
  if (input.primaryEnvironmentId === null || input.primarySettings === null) {
    return [];
  }
  const primarySettings = pickSharedServerSettings(
    input.primarySettings,
    input.primaryCapabilities,
  );
  return input.environments.flatMap((environment) => {
    if (
      environment.environmentId === input.primaryEnvironmentId ||
      !environment.syncEligible ||
      environment.settings === null
    ) {
      return [];
    }
    const expected = filterSharedServerPatch(primarySettings, environment.capabilities);
    const actual = filterSharedServerPatch(
      pickSharedServerSettings(environment.settings, environment.capabilities),
      input.primaryCapabilities,
    );
    return Equal.equals(actual, expected)
      ? []
      : [{ environmentId: environment.environmentId, label: environment.label }];
  });
}
