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
  type ProjectCollectionsSyncTransition,
} from "@t3tools/client-runtime/state/project-collections-sync";
import {
  validateProjectCollectionsDocument,
  type ProjectCollectionMutationResult,
} from "@t3tools/client-runtime/state/project-collections";
import type { EnvironmentId, ProjectCollectionsDocument } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { serverEnvironment } from "~/state/server";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { useUiStateStore } from "~/uiStateStore";
import { useStableCallback } from "./useStableCallback";

export interface ProjectCollectionsView {
  readonly document: ProjectCollectionsDocument | null;
  readonly confirmedDocument: ProjectCollectionsDocument | null;
  readonly optimisticDocument: ProjectCollectionsDocument | null;
  readonly rejectedCandidate: ProjectCollectionsDocument | null;
  readonly phase: ProjectCollectionsSyncState["phase"];
  readonly status: ReturnType<typeof summarizeProjectCollectionsSyncState>;
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
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const preferredReferenceEnvironmentId = useUiStateStore(
    (state) => state.projectCollectionsPreferredReferenceEnvironmentId,
  );
  const setPreferredReferenceEnvironmentId = useUiStateStore(
    (state) => state.setProjectCollectionsPreferredReferenceEnvironmentId,
  );
  const persistSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "project collections update",
    reportFailure: false,
  });
  const environments = asSyncEnvironments(presentedEnvironments);
  const environmentsRef = useRef(environments);
  const [syncState, setSyncState] = useState(() =>
    createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId,
      primaryEnvironmentId,
      environments,
    }),
  );
  const syncStateRef = useRef(syncState);
  const mountedRef = useRef(true);
  const writeGenerationByEnvironmentRef = useRef(new Map<EnvironmentId, number>());

  const persistReferenceSelection = useStableCallback((state: ProjectCollectionsSyncState) => {
    if (state.preferredReferenceEnvironmentId !== preferredReferenceEnvironmentId) {
      setPreferredReferenceEnvironmentId(state.preferredReferenceEnvironmentId);
    }
  });

  const runTransition = (initialTransition: ProjectCollectionsSyncTransition) => {
    const process = (transition: ProjectCollectionsSyncTransition) => {
      syncStateRef.current = transition.state;
      if (mountedRef.current) {
        setSyncState(transition.state);
        persistReferenceSelection(transition.state);
      }
      for (const write of transition.writes) {
        const generation =
          (writeGenerationByEnvironmentRef.current.get(write.environmentId) ?? 0) + 1;
        writeGenerationByEnvironmentRef.current.set(write.environmentId, generation);
        void persistSettings({
          environmentId: write.environmentId,
          input: { patch: { projectCollections: write.document } },
        }).then((result) => {
          if (writeGenerationByEnvironmentRef.current.get(write.environmentId) !== generation) {
            return;
          }
          process(
            reduceProjectCollectionsWriteResult(
              syncStateRef.current,
              {
                environmentId: write.environmentId,
                outcome: result._tag === "Success" ? "acknowledged" : "rejected",
              },
              environmentsRef.current,
            ),
          );
        });
      }
    };
    process(initialTransition);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const environments = asSyncEnvironments(presentedEnvironments);
    environmentsRef.current = environments;
    const current = syncStateRef.current;
    const refreshed =
      current.preferredReferenceEnvironmentId === preferredReferenceEnvironmentId
        ? refreshProjectCollectionsSyncState(current, { primaryEnvironmentId, environments })
        : createProjectCollectionsSyncState({
            preferredReferenceEnvironmentId,
            primaryEnvironmentId,
            environments,
          });
    syncStateRef.current = refreshed;
    setSyncState(refreshed);
    persistReferenceSelection(refreshed);
  }, [
    presentedEnvironments,
    preferredReferenceEnvironmentId,
    primaryEnvironmentId,
    persistReferenceSelection,
  ]);

  const save = (document: ProjectCollectionsDocument) => {
    const result = validateProjectCollectionsDocument(document);
    if (!result.ok) return result;
    runTransition(
      beginProjectCollectionsMutation(syncStateRef.current, result.value, environmentsRef.current),
    );
    return result;
  };

  const retry = () => {
    runTransition(planProjectCollectionsSyncRetry(syncStateRef.current, environmentsRef.current));
  };

  const applyLayoutEverywhere = () => {
    runTransition(
      planProjectCollectionsReconciliation(syncStateRef.current, environmentsRef.current),
    );
  };

  return {
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
    useThisLayoutEverywhere: applyLayoutEverywhere,
  };
}
