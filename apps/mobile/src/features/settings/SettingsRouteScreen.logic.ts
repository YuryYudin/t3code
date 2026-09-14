import {
  filterSharedServerPatch,
  splitSharedServerPatch,
  type GenericServerSettingsPatch,
} from "@t3tools/client-runtime/state/shared-settings";
import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";

import type { ProjectCollectionsView } from "../projects/useProjectCollections";

export function resolveAgentAwarenessPlatformPresentation(platform: string): {
  readonly supported: boolean;
  readonly subtitle: string | undefined;
} {
  return platform === "ios" || platform === "android"
    ? { supported: true, subtitle: undefined }
    : { supported: false, subtitle: "Unavailable on this platform" };
}

export interface ProjectCollectionsSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: { readonly phase: string };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: Pick<ExecutionEnvironmentCapabilities, "projectCollections">;
    };
  } | null;
}

export interface ProjectCollectionsSettingsModel {
  readonly availability: "available" | "older-only" | "unavailable";
  readonly referenceLabel: string | null;
  readonly mismatchLabels: ReadonlyArray<string>;
  readonly statusMessage: string | null;
  readonly statusDescription: string | null;
  readonly showRetry: boolean;
  readonly showUseThisLayoutEverywhere: boolean;
  readonly actionsDisabled: boolean;
}

export function planProjectCollectionsSettings(input: {
  readonly view: ProjectCollectionsView;
  readonly environments: ReadonlyArray<ProjectCollectionsSettingsEnvironment>;
}): ProjectCollectionsSettingsModel {
  const environmentById = new Map(
    input.environments.map((environment) => [environment.environmentId, environment] as const),
  );
  const eligibleEnvironmentIds = new Set(input.view.eligibleEnvironmentIds);
  const mismatchLabels = input.view.mismatchEnvironmentIds.flatMap((environmentId) => {
    const environment = environmentById.get(environmentId);
    return environment !== undefined &&
      environmentId !== input.view.referenceEnvironmentId &&
      eligibleEnvironmentIds.has(environmentId) &&
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.projectCollections === true
      ? [environment.label]
      : [];
  });
  const available = input.view.document !== null && input.view.referenceEnvironmentId !== null;
  const olderOnly =
    !available &&
    input.environments.length > 0 &&
    input.environments.every(
      (environment) =>
        environment.serverConfig !== null &&
        environment.serverConfig.environment.capabilities.projectCollections !== true,
    );
  const referenceLabel =
    input.view.referenceLabel ??
    (input.view.referenceEnvironmentId === null
      ? null
      : (environmentById.get(input.view.referenceEnvironmentId)?.label ?? null));
  const statusMessage =
    input.view.phase === "saving-reference"
      ? `Saving to ${referenceLabel ?? "the reference environment"}…`
      : input.view.phase === "saving-secondaries"
        ? (input.view.status.message ?? "Updating connected environments…")
        : (input.view.status.message ??
          (mismatchLabels.length > 0
            ? `Collections differ on ${mismatchLabels.join(", ")}`
            : null));
  const statusDescription =
    input.view.phase === "not-saved" && input.view.rejectedCandidate !== null
      ? "Your attempted layout is ready to retry."
      : input.view.phase === "partial"
        ? "The reference layout is saved, but some environments still differ."
        : null;

  return {
    availability: available ? "available" : olderOnly ? "older-only" : "unavailable",
    referenceLabel,
    mismatchLabels,
    statusMessage,
    statusDescription,
    showRetry: available && (input.view.phase === "not-saved" || input.view.phase === "partial"),
    showUseThisLayoutEverywhere: available && mismatchLabels.length > 0,
    actionsDisabled: !input.view.canMutate,
  };
}

interface GenericSettingsFanoutTarget {
  readonly environmentId: EnvironmentId;
  readonly capabilities:
    | Pick<ExecutionEnvironmentCapabilities, "threadRestartContinuation">
    | undefined;
  readonly settings: ServerSettings | undefined;
}

export function planGenericSharedSettingsFanout(input: {
  readonly patch: ServerSettingsPatch;
  readonly targets: ReadonlyArray<GenericSettingsFanoutTarget>;
  readonly sourceSettings?: ServerSettings;
}): ReadonlyArray<{
  readonly environmentId: EnvironmentId;
  readonly patch: GenericServerSettingsPatch;
}> {
  const genericPatch = splitSharedServerPatch(input.patch).sharedPatch;
  return input.targets.flatMap((target) => {
    const patch = filterSharedServerPatch(
      genericPatch,
      target.capabilities,
      target.settings,
      input.sourceSettings,
    );
    return Object.keys(patch).length === 0 ? [] : [{ environmentId: target.environmentId, patch }];
  });
}
