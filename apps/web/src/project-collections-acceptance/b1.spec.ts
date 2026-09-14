import { EnvironmentId, ProjectCollectionId } from "@t3tools/contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

import {
  parsePersistedState,
  PERSISTED_STATE_KEY,
  persistState,
  setProjectCollectionScope,
  setProjectCollectionsPreferredReferenceEnvironmentId,
  type PersistedUiState,
  type UiState,
} from "../uiStateStore";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function initialState(): UiState {
  return {
    projectExpandedById: {},
    projectOrder: [],
    sidebarProjectScopeKey: null,
    projectCollectionScope: { kind: "all" },
    projectCollectionsPreferredReferenceEnvironmentId: null,
    threadLastVisitedAtById: {},
    threadChangedFilesExpandedById: {},
    defaultAdvertisedEndpointKey: null,
  };
}

function save(deviceStorage: Storage, state: UiState): void {
  vi.stubGlobal("window", { localStorage: deviceStorage });
  persistState(state);
}

function reopen(deviceStorage: Storage): UiState {
  return parsePersistedState(
    JSON.parse(deviceStorage.getItem(PERSISTED_STATE_KEY) ?? "{}") as PersistedUiState,
  );
}

afterEach(() => vi.unstubAllGlobals());

test("S11: Mac, phone, and tablet restore independent device-local collection selections", () => {
  const workId = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
  const personalId = ProjectCollectionId.make("9ca527c9-9717-46fc-bdb9-d93cdde97fe0");
  const devices = [storage(), storage(), storage()];
  const selections = [workId, personalId, workId] as const;
  const references = ["mac", "phone", "tablet"].map((id) => EnvironmentId.make(id));

  const restored = devices.map((deviceStorage, index) => {
    const withScope = setProjectCollectionScope(initialState(), {
      kind: "collection",
      collectionId: selections[index]!,
    });
    save(
      deviceStorage,
      setProjectCollectionsPreferredReferenceEnvironmentId(withScope, references[index]!),
    );
    return reopen(deviceStorage);
  });

  expect(restored.map(({ projectCollectionScope }) => projectCollectionScope)).toEqual([
    { kind: "collection", collectionId: workId },
    { kind: "collection", collectionId: personalId },
    { kind: "collection", collectionId: workId },
  ]);
  expect(
    restored.map(
      ({ projectCollectionsPreferredReferenceEnvironmentId }) =>
        projectCollectionsPreferredReferenceEnvironmentId,
    ),
  ).toEqual(references);

  save(devices[1]!, setProjectCollectionScope(restored[1]!, { kind: "all" }));
  const phoneReset = reopen(devices[1]!);
  expect(phoneReset.projectCollectionScope).toEqual({ kind: "all" });
  expect(reopen(devices[0]!).projectCollectionScope).toEqual({
    kind: "collection",
    collectionId: workId,
  });
  expect(reopen(devices[2]!).projectCollectionScope).toEqual({
    kind: "collection",
    collectionId: workId,
  });
});
