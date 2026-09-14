import type {
  EnvironmentId,
  ExecutionEnvironmentCapabilities,
  ProjectCollectionsDocument,
} from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";

export interface ProjectCollectionsSyncEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly capabilities:
    | Pick<ExecutionEnvironmentCapabilities, "projectCollections">
    | null
    | undefined;
  /** Null until this environment's real settings document has loaded. */
  readonly document: ProjectCollectionsDocument | null;
}

export interface ProjectCollectionsReferenceSelection {
  readonly referenceEnvironmentId: EnvironmentId | null;
  /** The value the client should persist as its device-local preference. */
  readonly preferredReferenceEnvironmentId: EnvironmentId | null;
}

export type ProjectCollectionsSyncPhase =
  | "idle"
  | "saving-reference"
  | "saving-secondaries"
  | "saved"
  | "partial"
  | "not-saved";

export interface ProjectCollectionsSyncState {
  readonly phase: ProjectCollectionsSyncPhase;
  readonly referenceEnvironmentId: EnvironmentId | null;
  readonly preferredReferenceEnvironmentId: EnvironmentId | null;
  readonly confirmedDocument: ProjectCollectionsDocument | null;
  readonly displayedDocument: ProjectCollectionsDocument | null;
  readonly optimisticDocument: ProjectCollectionsDocument | null;
  readonly rejectedCandidate: ProjectCollectionsDocument | null;
  readonly eligibleEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly pendingEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly savedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly failedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly mismatchEnvironmentIds: ReadonlyArray<EnvironmentId>;
}

export interface ProjectCollectionsSyncWrite {
  readonly environmentId: EnvironmentId;
  readonly document: ProjectCollectionsDocument;
}

export interface ProjectCollectionsSyncTransition {
  readonly state: ProjectCollectionsSyncState;
  /** Writes in one transition are independent and may run concurrently. */
  readonly writes: ReadonlyArray<ProjectCollectionsSyncWrite>;
}

export interface ProjectCollectionsWriteResult {
  readonly environmentId: EnvironmentId;
  readonly outcome: "acknowledged" | "rejected";
}

export interface ProjectCollectionsSyncStatus {
  readonly phase: ProjectCollectionsSyncPhase;
  readonly savedCount: number;
  readonly eligibleCount: number;
  readonly message: string | null;
}

export function summarizeProjectCollectionsSyncState(
  state: ProjectCollectionsSyncState,
): ProjectCollectionsSyncStatus {
  const savedCount = state.savedEnvironmentIds.length;
  const eligibleCount = state.eligibleEnvironmentIds.length;
  const savedMessage = `Saved on ${savedCount} of ${eligibleCount} environments`;
  return {
    phase: state.phase,
    savedCount,
    eligibleCount,
    message:
      state.phase === "not-saved"
        ? "Not saved"
        : state.phase === "partial" ||
            state.phase === "saving-secondaries" ||
            state.phase === "saved"
          ? savedMessage
          : null,
  };
}

function sortEnvironmentIds(ids: Iterable<EnvironmentId>): ReadonlyArray<EnvironmentId> {
  return [...new Set(ids)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

type EligibleProjectCollectionsSyncEnvironment = ProjectCollectionsSyncEnvironment & {
  readonly document: ProjectCollectionsDocument;
};

function isEligibleEnvironment(
  environment: ProjectCollectionsSyncEnvironment,
): environment is EligibleProjectCollectionsSyncEnvironment {
  return (
    environment.connection.phase === "connected" &&
    environment.capabilities?.projectCollections === true &&
    environment.document !== null
  );
}

export function getEligibleProjectCollectionsSyncEnvironments(
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ReadonlyArray<EligibleProjectCollectionsSyncEnvironment> {
  return environments
    .filter(isEligibleEnvironment)
    .sort((left, right) =>
      left.environmentId < right.environmentId
        ? -1
        : left.environmentId > right.environmentId
          ? 1
          : 0,
    );
}

export function selectProjectCollectionsReference(input: {
  readonly preferredReferenceEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>;
}): ProjectCollectionsReferenceSelection {
  const eligible = getEligibleProjectCollectionsSyncEnvironments(input.environments);
  const eligibleIds = new Set(eligible.map(({ environmentId }) => environmentId));
  const referenceEnvironmentId =
    (input.preferredReferenceEnvironmentId !== null &&
    eligibleIds.has(input.preferredReferenceEnvironmentId)
      ? input.preferredReferenceEnvironmentId
      : null) ??
    (input.primaryEnvironmentId !== null && eligibleIds.has(input.primaryEnvironmentId)
      ? input.primaryEnvironmentId
      : null) ??
    eligible[0]?.environmentId ??
    null;

  return {
    referenceEnvironmentId,
    preferredReferenceEnvironmentId:
      referenceEnvironmentId ?? input.preferredReferenceEnvironmentId,
  };
}

function documentsEqual(
  left: ProjectCollectionsDocument,
  right: ProjectCollectionsDocument,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function partitionByDocument(
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
  document: ProjectCollectionsDocument,
): {
  readonly matching: ReadonlyArray<EnvironmentId>;
  readonly mismatching: ReadonlyArray<EnvironmentId>;
} {
  const matching: EnvironmentId[] = [];
  const mismatching: EnvironmentId[] = [];
  for (const environment of getEligibleProjectCollectionsSyncEnvironments(environments)) {
    (documentsEqual(environment.document, document) ? matching : mismatching).push(
      environment.environmentId,
    );
  }
  return { matching, mismatching };
}

export function createProjectCollectionsSyncState(input: {
  readonly preferredReferenceEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>;
}): ProjectCollectionsSyncState {
  const selection = selectProjectCollectionsReference(input);
  const eligibleEnvironmentIds = getEligibleProjectCollectionsSyncEnvironments(
    input.environments,
  ).map(({ environmentId }) => environmentId);
  const confirmedDocument =
    input.environments.find(
      ({ environmentId }) => environmentId === selection.referenceEnvironmentId,
    )?.document ?? null;
  const comparison =
    confirmedDocument === null
      ? {
          matching: [] as ReadonlyArray<EnvironmentId>,
          mismatching: [] as ReadonlyArray<EnvironmentId>,
        }
      : partitionByDocument(input.environments, confirmedDocument);

  return {
    phase: comparison.mismatching.length > 0 ? "partial" : "idle",
    ...selection,
    confirmedDocument,
    displayedDocument: confirmedDocument,
    optimisticDocument: null,
    rejectedCandidate: null,
    eligibleEnvironmentIds,
    pendingEnvironmentIds: [],
    savedEnvironmentIds: comparison.matching,
    failedEnvironmentIds: [],
    mismatchEnvironmentIds: comparison.mismatching,
  };
}

export function refreshProjectCollectionsSyncState(
  state: ProjectCollectionsSyncState,
  input: {
    readonly primaryEnvironmentId: EnvironmentId | null;
    readonly environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>;
  },
): ProjectCollectionsSyncState {
  const eligibleEnvironments = getEligibleProjectCollectionsSyncEnvironments(input.environments);
  const eligibleEnvironmentIds = eligibleEnvironments.map(({ environmentId }) => environmentId);
  const eligibleSet = new Set(eligibleEnvironmentIds);
  const isActive = state.phase === "saving-reference" || state.phase === "saving-secondaries";
  const referenceRemainsEligible =
    state.referenceEnvironmentId !== null && eligibleSet.has(state.referenceEnvironmentId);

  if (isActive && referenceRemainsEligible) {
    const previousEligibleSet = new Set(state.eligibleEnvironmentIds);
    const pendingEnvironmentIds = state.pendingEnvironmentIds.filter((environmentId) =>
      eligibleSet.has(environmentId),
    );
    const savedEnvironmentIds = new Set(
      state.savedEnvironmentIds.filter((environmentId) => eligibleSet.has(environmentId)),
    );
    const failedEnvironmentIds = state.failedEnvironmentIds.filter((environmentId) =>
      eligibleSet.has(environmentId),
    );
    const mismatchEnvironmentIds = new Set(
      state.mismatchEnvironmentIds.filter((environmentId) => eligibleSet.has(environmentId)),
    );

    if (state.confirmedDocument !== null) {
      for (const environment of eligibleEnvironments) {
        if (previousEligibleSet.has(environment.environmentId)) continue;
        if (documentsEqual(environment.document, state.confirmedDocument)) {
          savedEnvironmentIds.add(environment.environmentId);
        } else {
          mismatchEnvironmentIds.add(environment.environmentId);
        }
      }
    }

    const mismatchIds = sortEnvironmentIds(mismatchEnvironmentIds);
    const phase =
      state.phase === "saving-reference" && pendingEnvironmentIds.length > 0
        ? "saving-reference"
        : pendingEnvironmentIds.length > 0
          ? "saving-secondaries"
          : mismatchIds.length > 0
            ? "partial"
            : "saved";
    return {
      ...state,
      phase,
      eligibleEnvironmentIds,
      pendingEnvironmentIds,
      savedEnvironmentIds: sortEnvironmentIds(savedEnvironmentIds),
      failedEnvironmentIds,
      mismatchEnvironmentIds: mismatchIds,
    };
  }

  const fresh = createProjectCollectionsSyncState({
    preferredReferenceEnvironmentId: state.preferredReferenceEnvironmentId,
    primaryEnvironmentId: input.primaryEnvironmentId,
    environments: input.environments,
  });
  const rejectedCandidate =
    state.optimisticDocument ??
    state.rejectedCandidate ??
    (isActive ? state.confirmedDocument : null);
  return rejectedCandidate === null ? fresh : { ...fresh, phase: "not-saved", rejectedCandidate };
}

function noWrites(state: ProjectCollectionsSyncState): ProjectCollectionsSyncTransition {
  return { state, writes: [] };
}

export function beginProjectCollectionsMutation(
  state: ProjectCollectionsSyncState,
  candidate: ProjectCollectionsDocument,
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ProjectCollectionsSyncTransition {
  const eligibleEnvironmentIds = getEligibleProjectCollectionsSyncEnvironments(environments).map(
    ({ environmentId }) => environmentId,
  );
  const referenceEnvironmentId = state.referenceEnvironmentId;
  if (
    state.pendingEnvironmentIds.length > 0 ||
    referenceEnvironmentId === null ||
    state.confirmedDocument === null ||
    !eligibleEnvironmentIds.includes(referenceEnvironmentId)
  ) {
    return noWrites({ ...state, eligibleEnvironmentIds });
  }

  return {
    state: {
      ...state,
      phase: "saving-reference",
      displayedDocument: candidate,
      optimisticDocument: candidate,
      rejectedCandidate: null,
      eligibleEnvironmentIds,
      pendingEnvironmentIds: [referenceEnvironmentId],
      savedEnvironmentIds: [],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: eligibleEnvironmentIds,
    },
    writes: [{ environmentId: referenceEnvironmentId, document: candidate }],
  };
}

function withoutEnvironment(
  ids: ReadonlyArray<EnvironmentId>,
  environmentId: EnvironmentId,
): ReadonlyArray<EnvironmentId> {
  return ids.filter((candidate) => candidate !== environmentId);
}

function withEnvironment(
  ids: ReadonlyArray<EnvironmentId>,
  environmentId: EnvironmentId,
): ReadonlyArray<EnvironmentId> {
  return sortEnvironmentIds([...ids, environmentId]);
}

function reduceReferenceResult(
  state: ProjectCollectionsSyncState,
  result: ProjectCollectionsWriteResult,
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ProjectCollectionsSyncTransition {
  const candidate = state.optimisticDocument ?? state.rejectedCandidate;
  if (candidate === null) return noWrites(state);

  if (result.outcome === "rejected") {
    const comparison =
      state.confirmedDocument === null
        ? {
            matching: [] as ReadonlyArray<EnvironmentId>,
            mismatching: [] as ReadonlyArray<EnvironmentId>,
          }
        : partitionByDocument(environments, state.confirmedDocument);
    return noWrites({
      ...state,
      phase: "not-saved",
      displayedDocument: state.confirmedDocument,
      optimisticDocument: null,
      rejectedCandidate: candidate,
      eligibleEnvironmentIds: sortEnvironmentIds([
        ...comparison.matching,
        ...comparison.mismatching,
      ]),
      pendingEnvironmentIds: [],
      savedEnvironmentIds: [],
      failedEnvironmentIds: [result.environmentId],
      mismatchEnvironmentIds: comparison.mismatching,
    });
  }

  const eligibleEnvironmentIds = getEligibleProjectCollectionsSyncEnvironments(environments).map(
    ({ environmentId }) => environmentId,
  );
  const secondaryIds = eligibleEnvironmentIds.filter(
    (environmentId) => environmentId !== result.environmentId,
  );
  const writes = secondaryIds.map((environmentId) => ({ environmentId, document: candidate }));
  return {
    state: {
      ...state,
      phase: secondaryIds.length > 0 ? "saving-secondaries" : "saved",
      confirmedDocument: candidate,
      displayedDocument: candidate,
      optimisticDocument: null,
      rejectedCandidate: null,
      eligibleEnvironmentIds,
      pendingEnvironmentIds: secondaryIds,
      savedEnvironmentIds: [result.environmentId],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: secondaryIds,
    },
    writes,
  };
}

function reduceSecondaryResult(
  state: ProjectCollectionsSyncState,
  result: ProjectCollectionsWriteResult,
): ProjectCollectionsSyncTransition {
  if (!state.pendingEnvironmentIds.includes(result.environmentId)) return noWrites(state);
  const pendingEnvironmentIds = withoutEnvironment(
    state.pendingEnvironmentIds,
    result.environmentId,
  );
  const acknowledged = result.outcome === "acknowledged";
  const savedEnvironmentIds = acknowledged
    ? withEnvironment(state.savedEnvironmentIds, result.environmentId)
    : state.savedEnvironmentIds;
  const failedEnvironmentIds = acknowledged
    ? withoutEnvironment(state.failedEnvironmentIds, result.environmentId)
    : withEnvironment(state.failedEnvironmentIds, result.environmentId);
  const mismatchEnvironmentIds = acknowledged
    ? withoutEnvironment(state.mismatchEnvironmentIds, result.environmentId)
    : withEnvironment(state.mismatchEnvironmentIds, result.environmentId);
  const phase =
    pendingEnvironmentIds.length > 0
      ? "saving-secondaries"
      : mismatchEnvironmentIds.length > 0
        ? "partial"
        : "saved";

  return noWrites({
    ...state,
    phase,
    pendingEnvironmentIds,
    savedEnvironmentIds,
    failedEnvironmentIds,
    mismatchEnvironmentIds,
  });
}

export function reduceProjectCollectionsWriteResult(
  state: ProjectCollectionsSyncState,
  result: ProjectCollectionsWriteResult,
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ProjectCollectionsSyncTransition {
  if (!state.pendingEnvironmentIds.includes(result.environmentId)) return noWrites(state);
  return result.environmentId === state.referenceEnvironmentId && state.phase === "saving-reference"
    ? reduceReferenceResult(state, result, environments)
    : reduceSecondaryResult(state, result);
}

function currentSecondaryMismatchIds(
  state: ProjectCollectionsSyncState,
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ReadonlyArray<EnvironmentId> {
  if (state.confirmedDocument === null) return [];
  const actualMismatches = partitionByDocument(environments, state.confirmedDocument).mismatching;
  return sortEnvironmentIds([
    ...state.failedEnvironmentIds,
    ...state.mismatchEnvironmentIds,
    ...actualMismatches,
  ]).filter(
    (environmentId) =>
      environmentId !== state.referenceEnvironmentId &&
      !state.savedEnvironmentIds.includes(environmentId),
  );
}

export function planProjectCollectionsSyncRetry(
  state: ProjectCollectionsSyncState,
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ProjectCollectionsSyncTransition {
  const eligibleEnvironmentIds = getEligibleProjectCollectionsSyncEnvironments(environments).map(
    ({ environmentId }) => environmentId,
  );
  if (state.pendingEnvironmentIds.length > 0) {
    return noWrites({ ...state, eligibleEnvironmentIds });
  }
  const referenceEnvironmentId = state.referenceEnvironmentId;
  if (
    state.rejectedCandidate !== null &&
    referenceEnvironmentId !== null &&
    eligibleEnvironmentIds.includes(referenceEnvironmentId)
  ) {
    const candidate = state.rejectedCandidate;
    return {
      state: {
        ...state,
        phase: "saving-reference",
        displayedDocument: candidate,
        optimisticDocument: candidate,
        eligibleEnvironmentIds,
        pendingEnvironmentIds: [referenceEnvironmentId],
        failedEnvironmentIds: [],
      },
      writes: [{ environmentId: referenceEnvironmentId, document: candidate }],
    };
  }
  if (state.confirmedDocument === null) return noWrites({ ...state, eligibleEnvironmentIds });

  const eligibleSet = new Set(eligibleEnvironmentIds);
  const targetIds = currentSecondaryMismatchIds(state, environments).filter((environmentId) =>
    eligibleSet.has(environmentId),
  );
  if (targetIds.length === 0) return noWrites({ ...state, eligibleEnvironmentIds });
  return {
    state: {
      ...state,
      phase: "saving-secondaries",
      eligibleEnvironmentIds,
      pendingEnvironmentIds: targetIds,
      failedEnvironmentIds: state.failedEnvironmentIds.filter(
        (environmentId) => !targetIds.includes(environmentId),
      ),
    },
    writes: targetIds.map((environmentId) => ({
      environmentId,
      document: state.confirmedDocument!,
    })),
  };
}

/** Applies the displayed reference layout with the same acknowledgement rules as Retry. */
export function planProjectCollectionsReconciliation(
  state: ProjectCollectionsSyncState,
  environments: ReadonlyArray<ProjectCollectionsSyncEnvironment>,
): ProjectCollectionsSyncTransition {
  return planProjectCollectionsSyncRetry(state, environments);
}
