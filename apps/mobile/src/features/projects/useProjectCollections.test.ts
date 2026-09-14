import {
  DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
  EnvironmentId,
  ProjectCollectionId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const hookRuntime = vi.hoisted(() => ({
  slots: [] as Array<
    | { kind: "state"; value: unknown }
    | { kind: "memo"; value: unknown; dependencies: ReadonlyArray<unknown> }
    | {
        kind: "effect";
        dependencies: ReadonlyArray<unknown>;
        cleanup?: () => void;
      }
  >,
  index: 0,
  dirty: false,
  pendingEffects: [] as Array<{ index: number; effect: () => void | (() => void) }>,
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: "connected" | "offline" };
    serverConfig: {
      environment: { capabilities: { projectCollections: boolean } };
      settings: { projectCollections: ProjectCollectionsDocument };
    } | null;
  }>,
  preferencesResult: { _tag: "Initial" } as
    | { _tag: "Initial" }
    | {
        _tag: "Success";
        value: {
          projectCollectionsPreferredReferenceEnvironmentId?: EnvironmentId | null;
        };
        waiting: false;
        timestamp: number;
      },
  savePreferences: vi.fn(),
  persistSettings: vi.fn(),
}));

function dependenciesEqual(left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  );
}

vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = hookRuntime.index++;
    const existing = hookRuntime.slots[index];
    const slot =
      existing?.kind === "state"
        ? existing
        : ({
            kind: "state",
            value: typeof initial === "function" ? initial() : initial,
          } satisfies { kind: "state"; value: unknown });
    hookRuntime.slots[index] = slot;
    return [
      slot.value,
      (next: unknown) => {
        slot.value = typeof next === "function" ? next(slot.value) : next;
        hookRuntime.dirty = true;
      },
    ];
  },
  useMemo: (factory: () => unknown, dependencies: ReadonlyArray<unknown>) => {
    const index = hookRuntime.index++;
    const existing = hookRuntime.slots[index];
    if (existing?.kind === "memo" && dependenciesEqual(existing.dependencies, dependencies)) {
      return existing.value;
    }
    const value = factory();
    hookRuntime.slots[index] = { kind: "memo", value, dependencies };
    return value;
  },
  useCallback: (callback: unknown, dependencies: ReadonlyArray<unknown>) => {
    const index = hookRuntime.index++;
    const existing = hookRuntime.slots[index];
    if (existing?.kind === "memo" && dependenciesEqual(existing.dependencies, dependencies)) {
      return existing.value;
    }
    hookRuntime.slots[index] = { kind: "memo", value: callback, dependencies };
    return callback;
  },
  useEffect: (effect: () => void | (() => void), dependencies: ReadonlyArray<unknown>) => {
    const index = hookRuntime.index++;
    const existing = hookRuntime.slots[index];
    if (existing?.kind === "effect" && dependenciesEqual(existing.dependencies, dependencies)) {
      return;
    }
    hookRuntime.slots[index] = {
      kind: "effect",
      dependencies,
      cleanup: existing?.kind === "effect" ? existing.cleanup : undefined,
    };
    hookRuntime.pendingEffects.push({ index, effect });
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => hookRuntime.preferencesResult,
  useAtomSet: () => hookRuntime.savePreferences,
}));

vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: hookRuntime.environments }),
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: Symbol("mobilePreferencesAtom"),
  updateMobilePreferencesAtom: Symbol("updateMobilePreferencesAtom"),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { updateSettings: { label: "test:update-settings" } },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => hookRuntime.persistSettings,
}));

import {
  createProjectCollectionsController,
  type ProjectCollectionsController,
  type ProjectCollectionsView,
  useProjectCollections,
} from "./useProjectCollections";

const alphaId = EnvironmentId.make("environment-alpha");
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

type SyncEnvironment = Parameters<
  typeof createProjectCollectionsController
>[0]["environments"][number];

function environment(
  environmentId: EnvironmentId,
  options: {
    phase?: "available" | "offline" | "connecting" | "reconnecting" | "connected" | "error";
    capable?: boolean;
    document?: ProjectCollectionsDocument | null;
  } = {},
): SyncEnvironment {
  return {
    environmentId,
    connection: { phase: options.phase ?? "connected" },
    capabilities: { projectCollections: options.capable ?? true },
    document:
      options.document === undefined ? DEFAULT_PROJECT_COLLECTIONS_DOCUMENT : options.document,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const persistPreferredReferenceEnvironmentId = vi.fn();
const persistWrite = vi.fn();
let controller: ProjectCollectionsController;

function createController(
  input: {
    environments?: ReadonlyArray<SyncEnvironment>;
    preferredReferenceEnvironmentId?: EnvironmentId | null;
  } = {},
) {
  const environments = input.environments ?? [environment(referenceId), environment(secondaryId)];
  const preferredReferenceEnvironmentId =
    input.preferredReferenceEnvironmentId === undefined
      ? referenceId
      : input.preferredReferenceEnvironmentId;
  controller = createProjectCollectionsController({
    environments,
    preferredReferenceEnvironmentId,
    persistPreferredReferenceEnvironmentId,
    persistWrite,
  });
  controller.refresh({ environments, preferredReferenceEnvironmentId });
  return controller;
}

async function settlePromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function resetHookRuntime() {
  for (const slot of hookRuntime.slots) {
    if (slot.kind === "effect") slot.cleanup?.();
  }
  hookRuntime.slots = [];
  hookRuntime.index = 0;
  hookRuntime.dirty = false;
  hookRuntime.pendingEffects = [];
  hookRuntime.savePreferences.mockReset();
  hookRuntime.persistSettings.mockReset();
}

function renderProjectCollectionsHook(): ProjectCollectionsView {
  let view!: ProjectCollectionsView;
  do {
    hookRuntime.dirty = false;
    hookRuntime.index = 0;
    view = useProjectCollections();
    const effects = hookRuntime.pendingEffects;
    hookRuntime.pendingEffects = [];
    for (const pending of effects) {
      const slot = hookRuntime.slots[pending.index];
      if (slot?.kind !== "effect") continue;
      slot.cleanup?.();
      const cleanup = pending.effect();
      slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
  } while (hookRuntime.dirty);
  return view;
}

beforeEach(() => {
  persistPreferredReferenceEnvironmentId.mockReset();
  persistWrite.mockReset();
  resetHookRuntime();
});

describe("acknowledged mobile project collection synchronization", () => {
  it("does not persist a fallback until the preference blob has loaded", () => {
    hookRuntime.environments = [
      {
        environmentId: alphaId,
        label: "Alpha Mac",
        connection: { phase: "connected" },
        serverConfig: {
          environment: { capabilities: { projectCollections: true } },
          settings: { projectCollections: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT },
        },
      },
    ];
    hookRuntime.preferencesResult = { _tag: "Initial" };

    let view = renderProjectCollectionsHook();
    expect(view.referenceEnvironmentId).toBe(alphaId);
    expect(hookRuntime.savePreferences).not.toHaveBeenCalled();

    hookRuntime.preferencesResult = {
      _tag: "Success",
      value: {},
      waiting: false,
      timestamp: 1,
    };
    view = renderProjectCollectionsHook();
    expect(view.referenceEnvironmentId).toBe(alphaId);
    expect(hookRuntime.savePreferences).toHaveBeenLastCalledWith({
      projectCollectionsPreferredReferenceEnvironmentId: alphaId,
    });
  });

  it("binds loaded preferences, environment labels, and acknowledged atom commands", async () => {
    hookRuntime.environments = [
      {
        environmentId: secondaryId,
        label: "Secondary Mac",
        connection: { phase: "connected" },
        serverConfig: {
          environment: { capabilities: { projectCollections: true } },
          settings: { projectCollections: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT },
        },
      },
      {
        environmentId: referenceId,
        label: "Reference Mac",
        connection: { phase: "connected" },
        serverConfig: {
          environment: { capabilities: { projectCollections: true } },
          settings: { projectCollections: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT },
        },
      },
    ];
    hookRuntime.preferencesResult = {
      _tag: "Success",
      value: { projectCollectionsPreferredReferenceEnvironmentId: referenceId },
      waiting: false,
      timestamp: 0,
    };
    hookRuntime.persistSettings.mockResolvedValue({ _tag: "Success", value: undefined });

    let view = renderProjectCollectionsHook();
    expect(view).toMatchObject({
      referenceEnvironmentId: referenceId,
      referenceLabel: "Reference Mac",
      canMutate: true,
      confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
    });

    expect(view.save(WORK_DOCUMENT)).toEqual({ ok: true, value: WORK_DOCUMENT });
    await settlePromises();
    view = renderProjectCollectionsHook();

    expect(hookRuntime.persistSettings.mock.calls).toEqual([
      [
        {
          environmentId: referenceId,
          input: { patch: { projectCollections: WORK_DOCUMENT } },
        },
      ],
      [
        {
          environmentId: secondaryId,
          input: { patch: { projectCollections: WORK_DOCUMENT } },
        },
      ],
    ]);
    expect(view.status).toMatchObject({ phase: "saved", savedCount: 2, eligibleCount: 2 });

    hookRuntime.preferencesResult = {
      _tag: "Success",
      value: {},
      waiting: false,
      timestamp: 1,
    };
    view = renderProjectCollectionsHook();
    expect(view.referenceEnvironmentId).toBe(referenceId);
    expect(hookRuntime.savePreferences).toHaveBeenLastCalledWith({
      projectCollectionsPreferredReferenceEnvironmentId: referenceId,
    });
  });

  it("honors an explicit preference and otherwise persists lexicographic capable fallback", () => {
    const environments = [environment(thirdId), environment(referenceId), environment(alphaId)];
    createController({ environments, preferredReferenceEnvironmentId: thirdId });

    expect(controller.getState().referenceEnvironmentId).toBe(thirdId);
    expect(persistPreferredReferenceEnvironmentId).not.toHaveBeenCalled();

    controller.refresh({ environments, preferredReferenceEnvironmentId: null });

    expect(controller.getState().referenceEnvironmentId).toBe(alphaId);
    expect(persistPreferredReferenceEnvironmentId).toHaveBeenLastCalledWith(alphaId);
  });

  it("keeps the replacement reference sticky when the preferred environment reconnects", () => {
    createController({ preferredReferenceEnvironmentId: secondaryId });
    expect(controller.getState().referenceEnvironmentId).toBe(secondaryId);

    controller.refresh({
      environments: [environment(secondaryId, { phase: "offline" }), environment(referenceId)],
      preferredReferenceEnvironmentId: secondaryId,
    });
    expect(controller.getState().referenceEnvironmentId).toBe(referenceId);
    expect(persistPreferredReferenceEnvironmentId).toHaveBeenLastCalledWith(referenceId);

    controller.refresh({
      environments: [environment(secondaryId), environment(referenceId)],
      preferredReferenceEnvironmentId: referenceId,
    });
    expect(controller.getState().referenceEnvironmentId).toBe(referenceId);
  });

  it("excludes unloaded, old, and offline environments and is read-only without a real capable document", () => {
    const unloadedId = EnvironmentId.make("environment-unloaded");
    const oldId = EnvironmentId.make("environment-old");
    const offlineId = EnvironmentId.make("environment-offline");
    createController({
      preferredReferenceEnvironmentId: null,
      environments: [
        environment(unloadedId, { document: null }),
        environment(oldId, { capable: false }),
        environment(offlineId, { phase: "offline" }),
        environment(secondaryId),
      ],
    });

    expect(controller.getState()).toMatchObject({
      referenceEnvironmentId: secondaryId,
      eligibleEnvironmentIds: [secondaryId],
    });

    controller.refresh({
      preferredReferenceEnvironmentId: secondaryId,
      environments: [
        environment(unloadedId, { document: null }),
        environment(oldId, { capable: false }),
        environment(secondaryId, { phase: "offline" }),
      ],
    });

    expect(controller.getState()).toMatchObject({
      referenceEnvironmentId: null,
      displayedDocument: null,
      confirmedDocument: null,
    });
    controller.save(WORK_DOCUMENT);
    controller.retry();
    controller.reconcile();
    expect(persistWrite).not.toHaveBeenCalled();
  });

  it("waits for the reference acknowledgement before fanning out the complete document", async () => {
    const referenceWrite = deferred<"acknowledged">();
    persistWrite.mockReturnValueOnce(referenceWrite.promise).mockResolvedValue("acknowledged");
    createController();

    expect(controller.save(WORK_DOCUMENT)).toEqual({ ok: true, value: WORK_DOCUMENT });
    expect(controller.getState()).toMatchObject({
      phase: "saving-reference",
      displayedDocument: WORK_DOCUMENT,
      confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      optimisticDocument: WORK_DOCUMENT,
      rejectedCandidate: null,
    });
    expect(persistWrite.mock.calls).toEqual([
      [{ environmentId: referenceId, document: WORK_DOCUMENT }],
    ]);

    referenceWrite.resolve("acknowledged");
    await settlePromises();

    expect(persistWrite.mock.calls[1]).toEqual([
      { environmentId: secondaryId, document: WORK_DOCUMENT },
    ]);
    await settlePromises();
    expect(controller.getStatus()).toEqual({
      phase: "saved",
      savedCount: 2,
      eligibleCount: 2,
      message: "Saved on 2 of 2 environments",
    });
  });

  it("rolls back a rejected reference, retains the candidate, and retries reference-first", async () => {
    const rejectedWrite = deferred<"rejected">();
    const retriedReference = deferred<"acknowledged">();
    persistWrite
      .mockReturnValueOnce(rejectedWrite.promise)
      .mockReturnValueOnce(retriedReference.promise)
      .mockResolvedValue("acknowledged");
    createController();

    controller.save(WORK_DOCUMENT);
    rejectedWrite.resolve("rejected");
    await settlePromises();

    expect(controller.getState()).toMatchObject({
      phase: "not-saved",
      displayedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      confirmedDocument: DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
      optimisticDocument: null,
      rejectedCandidate: WORK_DOCUMENT,
    });
    expect(persistWrite).toHaveBeenCalledTimes(1);

    controller.retry();
    expect(persistWrite.mock.calls[1]).toEqual([
      { environmentId: referenceId, document: WORK_DOCUMENT },
    ]);
    retriedReference.resolve("acknowledged");
    await settlePromises();
    expect(persistWrite.mock.calls[2]).toEqual([
      { environmentId: secondaryId, document: WORK_DOCUMENT },
    ]);
  });

  it("reports partial counts and retry targets only failed capable environments", async () => {
    const secondaryWrite = deferred<"rejected">();
    const thirdWrite = deferred<"acknowledged">();
    persistWrite
      .mockResolvedValueOnce("acknowledged")
      .mockReturnValueOnce(secondaryWrite.promise)
      .mockReturnValueOnce(thirdWrite.promise)
      .mockResolvedValue("acknowledged");
    createController({
      environments: [environment(thirdId), environment(referenceId), environment(secondaryId)],
    });

    controller.save(WORK_DOCUMENT);
    await settlePromises();
    secondaryWrite.resolve("rejected");
    thirdWrite.resolve("acknowledged");
    await settlePromises();

    expect(controller.getStatus()).toEqual({
      phase: "partial",
      savedCount: 2,
      eligibleCount: 3,
      message: "Saved on 2 of 3 environments",
    });
    expect(controller.getState().mismatchEnvironmentIds).toEqual([secondaryId]);

    controller.retry();
    expect(persistWrite).toHaveBeenCalledTimes(4);
    expect(persistWrite.mock.calls[3]).toEqual([
      { environmentId: secondaryId, document: WORK_DOCUMENT },
    ]);
  });

  it("uses the confirmed reference layout everywhere without rewriting the reference", () => {
    persistWrite.mockResolvedValue("acknowledged");
    createController({
      environments: [
        environment(referenceId, { document: WORK_DOCUMENT }),
        environment(secondaryId),
        environment(thirdId, { document: WORK_DOCUMENT }),
      ],
    });

    expect(controller.getState()).toMatchObject({
      phase: "partial",
      confirmedDocument: WORK_DOCUMENT,
      mismatchEnvironmentIds: [secondaryId],
    });
    controller.reconcile();

    expect(persistWrite.mock.calls).toEqual([
      [{ environmentId: secondaryId, document: WORK_DOCUMENT }],
    ]);
  });

  it("ignores an obsolete result after reconnect dispatches a newer generation", async () => {
    const obsoleteWrite = deferred<"acknowledged">();
    const retryWrite = deferred<"rejected">();
    persistWrite
      .mockResolvedValueOnce("acknowledged")
      .mockReturnValueOnce(obsoleteWrite.promise)
      .mockReturnValueOnce(retryWrite.promise);
    createController();

    controller.save(WORK_DOCUMENT);
    await settlePromises();
    controller.refresh({
      environments: [
        environment(referenceId, { document: WORK_DOCUMENT }),
        environment(secondaryId, { phase: "offline" }),
      ],
      preferredReferenceEnvironmentId: referenceId,
    });
    controller.refresh({
      environments: [
        environment(referenceId, { document: WORK_DOCUMENT }),
        environment(secondaryId),
      ],
      preferredReferenceEnvironmentId: referenceId,
    });

    controller.retry();
    expect(controller.getState().phase).toBe("saving-secondaries");
    expect(persistWrite).toHaveBeenCalledTimes(3);

    obsoleteWrite.resolve("acknowledged");
    await settlePromises();
    expect(controller.getState().phase).toBe("saving-secondaries");

    retryWrite.resolve("rejected");
    await settlePromises();
    expect(controller.getState()).toMatchObject({
      phase: "partial",
      mismatchEnvironmentIds: [secondaryId],
    });
  });
});
