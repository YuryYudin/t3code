import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  createForeignStateHandler,
  mergeForeignEntries,
  ownedEntryKeys,
  subscribeStorageKey,
  type ForeignStateSync,
} from "./lib/crossWindowStorage";
import { resolveStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "unstaged" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

const DIFF_PANEL_STORAGE_KEY = "t3code:diff-panel-state:v1";
const DIFF_PANEL_STORAGE_VERSION = 1;

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "unstaged" };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  selectGitScope: (ref: ScopedThreadRef, scope: "branch" | "unstaged") => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  selectTurn: (ref: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (ref: ScopedThreadRef, availableTurnIds: ReadonlyArray<TurnId>) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      selectGitScope: (ref, scope) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : { kind: "unstaged" },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
          };
        }),
      selectTurn: (ref, turnId, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === "turn" ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (ref, availableTurnIds) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey) && !(threadKey in state.branchBaseRefByThreadKey)) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          return { byThreadKey, branchBaseRefByThreadKey };
        }),
    }),
    {
      name: DIFF_PANEL_STORAGE_KEY,
      version: DIFF_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
      }),
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_SELECTION;
}

interface DiffPanelPersistedState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
}

/** Throws on anything this build cannot use, which skips the foreign write. */
function parseDiffPanelPersistedState(raw: string | null): DiffPanelPersistedState {
  if (raw === null) return { byThreadKey: {}, branchBaseRefByThreadKey: {} };
  const parsed = JSON.parse(raw) as {
    version?: number;
    state?: Partial<DiffPanelPersistedState>;
  };
  if (parsed.version !== DIFF_PANEL_STORAGE_VERSION) {
    throw new Error("unsupported diff panel state version");
  }
  return {
    byThreadKey: Object.fromEntries(
      Object.entries(parsed.state?.byThreadKey ?? {}).filter(
        ([, selection]) => typeof selection === "object" && selection !== null,
      ),
    ),
    branchBaseRefByThreadKey: Object.fromEntries(
      Object.entries(parsed.state?.branchBaseRefByThreadKey ?? {}).filter(
        ([, baseRef]) => baseRef === null || typeof baseRef === "string",
      ),
    ),
  };
}

/**
 * Exported for tests: build a handler with {@link createForeignStateHandler} to
 * fold a foreign window's write into this window without a DOM.
 */
export const foreignDiffPanelStateSync: ForeignStateSync<DiffPanelPersistedState> = {
  snapshot: () => {
    const { byThreadKey, branchBaseRefByThreadKey } = useDiffPanelStore.getState();
    return { byThreadKey, branchBaseRefByThreadKey };
  },
  parse: parseDiffPanelPersistedState,
  merge: ({ local, incoming, baseline }) => ({
    byThreadKey: mergeForeignEntries(
      local.byThreadKey,
      incoming.byThreadKey,
      ownedEntryKeys(local.byThreadKey, baseline.byThreadKey),
    ),
    branchBaseRefByThreadKey: mergeForeignEntries(
      local.branchBaseRefByThreadKey,
      incoming.branchBaseRefByThreadKey,
      ownedEntryKeys(local.branchBaseRefByThreadKey, baseline.branchBaseRefByThreadKey),
    ),
  }),
  apply: (merged) => useDiffPanelStore.setState(merged),
};

subscribeStorageKey(DIFF_PANEL_STORAGE_KEY, createForeignStateHandler(foreignDiffPanelStateSync));
