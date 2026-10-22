import {
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  EnvironmentId,
  ProjectCollectionId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  beginProjectCollectionsMutation,
  createProjectCollectionsSyncState,
  getEligibleProjectCollectionsSyncEnvironments,
  planProjectCollectionsReconciliation,
  planProjectCollectionsSyncRetry,
  reduceProjectCollectionsWriteResult,
  refreshProjectCollectionsSyncState,
  selectProjectCollectionsReference,
  summarizeProjectCollectionsSyncState,
  type ProjectCollectionsSyncEnvironment,
} from "./projectCollectionsSync.ts";

const primaryId = EnvironmentId.make("environment-primary");
const preferredId = EnvironmentId.make("environment-preferred");
const fallbackId = EnvironmentId.make("environment-fallback");

const WORK_DOCUMENT: ProjectCollectionsDocument = {
  schemaVersion: 1,
  collections: [
    {
      id: ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb"),
      name: "Work",
      visual: { kind: "lucide", name: "briefcase", color: "blue" },
    },
  ],
  assignments: [],
};

function environment(
  environmentId: typeof primaryId,
  options: {
    readonly phase?: ProjectCollectionsSyncEnvironment["connection"]["phase"];
    readonly capable?: boolean;
    readonly document?: ProjectCollectionsDocument | null;
  } = {},
): ProjectCollectionsSyncEnvironment {
  return {
    environmentId,
    connection: { phase: options.phase ?? "connected" },
    capabilities: { projectCollections: options.capable ?? true },
    document:
      options.document === undefined ? DEFAULT_PROJECT_COLLECTIONS_DOCUMENT : options.document,
  };
}

describe("project collection reference selection", () => {
  it("keeps the capable preferred reference through reconnects and falls back deterministically", () => {
    let state = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: preferredId,
      primaryEnvironmentId: primaryId,
      environments: [environment(primaryId), environment(preferredId)],
    });
    expect(state.referenceEnvironmentId).toBe(preferredId);

    state = refreshProjectCollectionsSyncState(state, {
      primaryEnvironmentId: primaryId,
      environments: [environment(fallbackId), environment(primaryId), environment(preferredId)],
    });
    expect(state.referenceEnvironmentId).toBe(preferredId);

    state = refreshProjectCollectionsSyncState(state, {
      primaryEnvironmentId: primaryId,
      environments: [
        environment(preferredId, { phase: "offline" }),
        environment(fallbackId),
        environment(primaryId),
      ],
    });
    expect(state.referenceEnvironmentId).toBe(primaryId);
    expect(state.preferredReferenceEnvironmentId).toBe(primaryId);

    state = refreshProjectCollectionsSyncState(state, {
      primaryEnvironmentId: primaryId,
      environments: [
        environment(primaryId, { capable: false }),
        environment(EnvironmentId.make("environment-z")),
        environment(fallbackId),
      ],
    });
    expect(state.referenceEnvironmentId).toBe(fallbackId);
    expect(state.preferredReferenceEnvironmentId).toBe(fallbackId);
  });

  it("uses only loaded connected capable targets and never treats array order as authority", () => {
    const unloadedId = EnvironmentId.make("environment-unloaded");
    const oldId = EnvironmentId.make("environment-old");
    const offlineId = EnvironmentId.make("environment-offline");
    const eligible = [
      environment(EnvironmentId.make("environment-z")),
      environment(unloadedId, { document: null }),
      environment(oldId, { capable: false }),
      environment(offlineId, { phase: "offline" }),
      environment(fallbackId),
    ];

    expect(
      getEligibleProjectCollectionsSyncEnvironments(eligible).map(
        ({ environmentId }) => environmentId,
      ),
    ).toEqual([fallbackId, EnvironmentId.make("environment-z")]);
    expect(
      selectProjectCollectionsReference({
        preferredReferenceEnvironmentId: null,
        primaryEnvironmentId: primaryId,
        environments: eligible,
      }),
    ).toEqual({
      referenceEnvironmentId: fallbackId,
      preferredReferenceEnvironmentId: fallbackId,
    });

    expect(
      selectProjectCollectionsReference({
        preferredReferenceEnvironmentId: preferredId,
        primaryEnvironmentId: primaryId,
        environments: [environment(oldId, { capable: false })],
      }),
    ).toEqual({
      referenceEnvironmentId: null,
      preferredReferenceEnvironmentId: preferredId,
    });
  });
});

describe("project collection acknowledged fanout", () => {
  it("never releases or duplicates writes while the reference acknowledgement is pending", () => {
    const environments = [environment(primaryId), environment(fallbackId)];
    const state = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: primaryId,
      primaryEnvironmentId: primaryId,
      environments,
    });
    const saving = beginProjectCollectionsMutation(state, WORK_DOCUMENT, environments);

    expect(planProjectCollectionsSyncRetry(saving.state, environments).writes).toEqual([]);
    expect(
      beginProjectCollectionsMutation(
        saving.state,
        DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
        environments,
      ).writes,
    ).toEqual([]);
  });

  it("fans out concurrently after reference acknowledgement and retries only rejected targets", () => {
    const thirdId = EnvironmentId.make("environment-third");
    const environments = [environment(thirdId), environment(primaryId), environment(fallbackId)];
    let transition = beginProjectCollectionsMutation(
      createProjectCollectionsSyncState({
        preferredReferenceEnvironmentId: primaryId,
        primaryEnvironmentId: primaryId,
        environments,
      }),
      WORK_DOCUMENT,
      environments,
    );

    transition = reduceProjectCollectionsWriteResult(
      transition.state,
      { environmentId: primaryId, outcome: "acknowledged" },
      environments,
    );
    expect(transition.writes).toEqual([
      { environmentId: fallbackId, document: WORK_DOCUMENT },
      { environmentId: thirdId, document: WORK_DOCUMENT },
    ]);

    transition = reduceProjectCollectionsWriteResult(
      transition.state,
      { environmentId: thirdId, outcome: "acknowledged" },
      environments,
    );
    transition = reduceProjectCollectionsWriteResult(
      transition.state,
      { environmentId: fallbackId, outcome: "rejected" },
      environments,
    );
    expect(transition.state).toMatchObject({
      phase: "partial",
      confirmedDocument: WORK_DOCUMENT,
      displayedDocument: WORK_DOCUMENT,
      savedEnvironmentIds: [primaryId, thirdId],
      failedEnvironmentIds: [fallbackId],
      mismatchEnvironmentIds: [fallbackId],
    });
    expect(summarizeProjectCollectionsSyncState(transition.state)).toEqual({
      phase: "partial",
      savedCount: 2,
      eligibleCount: 3,
      message: "Saved on 2 of 3 environments",
    });

    const retry = planProjectCollectionsSyncRetry(transition.state, environments);
    expect(retry.writes).toEqual([{ environmentId: fallbackId, document: WORK_DOCUMENT }]);
    const complete = reduceProjectCollectionsWriteResult(
      retry.state,
      { environmentId: fallbackId, outcome: "acknowledged" },
      environments,
    );
    expect(complete.state).toMatchObject({
      phase: "saved",
      savedEnvironmentIds: [fallbackId, primaryId, thirdId],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: [],
    });
  });

  it("rolls reference rejection back while retaining the exact candidate for reference-first retry", () => {
    const environments = [environment(primaryId), environment(fallbackId)];
    const initial = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: primaryId,
      primaryEnvironmentId: primaryId,
      environments,
    });
    const saving = beginProjectCollectionsMutation(initial, WORK_DOCUMENT, environments);
    const rejected = reduceProjectCollectionsWriteResult(
      saving.state,
      { environmentId: primaryId, outcome: "rejected" },
      environments,
    );

    expect(rejected.writes).toEqual([]);
    expect(rejected.state).toMatchObject({
      phase: "not-saved",
      displayedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      optimisticDocument: null,
      rejectedCandidate: WORK_DOCUMENT,
      savedEnvironmentIds: [],
    });
    expect(summarizeProjectCollectionsSyncState(rejected.state).message).toBe("Not saved");

    const retry = planProjectCollectionsSyncRetry(rejected.state, environments);
    expect(retry.writes).toEqual([{ environmentId: primaryId, document: WORK_DOCUMENT }]);
    const acknowledged = reduceProjectCollectionsWriteResult(
      retry.state,
      { environmentId: primaryId, outcome: "acknowledged" },
      environments,
    );
    expect(acknowledged.writes).toEqual([{ environmentId: fallbackId, document: WORK_DOCUMENT }]);
  });

  it("reconciles only mismatched capable targets without rewriting acknowledged matches", () => {
    const matchedId = EnvironmentId.make("environment-matched");
    const environments = [
      environment(primaryId, { document: WORK_DOCUMENT }),
      environment(fallbackId),
      environment(matchedId, { document: WORK_DOCUMENT }),
    ];
    const state = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: primaryId,
      primaryEnvironmentId: primaryId,
      environments,
    });

    expect(state.mismatchEnvironmentIds).toEqual([fallbackId]);
    expect(planProjectCollectionsReconciliation(state, environments).writes).toEqual([
      { environmentId: fallbackId, document: WORK_DOCUMENT },
    ]);
  });

  it("keeps a no-capability state read-only", () => {
    const environments = [environment(primaryId, { document: null })];
    const state = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: primaryId,
      primaryEnvironmentId: primaryId,
      environments,
    });

    expect(state).toMatchObject({
      phase: "idle",
      referenceEnvironmentId: null,
      confirmedDocument: null,
      displayedDocument: null,
      eligibleEnvironmentIds: [],
    });
    expect(beginProjectCollectionsMutation(state, WORK_DOCUMENT, environments).writes).toEqual([]);
  });

  it("drops a disconnected pending secondary, ignores its late result, then retries it after reconnect", () => {
    const connected = [environment(primaryId), environment(fallbackId)];
    const initial = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: primaryId,
      primaryEnvironmentId: primaryId,
      environments: connected,
    });
    const savingReference = beginProjectCollectionsMutation(initial, WORK_DOCUMENT, connected);
    const savingSecondary = reduceProjectCollectionsWriteResult(
      savingReference.state,
      { environmentId: primaryId, outcome: "acknowledged" },
      connected,
    ).state;

    const disconnectedEnvironments = [
      environment(primaryId, { document: WORK_DOCUMENT }),
      environment(fallbackId, { phase: "offline" }),
    ];
    const disconnected = refreshProjectCollectionsSyncState(savingSecondary, {
      primaryEnvironmentId: primaryId,
      environments: disconnectedEnvironments,
    });
    expect(disconnected).toMatchObject({
      phase: "saved",
      eligibleEnvironmentIds: [primaryId],
      pendingEnvironmentIds: [],
      savedEnvironmentIds: [primaryId],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: [],
    });
    expect(summarizeProjectCollectionsSyncState(disconnected)).toMatchObject({
      savedCount: 1,
      eligibleCount: 1,
    });

    const lateResult = reduceProjectCollectionsWriteResult(
      disconnected,
      { environmentId: fallbackId, outcome: "rejected" },
      disconnectedEnvironments,
    );
    expect(lateResult).toEqual({ state: disconnected, writes: [] });

    const matchingId = EnvironmentId.make("environment-matching");
    const reconnectedEnvironments = [
      environment(primaryId, { document: WORK_DOCUMENT }),
      environment(fallbackId),
      environment(matchingId, { document: WORK_DOCUMENT }),
    ];
    const reconnected = refreshProjectCollectionsSyncState(lateResult.state, {
      primaryEnvironmentId: primaryId,
      environments: reconnectedEnvironments,
    });
    expect(reconnected).toMatchObject({
      phase: "partial",
      eligibleEnvironmentIds: [fallbackId, matchingId, primaryId],
      savedEnvironmentIds: [matchingId, primaryId],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: [fallbackId],
    });
    expect(reconnected.savedEnvironmentIds.length).toBeLessThanOrEqual(
      reconnected.eligibleEnvironmentIds.length,
    );
    expect(planProjectCollectionsSyncRetry(reconnected, reconnectedEnvironments).writes).toEqual([
      { environmentId: fallbackId, document: WORK_DOCUMENT },
    ]);
  });

  it("reconciles every tracking set while secondary fanout remains active", () => {
    const failedId = EnvironmentId.make("environment-failed");
    const pendingId = EnvironmentId.make("environment-pending");
    const previouslySavedId = EnvironmentId.make("environment-saved");
    const newlyMatchingId = EnvironmentId.make("environment-new-match");
    const newlyMismatchingId = EnvironmentId.make("environment-new-mismatch");
    const initialEnvironments = [
      environment(primaryId),
      environment(failedId),
      environment(pendingId),
      environment(previouslySavedId),
    ];
    const initial = createProjectCollectionsSyncState({
      preferredReferenceEnvironmentId: primaryId,
      primaryEnvironmentId: primaryId,
      environments: initialEnvironments,
    });
    const savingReference = beginProjectCollectionsMutation(
      initial,
      WORK_DOCUMENT,
      initialEnvironments,
    );
    let active = reduceProjectCollectionsWriteResult(
      savingReference.state,
      { environmentId: primaryId, outcome: "acknowledged" },
      initialEnvironments,
    ).state;
    active = reduceProjectCollectionsWriteResult(
      active,
      { environmentId: failedId, outcome: "rejected" },
      initialEnvironments,
    ).state;
    active = reduceProjectCollectionsWriteResult(
      active,
      { environmentId: previouslySavedId, outcome: "acknowledged" },
      initialEnvironments,
    ).state;
    expect(active).toMatchObject({
      phase: "saving-secondaries",
      pendingEnvironmentIds: [pendingId],
      savedEnvironmentIds: [primaryId, previouslySavedId],
      failedEnvironmentIds: [failedId],
      mismatchEnvironmentIds: [failedId, pendingId],
    });

    const refreshedEnvironments = [
      environment(primaryId, { document: WORK_DOCUMENT }),
      environment(failedId, { phase: "offline" }),
      environment(pendingId),
      environment(previouslySavedId, { phase: "offline", document: WORK_DOCUMENT }),
      environment(newlyMatchingId, { document: WORK_DOCUMENT }),
      environment(newlyMismatchingId),
    ];
    const refreshed = refreshProjectCollectionsSyncState(active, {
      primaryEnvironmentId: primaryId,
      environments: refreshedEnvironments,
    });
    expect(refreshed).toMatchObject({
      phase: "saving-secondaries",
      eligibleEnvironmentIds: [newlyMatchingId, newlyMismatchingId, pendingId, primaryId],
      pendingEnvironmentIds: [pendingId],
      savedEnvironmentIds: [newlyMatchingId, primaryId],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: [newlyMismatchingId, pendingId],
    });

    const partial = reduceProjectCollectionsWriteResult(
      refreshed,
      { environmentId: pendingId, outcome: "acknowledged" },
      refreshedEnvironments,
    ).state;
    expect(partial).toMatchObject({
      phase: "partial",
      pendingEnvironmentIds: [],
      savedEnvironmentIds: [newlyMatchingId, pendingId, primaryId],
      failedEnvironmentIds: [],
      mismatchEnvironmentIds: [newlyMismatchingId],
    });
    expect(planProjectCollectionsSyncRetry(partial, refreshedEnvironments).writes).toEqual([
      { environmentId: newlyMismatchingId, document: WORK_DOCUMENT },
    ]);
  });

  it.each(["saving-reference", "saving-secondaries"] as const)(
    "preserves the candidate and falls back without fanout when the reference leaves during %s",
    (phase) => {
      const connected = [environment(primaryId), environment(fallbackId)];
      const initial = createProjectCollectionsSyncState({
        preferredReferenceEnvironmentId: primaryId,
        primaryEnvironmentId: primaryId,
        environments: connected,
      });
      const savingReference = beginProjectCollectionsMutation(initial, WORK_DOCUMENT, connected);
      const activeState =
        phase === "saving-reference"
          ? savingReference.state
          : reduceProjectCollectionsWriteResult(
              savingReference.state,
              { environmentId: primaryId, outcome: "acknowledged" },
              connected,
            ).state;

      const fallbackOnly = [environment(primaryId, { phase: "offline" }), environment(fallbackId)];
      const refreshed = refreshProjectCollectionsSyncState(activeState, {
        primaryEnvironmentId: primaryId,
        environments: fallbackOnly,
      });
      expect(refreshed).toMatchObject({
        phase: "not-saved",
        referenceEnvironmentId: fallbackId,
        preferredReferenceEnvironmentId: fallbackId,
        displayedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
        rejectedCandidate: WORK_DOCUMENT,
        pendingEnvironmentIds: [],
      });
      expect(planProjectCollectionsSyncRetry(refreshed, fallbackOnly).writes).toEqual([
        { environmentId: fallbackId, document: WORK_DOCUMENT },
      ]);
    },
  );
});
