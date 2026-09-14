import {
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  EnvironmentId,
  ProjectCollectionId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { createProjectCollection } from "@t3tools/client-runtime/state/project-collections";
import {
  beginProjectCollectionsMutation,
  createProjectCollectionsSyncState,
  planProjectCollectionsSyncRetry,
  reduceProjectCollectionsWriteResult,
  summarizeProjectCollectionsSyncState,
  type ProjectCollectionsSyncEnvironment,
} from "@t3tools/client-runtime/state/project-collections-sync";
import { expect, test } from "vite-plus/test";

const referenceId = EnvironmentId.make("environment-a");
const secondaryId = EnvironmentId.make("environment-b");

function candidateDocument(): ProjectCollectionsDocument {
  const result = createProjectCollection(DEFAULT_PROJECT_COLLECTIONS_DOCUMENT, {
    id: ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb"),
    name: "Work",
    visual: { kind: "lucide", name: "briefcase", color: "blue" },
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function environment(
  environmentId: typeof referenceId,
  document: ProjectCollectionsDocument = DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
): ProjectCollectionsSyncEnvironment {
  return {
    environmentId,
    connection: { phase: "connected" },
    capabilities: { projectCollections: true },
    document,
  };
}

test("S16: a secondary rejection retains truthful partial state and retries only that target", () => {
  const environments = [environment(referenceId), environment(secondaryId)];
  const candidate = candidateDocument();
  let state = createProjectCollectionsSyncState({
    preferredReferenceEnvironmentId: referenceId,
    primaryEnvironmentId: referenceId,
    environments,
  });

  let transition = beginProjectCollectionsMutation(state, candidate, environments);
  expect(transition.writes).toEqual([{ environmentId: referenceId, document: candidate }]);
  state = transition.state;

  transition = reduceProjectCollectionsWriteResult(
    state,
    { environmentId: referenceId, outcome: "acknowledged" },
    environments,
  );
  expect(transition.writes).toEqual([{ environmentId: secondaryId, document: candidate }]);
  state = transition.state;

  transition = reduceProjectCollectionsWriteResult(
    state,
    { environmentId: secondaryId, outcome: "rejected" },
    environments,
  );
  expect(transition.writes).toEqual([]);
  expect(transition.state).toMatchObject({
    phase: "partial",
    confirmedDocument: candidate,
    displayedDocument: candidate,
    savedEnvironmentIds: [referenceId],
    eligibleEnvironmentIds: [referenceId, secondaryId],
    mismatchEnvironmentIds: [secondaryId],
  });
  expect(summarizeProjectCollectionsSyncState(transition.state).message).toBe(
    "Saved on 1 of 2 environments",
  );

  transition = planProjectCollectionsSyncRetry(transition.state, environments);
  expect(transition.writes).toEqual([{ environmentId: secondaryId, document: candidate }]);
});

test("S16: a reference rejection rolls back and gates secondary fanout until retry acknowledgement", () => {
  const environments = [environment(referenceId), environment(secondaryId)];
  const candidate = candidateDocument();
  const initialState = createProjectCollectionsSyncState({
    preferredReferenceEnvironmentId: referenceId,
    primaryEnvironmentId: referenceId,
    environments,
  });
  const optimistic = beginProjectCollectionsMutation(initialState, candidate, environments);

  const rejected = reduceProjectCollectionsWriteResult(
    optimistic.state,
    { environmentId: referenceId, outcome: "rejected" },
    environments,
  );
  expect(rejected.writes).toEqual([]);
  expect(rejected.state.displayedDocument).toEqual(DEFAULT_PROJECT_COLLECTIONS_DOCUMENT);
  expect(rejected.state.confirmedDocument).toEqual(DEFAULT_PROJECT_COLLECTIONS_DOCUMENT);
  expect(rejected.state.rejectedCandidate).toEqual(candidate);

  const retry = planProjectCollectionsSyncRetry(rejected.state, environments);
  expect(retry.writes).toEqual([{ environmentId: referenceId, document: candidate }]);

  const acknowledged = reduceProjectCollectionsWriteResult(
    retry.state,
    { environmentId: referenceId, outcome: "acknowledged" },
    environments,
  );
  expect(acknowledged.writes).toEqual([{ environmentId: secondaryId, document: candidate }]);
});
