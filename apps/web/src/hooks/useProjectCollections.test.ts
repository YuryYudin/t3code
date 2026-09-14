import {
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  EnvironmentId,
  ProjectCollectionId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useProjectCollections, type ProjectCollectionsView } from "./useProjectCollections";

const testState = vi.hoisted(() => ({
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: {
      phase: "available" | "offline" | "connecting" | "reconnecting" | "connected" | "error";
    };
    serverConfig: {
      environment: { capabilities: { projectCollections: boolean } };
      settings: { projectCollections: ProjectCollectionsDocument };
    } | null;
  }>,
  primaryEnvironmentId: null as EnvironmentId | null,
  preferredReferenceEnvironmentId: null as EnvironmentId | null,
  setPreferredReferenceEnvironmentId: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: testState.environments }),
  usePrimaryEnvironmentId: () => testState.primaryEnvironmentId,
}));

vi.mock("~/state/server", () => ({
  serverEnvironment: { updateSettings: { label: "test:update-settings" } },
}));

vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: () => testState.updateSettings,
}));

vi.mock("~/uiStateStore", () => ({
  useUiStateStore: (selector: (state: object) => unknown) =>
    selector({
      projectCollectionsPreferredReferenceEnvironmentId: testState.preferredReferenceEnvironmentId,
      setProjectCollectionsPreferredReferenceEnvironmentId:
        testState.setPreferredReferenceEnvironmentId,
    }),
}));

const referenceId = EnvironmentId.make("environment-reference");
const secondaryId = EnvironmentId.make("environment-secondary");
const thirdId = EnvironmentId.make("environment-third");

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
  environmentId: typeof referenceId,
  options: {
    phase?: "available" | "offline" | "connecting" | "reconnecting" | "connected" | "error";
    capable?: boolean;
    document?: ProjectCollectionsDocument | null;
  } = {},
) {
  return {
    environmentId,
    label: environmentId,
    connection: { phase: options.phase ?? ("connected" as const) },
    serverConfig:
      options.document === null
        ? null
        : {
            environment: { capabilities: { projectCollections: options.capable ?? true } },
            settings: {
              projectCollections: options.document ?? DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
            },
          },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

let renderer: ReactTestRenderer | undefined;
let latest: ProjectCollectionsView;

function Probe() {
  const collections = useProjectCollections();
  useLayoutEffect(() => {
    latest = collections;
  }, [collections]);
  return null;
}

async function renderProbe() {
  await act(() => {
    renderer = create(createElement(Probe));
  });
}

async function rerenderProbe() {
  await act(() => {
    renderer?.update(createElement(Probe));
  });
}

function success() {
  return { _tag: "Success" as const, value: undefined };
}

function failure() {
  return { _tag: "Failure" as const, cause: {} };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  testState.environments = [environment(referenceId), environment(secondaryId)];
  testState.primaryEnvironmentId = referenceId;
  testState.preferredReferenceEnvironmentId = referenceId;
  testState.setPreferredReferenceEnvironmentId.mockReset();
  testState.updateSettings.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("acknowledged project collection synchronization", () => {
  it("waits for the reference acknowledgement before writing the complete document to secondaries", async () => {
    const referenceWrite = deferred<{ _tag: "Success"; value: void }>();
    testState.updateSettings
      .mockReturnValueOnce(referenceWrite.promise)
      .mockResolvedValue({ _tag: "Success", value: undefined });
    await renderProbe();

    await act(() => {
      expect(latest.save(WORK_DOCUMENT)).toEqual({ ok: true, value: WORK_DOCUMENT });
    });

    expect(latest.phase).toBe("saving-reference");
    expect(testState.updateSettings.mock.calls).toEqual([
      [
        {
          environmentId: referenceId,
          input: { patch: { projectCollections: WORK_DOCUMENT } },
        },
      ],
    ]);

    await act(() => referenceWrite.resolve({ _tag: "Success", value: undefined }));

    expect(testState.updateSettings.mock.calls[1]).toEqual([
      {
        environmentId: secondaryId,
        input: { patch: { projectCollections: WORK_DOCUMENT } },
      },
    ]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(latest.status).toEqual({
      phase: "saved",
      savedCount: 2,
      eligibleCount: 2,
      message: "Saved on 2 of 2 environments",
    });
  });

  it("rolls back a rejected reference and retries the retained candidate reference-first", async () => {
    const firstAttempt = deferred<ReturnType<typeof failure>>();
    const retryAttempt = deferred<ReturnType<typeof success>>();
    testState.updateSettings
      .mockReturnValueOnce(firstAttempt.promise)
      .mockReturnValueOnce(retryAttempt.promise)
      .mockResolvedValue(success());
    await renderProbe();

    await act(() => {
      latest.save(WORK_DOCUMENT);
    });
    await act(() => firstAttempt.resolve(failure()));

    expect(latest).toMatchObject({
      phase: "not-saved",
      document: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      optimisticDocument: null,
      rejectedCandidate: WORK_DOCUMENT,
    });
    expect(testState.updateSettings).toHaveBeenCalledTimes(1);

    await act(() => latest.retry());
    expect(testState.updateSettings.mock.calls[1]?.[0]).toMatchObject({
      environmentId: referenceId,
      input: { patch: { projectCollections: WORK_DOCUMENT } },
    });
    await act(() => retryAttempt.resolve(success()));
    expect(testState.updateSettings.mock.calls[2]?.[0]).toMatchObject({
      environmentId: secondaryId,
      input: { patch: { projectCollections: WORK_DOCUMENT } },
    });
  });

  it("reports partial fanout and retries only the failed capable target", async () => {
    const secondaryWrite = deferred<ReturnType<typeof failure>>();
    const thirdWrite = deferred<ReturnType<typeof success>>();
    testState.environments = [
      environment(thirdId),
      environment(referenceId),
      environment(secondaryId),
    ];
    testState.updateSettings
      .mockResolvedValueOnce(success())
      .mockReturnValueOnce(secondaryWrite.promise)
      .mockReturnValueOnce(thirdWrite.promise)
      .mockResolvedValue(success());
    await renderProbe();

    await act(async () => {
      latest.save(WORK_DOCUMENT);
      await Promise.resolve();
    });
    await act(() => secondaryWrite.resolve(failure()));
    await act(() => thirdWrite.resolve(success()));

    expect(latest.status).toEqual({
      phase: "partial",
      savedCount: 2,
      eligibleCount: 3,
      message: "Saved on 2 of 3 environments",
    });
    expect(latest.mismatchEnvironmentIds).toEqual([secondaryId]);

    await act(() => latest.retry());
    expect(testState.updateSettings).toHaveBeenCalledTimes(4);
    expect(testState.updateSettings.mock.calls[3]?.[0]).toMatchObject({
      environmentId: secondaryId,
      input: { patch: { projectCollections: WORK_DOCUMENT } },
    });
  });

  it("keeps the selected reference sticky across reconnects and persists deterministic fallback", async () => {
    testState.preferredReferenceEnvironmentId = secondaryId;
    testState.environments = [environment(referenceId), environment(secondaryId)];
    await renderProbe();
    expect(latest.referenceEnvironmentId).toBe(secondaryId);

    testState.environments = [
      environment(secondaryId, { phase: "offline" }),
      environment(referenceId),
    ];
    await rerenderProbe();
    expect(latest.referenceEnvironmentId).toBe(referenceId);
    expect(testState.setPreferredReferenceEnvironmentId).toHaveBeenLastCalledWith(referenceId);

    testState.preferredReferenceEnvironmentId = referenceId;
    testState.environments = [environment(secondaryId), environment(referenceId)];
    await rerenderProbe();
    expect(latest.referenceEnvironmentId).toBe(referenceId);
  });

  it("excludes unloaded, old, and offline targets and remains read-only without a capable document", async () => {
    const unloadedId = EnvironmentId.make("environment-unloaded");
    const oldId = EnvironmentId.make("environment-old");
    const offlineId = EnvironmentId.make("environment-offline");
    testState.primaryEnvironmentId = null;
    testState.preferredReferenceEnvironmentId = null;
    testState.environments = [
      environment(unloadedId, { document: null }),
      environment(oldId, { capable: false }),
      environment(offlineId, { phase: "offline" }),
      environment(secondaryId),
    ];
    await renderProbe();

    expect(latest.referenceEnvironmentId).toBe(secondaryId);
    expect(latest.eligibleEnvironmentIds).toEqual([secondaryId]);
    expect(testState.setPreferredReferenceEnvironmentId).toHaveBeenLastCalledWith(secondaryId);

    testState.preferredReferenceEnvironmentId = secondaryId;
    testState.environments = [
      environment(unloadedId, { document: null }),
      environment(oldId, { capable: false }),
      environment(secondaryId, { phase: "offline" }),
    ];
    await rerenderProbe();

    expect(latest).toMatchObject({
      referenceEnvironmentId: null,
      document: null,
      canMutate: false,
    });
    await act(() => {
      latest.save(WORK_DOCUMENT);
      latest.retry();
      latest.useThisLayoutEverywhere();
    });
    expect(testState.updateSettings).not.toHaveBeenCalled();
  });

  it("drops an offline pending target and reconciles it when its old document reconnects", async () => {
    const secondaryWrite = deferred<ReturnType<typeof failure>>();
    testState.updateSettings
      .mockResolvedValueOnce(success())
      .mockReturnValueOnce(secondaryWrite.promise)
      .mockResolvedValue(success());
    await renderProbe();

    await act(async () => {
      latest.save(WORK_DOCUMENT);
      await Promise.resolve();
    });
    testState.environments = [
      environment(referenceId, { document: WORK_DOCUMENT }),
      environment(secondaryId, { phase: "offline" }),
    ];
    await rerenderProbe();
    expect(latest.status).toMatchObject({ phase: "saved", savedCount: 1, eligibleCount: 1 });

    await act(() => secondaryWrite.resolve(failure()));
    expect(latest.phase).toBe("saved");

    testState.environments = [
      environment(referenceId, { document: WORK_DOCUMENT }),
      environment(secondaryId),
    ];
    await rerenderProbe();
    expect(latest).toMatchObject({ phase: "partial", mismatchEnvironmentIds: [secondaryId] });

    await act(() => latest.useThisLayoutEverywhere());
    expect(testState.updateSettings.mock.calls[2]?.[0]).toMatchObject({
      environmentId: secondaryId,
      input: { patch: { projectCollections: WORK_DOCUMENT } },
    });
  });

  it("ignores an obsolete secondary result after reconnect dispatches a newer retry", async () => {
    const obsoleteWrite = deferred<ReturnType<typeof success>>();
    const retryWrite = deferred<ReturnType<typeof failure>>();
    testState.updateSettings
      .mockResolvedValueOnce(success())
      .mockReturnValueOnce(obsoleteWrite.promise)
      .mockReturnValueOnce(retryWrite.promise);
    await renderProbe();

    await act(async () => {
      latest.save(WORK_DOCUMENT);
      await Promise.resolve();
    });
    testState.environments = [
      environment(referenceId, { document: WORK_DOCUMENT }),
      environment(secondaryId, { phase: "offline" }),
    ];
    await rerenderProbe();
    testState.environments = [
      environment(referenceId, { document: WORK_DOCUMENT }),
      environment(secondaryId),
    ];
    await rerenderProbe();

    await act(() => latest.retry());
    expect(latest.phase).toBe("saving-secondaries");
    expect(testState.updateSettings).toHaveBeenCalledTimes(3);

    await act(() => obsoleteWrite.resolve(success()));
    expect(latest.phase).toBe("saving-secondaries");

    await act(() => retryWrite.resolve(failure()));
    expect(latest).toMatchObject({
      phase: "partial",
      mismatchEnvironmentIds: [secondaryId],
    });
  });
});
