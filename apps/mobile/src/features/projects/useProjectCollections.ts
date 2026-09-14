import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  beginProjectCollectionsMutation,
  createProjectCollectionsSyncState,
  planProjectCollectionsReconciliation,
  planProjectCollectionsSyncRetry,
  reduceProjectCollectionsWriteResult,
  refreshProjectCollectionsSyncState,
  summarizeProjectCollectionsSyncState,
  type ProjectCollectionsSyncEnvironment,
  type ProjectCollectionsSyncState,
  type ProjectCollectionsSyncStatus,
  type ProjectCollectionsSyncTransition,
  type ProjectCollectionsSyncWrite,
  type ProjectCollectionsWriteResult,
} from "@t3tools/client-runtime/state/project-collections-sync";
import {
  validateProjectCollectionsDocument,
  type ProjectCollectionMutationResult,
} from "@t3tools/client-runtime/state/project-collections";
import type { EnvironmentId } from "@t3tools/contracts";
import type { ProjectCollectionsDocument } from "@t3tools/contracts/settings";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

type ProjectCollectionsWriteOutcome = ProjectCollectionsWriteResult["outcome"];

interface ProjectCollectionsControllerHandlers {
  readonly persistPreferredReferenceEnvironmentId: (environmentId: EnvironmentId | null) => void;
  readonly persistWrite: (
    write: ProjectCollectionsSyncWrite,
  ) => Promise<ProjectCollectionsWriteOutcome>;
  readonly onStateChange?: (state: ProjectCollectionsSyncState) => void;
}

export interface ProjectCollectionsController {
  readonly getState: () => ProjectCollectionsSyncState;
  readonly getStatus: () => ProjectCollectionsSyncStatus;
  readonly setHandlers: (handlers: ProjectCollectionsControllerHandlers) => void;
  readonly setActive: (active: boolean) => void;
  readonly refresh: (input: {
    readonly preferredReferenceEnvironmentId: EnvironmentId | null;
    readonly environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>;
    /** Preferences can render before their persisted value is loaded. */
    readonly persistSelection?: boolean;
  }) => void;
  readonly save: (
    document: ProjectCollectionsDocument,
  ) => ProjectCollectionMutationResult<ProjectCollectionsDocument>;
  readonly retry: () => void;
  readonly reconcile: () => void;
}

export function createProjectCollectionsController(
  input: {
    readonly preferredReferenceEnvironmentId: EnvironmentId | null;
    readonly environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>;
  } & ProjectCollectionsControllerHandlers,
): ProjectCollectionsController {
  let environments = input.environments;
  let observedPreferredReferenceEnvironmentId = input.preferredReferenceEnvironmentId;
  let handlers: ProjectCollectionsControllerHandlers = input;
  let active = true;
  let state = createProjectCollectionsSyncState({
    preferredReferenceEnvironmentId: input.preferredReferenceEnvironmentId,
    primaryEnvironmentId: null,
    environments,
  });
  const writeGenerationByEnvironment = new Map<EnvironmentId, number>();

  const publish = (nextState: ProjectCollectionsSyncState, persistSelection = true) => {
    state = nextState;
    if (!active) return;
    handlers.onStateChange?.(state);
    if (
      persistSelection &&
      state.preferredReferenceEnvironmentId !== observedPreferredReferenceEnvironmentId
    ) {
      observedPreferredReferenceEnvironmentId = state.preferredReferenceEnvironmentId;
      handlers.persistPreferredReferenceEnvironmentId(state.preferredReferenceEnvironmentId);
    }
  };

  const reduceWrite = (
    write: ProjectCollectionsSyncWrite,
    generation: number,
    outcome: ProjectCollectionsWriteOutcome,
  ) => {
    if (!active || writeGenerationByEnvironment.get(write.environmentId) !== generation) return;
    runTransition(
      reduceProjectCollectionsWriteResult(
        state,
        { environmentId: write.environmentId, outcome },
        environments,
      ),
    );
  };

  const runTransition = (transition: ProjectCollectionsSyncTransition) => {
    publish(transition.state);
    for (const write of transition.writes) {
      const generation = (writeGenerationByEnvironment.get(write.environmentId) ?? 0) + 1;
      writeGenerationByEnvironment.set(write.environmentId, generation);
      void handlers.persistWrite(write).then(
        (outcome) => reduceWrite(write, generation, outcome),
        () => reduceWrite(write, generation, "rejected"),
      );
    }
  };

  return {
    getState: () => state,
    getStatus: () => summarizeProjectCollectionsSyncState(state),
    setHandlers: (nextHandlers) => {
      handlers = nextHandlers;
    },
    setActive: (nextActive) => {
      active = nextActive;
    },
    refresh: (next) => {
      environments = next.environments;
      observedPreferredReferenceEnvironmentId = next.preferredReferenceEnvironmentId;
      const refreshed =
        state.preferredReferenceEnvironmentId === next.preferredReferenceEnvironmentId
          ? refreshProjectCollectionsSyncState(state, {
              primaryEnvironmentId: null,
              environments,
            })
          : createProjectCollectionsSyncState({
              preferredReferenceEnvironmentId: next.preferredReferenceEnvironmentId,
              primaryEnvironmentId: null,
              environments,
            });
      publish(refreshed, next.persistSelection ?? true);
    },
    save: (document) => {
      const result = validateProjectCollectionsDocument(document);
      if (!result.ok) return result;
      runTransition(beginProjectCollectionsMutation(state, result.value, environments));
      return result;
    },
    retry: () => {
      runTransition(planProjectCollectionsSyncRetry(state, environments));
    },
    reconcile: () => {
      runTransition(planProjectCollectionsReconciliation(state, environments));
    },
  };
}

export interface ProjectCollectionsView {
  readonly document: ProjectCollectionsDocument | null;
  readonly confirmedDocument: ProjectCollectionsDocument | null;
  readonly optimisticDocument: ProjectCollectionsDocument | null;
  readonly rejectedCandidate: ProjectCollectionsDocument | null;
  readonly phase: ProjectCollectionsSyncState["phase"];
  readonly status: ProjectCollectionsSyncStatus;
  readonly referenceEnvironmentId: EnvironmentId | null;
  readonly referenceLabel: string | null;
  readonly eligibleEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly mismatchEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly canMutate: boolean;
  readonly save: (
    document: ProjectCollectionsDocument,
  ) => ProjectCollectionMutationResult<ProjectCollectionsDocument>;
  readonly retry: () => void;
  readonly useThisLayoutEverywhere: () => void;
}

function asSyncEnvironments(
  environments: ReturnType<typeof useEnvironments>["environments"],
): ReadonlyArray<ProjectCollectionsSyncEnvironment> {
  return environments.map((environment) => ({
    environmentId: environment.environmentId,
    connection: environment.connection,
    capabilities: environment.serverConfig?.environment.capabilities,
    document: environment.serverConfig?.settings.projectCollections ?? null,
  }));
}

export function useProjectCollections(): ProjectCollectionsView {
  const { environments: presentedEnvironments } = useEnvironments();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const persistSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "project collections update",
    reportFailure: false,
  });
  const environments = useMemo(
    () => asSyncEnvironments(presentedEnvironments),
    [presentedEnvironments],
  );
  const preferencesLoaded = AsyncResult.isSuccess(preferencesResult);
  const preferredReferenceEnvironmentId = preferencesLoaded
    ? (preferencesResult.value.projectCollectionsPreferredReferenceEnvironmentId ?? null)
    : null;
  const persistPreferredReferenceEnvironmentId = useCallback(
    (environmentId: EnvironmentId | null) => {
      savePreferences({ projectCollectionsPreferredReferenceEnvironmentId: environmentId });
    },
    [savePreferences],
  );
  const persistWrite = useCallback(
    async (write: ProjectCollectionsSyncWrite): Promise<ProjectCollectionsWriteOutcome> => {
      const result = await persistSettings({
        environmentId: write.environmentId,
        input: { patch: { projectCollections: write.document } },
      });
      return result._tag === "Success" ? "acknowledged" : "rejected";
    },
    [persistSettings],
  );
  const [syncState, setSyncState] = useState(() =>
    createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId,
      primaryEnvironmentId: null,
      environments,
    }),
  );
  const [controller] = useState(() =>
    createProjectCollectionsController({
      preferredReferenceEnvironmentId,
      environments,
      persistPreferredReferenceEnvironmentId,
      persistWrite,
      onStateChange: setSyncState,
    }),
  );
  controller.setHandlers({
    persistPreferredReferenceEnvironmentId,
    persistWrite,
    onStateChange: setSyncState,
  });

  useEffect(() => {
    controller.setActive(true);
    return () => controller.setActive(false);
  }, [controller]);

  useEffect(() => {
    controller.refresh({
      preferredReferenceEnvironmentId,
      environments,
      persistSelection: preferencesLoaded,
    });
  }, [controller, environments, preferredReferenceEnvironmentId, preferencesLoaded]);

  const save = useCallback(
    (document: ProjectCollectionsDocument) => controller.save(document),
    [controller],
  );
  const retry = useCallback(() => controller.retry(), [controller]);
  const useThisLayoutEverywhere = useCallback(() => controller.reconcile(), [controller]);

  return useMemo(
    () => ({
      document: syncState.displayedDocument,
      confirmedDocument: syncState.confirmedDocument,
      optimisticDocument: syncState.optimisticDocument,
      rejectedCandidate: syncState.rejectedCandidate,
      phase: syncState.phase,
      status: summarizeProjectCollectionsSyncState(syncState),
      referenceEnvironmentId: syncState.referenceEnvironmentId,
      referenceLabel:
        presentedEnvironments.find(
          (environment) => environment.environmentId === syncState.referenceEnvironmentId,
        )?.label ?? null,
      eligibleEnvironmentIds: syncState.eligibleEnvironmentIds,
      mismatchEnvironmentIds: syncState.mismatchEnvironmentIds,
      canMutate:
        syncState.referenceEnvironmentId !== null &&
        syncState.confirmedDocument !== null &&
        syncState.pendingEnvironmentIds.length === 0,
      save,
      retry,
      useThisLayoutEverywhere,
    }),
    [presentedEnvironments, retry, save, syncState, useThisLayoutEverywhere],
  );
}
