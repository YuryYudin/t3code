import {
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  EnvironmentId,
  ProjectCollectionId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import {
  createProjectCollectionsSyncState,
  planProjectCollectionsReconciliation,
  reduceProjectCollectionsWriteResult,
  refreshProjectCollectionsSyncState,
  summarizeProjectCollectionsSyncState,
  type ProjectCollectionsSyncEnvironment,
  type ProjectCollectionsSyncState,
} from "@t3tools/client-runtime/state/project-collections-sync";
import { expect, test, vi } from "vite-plus/test";

const referenceId = EnvironmentId.make("environment-reference");
const secondaryId = EnvironmentId.make("environment-secondary");
const returningId = EnvironmentId.make("environment-returning");
const oldId = EnvironmentId.make("environment-old");

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

function syncEnvironment(
  environmentId: EnvironmentId,
  options: {
    document?: ProjectCollectionsDocument;
    phase?: "connected" | "offline";
    capable?: boolean;
  } = {},
): ProjectCollectionsSyncEnvironment {
  return {
    environmentId,
    connection: { phase: options.phase ?? "connected" },
    capabilities: { projectCollections: options.capable ?? true },
    document: options.document ?? DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  };
}

interface AcceptanceProjectCollectionsView {
  readonly document: ProjectCollectionsSyncState["displayedDocument"];
  readonly confirmedDocument: ProjectCollectionsSyncState["confirmedDocument"];
  readonly optimisticDocument: ProjectCollectionsSyncState["optimisticDocument"];
  readonly rejectedCandidate: ProjectCollectionsSyncState["rejectedCandidate"];
  readonly phase: ProjectCollectionsSyncState["phase"];
  readonly status: ReturnType<typeof summarizeProjectCollectionsSyncState>;
  readonly referenceEnvironmentId: EnvironmentId | null;
  readonly referenceLabel: string | null;
  readonly eligibleEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly mismatchEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly canMutate: boolean;
  readonly save: ReturnType<typeof vi.fn>;
  readonly retry: ReturnType<typeof vi.fn>;
  readonly useThisLayoutEverywhere: ReturnType<typeof vi.fn>;
}

interface AcceptanceSettingsEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: { readonly phase: string };
  readonly serverConfig: {
    readonly environment: { readonly capabilities: { readonly projectCollections?: boolean } };
  } | null;
}

type SettingsModel = {
  readonly availability: "available" | "older-only" | "unavailable";
  readonly referenceLabel: string | null;
  readonly mismatchLabels: ReadonlyArray<string>;
  readonly showRetry: boolean;
  readonly showUseThisLayoutEverywhere: boolean;
  readonly actionsDisabled: boolean;
};

async function loadSettingsPlanner() {
  const moduleUrl = new URL(
    "../../../mobile/src/features/settings/SettingsRouteScreen.logic.ts",
    import.meta.url,
  ).href;
  const module = (await import(moduleUrl)) as {
    planProjectCollectionsSettings: (input: {
      readonly view: AcceptanceProjectCollectionsView;
      readonly environments: ReadonlyArray<AcceptanceSettingsEnvironment>;
    }) => SettingsModel;
  };
  return module.planProjectCollectionsSettings;
}

function viewFromState(
  state: ProjectCollectionsSyncState,
  labels: ReadonlyMap<EnvironmentId, string>,
): AcceptanceProjectCollectionsView {
  return {
    document: state.displayedDocument,
    confirmedDocument: state.confirmedDocument,
    optimisticDocument: state.optimisticDocument,
    rejectedCandidate: state.rejectedCandidate,
    phase: state.phase,
    status: summarizeProjectCollectionsSyncState(state),
    referenceEnvironmentId: state.referenceEnvironmentId,
    referenceLabel:
      state.referenceEnvironmentId === null
        ? null
        : (labels.get(state.referenceEnvironmentId) ?? null),
    eligibleEnvironmentIds: state.eligibleEnvironmentIds,
    mismatchEnvironmentIds: state.mismatchEnvironmentIds,
    canMutate:
      state.referenceEnvironmentId !== null &&
      state.confirmedDocument !== null &&
      state.pendingEnvironmentIds.length === 0,
    save: vi.fn(),
    retry: vi.fn(),
    useThisLayoutEverywhere: vi.fn(),
  };
}

function presentation(
  environment: ProjectCollectionsSyncEnvironment,
  label: string,
): AcceptanceSettingsEnvironment {
  const projectCollections = environment.capabilities?.projectCollections;
  return {
    environmentId: environment.environmentId,
    label,
    connection: environment.connection,
    serverConfig: {
      environment: {
        capabilities: projectCollections === undefined ? {} : { projectCollections },
      },
    },
  };
}

test("S10: acknowledged reconciliation clears capable drift and keeps the sticky reference on reconnect", async () => {
  const planProjectCollectionsSettings = await loadSettingsPlanner();
  const reference = syncEnvironment(referenceId, { document: WORK_DOCUMENT });
  const secondary = syncEnvironment(secondaryId);
  let environments = [reference, secondary];
  let state = createProjectCollectionsSyncState({
    preferredReferenceEnvironmentId: referenceId,
    primaryEnvironmentId: null,
    environments,
  });
  const labels = new Map([
    [referenceId, "MacBook Pro"],
    [secondaryId, "Mac mini"],
    [returningId, "Travel laptop"],
  ]);
  const initialModel = planProjectCollectionsSettings({
    view: viewFromState(state, labels),
    environments: environments.map((environment) =>
      presentation(environment, labels.get(environment.environmentId)!),
    ),
  });

  expect(initialModel).toMatchObject({
    referenceLabel: "MacBook Pro",
    mismatchLabels: ["Mac mini"],
    showUseThisLayoutEverywhere: true,
  });

  let transition = planProjectCollectionsReconciliation(state, environments);
  expect(transition.writes).toEqual([{ environmentId: secondaryId, document: WORK_DOCUMENT }]);
  transition = reduceProjectCollectionsWriteResult(
    transition.state,
    { environmentId: secondaryId, outcome: "acknowledged" },
    environments,
  );
  state = transition.state;
  expect(state).toMatchObject({ phase: "saved", mismatchEnvironmentIds: [] });

  environments = [
    syncEnvironment(returningId),
    syncEnvironment(secondaryId, { document: WORK_DOCUMENT }),
    reference,
  ];
  state = refreshProjectCollectionsSyncState(state, { primaryEnvironmentId: null, environments });
  expect(state).toMatchObject({
    referenceEnvironmentId: referenceId,
    mismatchEnvironmentIds: [returningId],
  });
});

test("S12: offline and older environments are excluded and older-only state is read-only", async () => {
  const planProjectCollectionsSettings = await loadSettingsPlanner();
  const reference = syncEnvironment(referenceId, { document: WORK_DOCUMENT });
  const offline = syncEnvironment(returningId, { phase: "offline" });
  const old = syncEnvironment(oldId, { capable: false });
  const environments = [reference, offline, old];
  const state = createProjectCollectionsSyncState({
    preferredReferenceEnvironmentId: referenceId,
    primaryEnvironmentId: null,
    environments,
  });

  expect(state).toMatchObject({
    eligibleEnvironmentIds: [referenceId],
    mismatchEnvironmentIds: [],
  });
  expect(planProjectCollectionsReconciliation(state, environments).writes).toEqual([]);

  const unavailable = viewFromState(
    {
      ...state,
      phase: "not-saved",
      referenceEnvironmentId: null,
      confirmedDocument: null,
      displayedDocument: null,
      rejectedCandidate: WORK_DOCUMENT,
      eligibleEnvironmentIds: [],
    },
    new Map(),
  );
  const olderOnly = planProjectCollectionsSettings({
    view: unavailable,
    environments: [presentation(old, "Old Mac")],
  });
  expect(olderOnly).toMatchObject({
    availability: "older-only",
    showRetry: false,
    showUseThisLayoutEverywhere: false,
    actionsDisabled: true,
  });
});
