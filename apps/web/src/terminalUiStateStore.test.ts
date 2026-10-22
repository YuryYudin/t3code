import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { createForeignStateHandler } from "./lib/crossWindowStorage";
import {
  foreignTerminalUiStateSync,
  migratePersistedTerminalUiStateStoreState,
  selectThreadTerminalUiState,
  useTerminalUiStateStore,
} from "./terminalUiStateStore";
import { DEFAULT_THREAD_TERMINAL_ID } from "./types";

const THREAD_ID = ThreadId.make("thread-1");
const THREAD_REF = scopeThreadRef("environment-a" as never, THREAD_ID);
const OTHER_THREAD_REF = scopeThreadRef("environment-b" as never, THREAD_ID);

describe("terminalUiStateStore actions", () => {
  beforeEach(() => {
    useTerminalUiStateStore.persist.clearStorage();
    useTerminalUiStateStore.setState({
      terminalUiStateByThreadKey: {},
      suppressedTerminalIdsByThreadKey: {},
    });
  });

  it("caps splits at four terminals per group", () => {
    const store = useTerminalUiStateStore.getState();
    store.splitTerminal(THREAD_REF, "terminal-2");
    store.splitTerminal(THREAD_REF, "terminal-3");
    store.splitTerminal(THREAD_REF, "terminal-4");
    store.splitTerminal(THREAD_REF, "terminal-5");
    store.splitTerminal(THREAD_REF, "terminal-6");

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalUiState.terminalIds).toEqual([
      "terminal-2",
      "terminal-3",
      "terminal-4",
      "terminal-5",
    ]);
    expect(terminalUiState.terminalGroups).toEqual([
      {
        id: "group-terminal-2",
        terminalIds: ["terminal-2", "terminal-3", "terminal-4", "terminal-5"],
      },
    ]);
  });

  it("keeps state isolated per environment when raw thread ids collide", () => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(THREAD_REF, true);
    store.newTerminal(OTHER_THREAD_REF, "env-b-terminal");

    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        THREAD_REF,
      ).terminalOpen,
    ).toBe(true);
    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        OTHER_THREAD_REF,
      ).terminalIds,
    ).toEqual(["env-b-terminal"]);
  });

  it("drops persisted entries whose thread keys are not valid scoped keys", () => {
    const migrated = migratePersistedTerminalUiStateStoreState(
      {
        terminalStateByThreadKey: {
          [scopedThreadKey(THREAD_REF)]: {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["term-1"],
            activeTerminalId: "term-1",
            terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
            activeTerminalGroupId: "group-term-1",
          },
          "legacy-thread-id": {
            terminalOpen: true,
            terminalHeight: 320,
            terminalIds: ["term-1"],
            activeTerminalId: "term-1",
            terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
            activeTerminalGroupId: "group-term-1",
          },
        },
      },
      2,
    );

    expect(migrated).toEqual({
      terminalUiStateByThreadKey: {
        [scopedThreadKey(THREAD_REF)]: {
          terminalOpen: true,
          terminalHeight: 320,
          terminalIds: ["term-1"],
          activeTerminalId: "term-1",
          terminalGroups: [{ id: "group-term-1", terminalIds: ["term-1"] }],
          activeTerminalGroupId: "group-term-1",
        },
      },
    });
  });

  it("resets to default and clears persisted entry when closing the last terminal", () => {
    const store = useTerminalUiStateStore.getState();
    store.newTerminal(THREAD_REF, "terminal-only");
    store.closeTerminal(THREAD_REF, "terminal-only");

    expect(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey[scopedThreadKey(THREAD_REF)],
    ).toBeUndefined();
    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        THREAD_REF,
      ).terminalIds,
    ).toEqual([]);
  });

  it("keeps a valid active terminal after closing an active split terminal", () => {
    const store = useTerminalUiStateStore.getState();
    store.splitTerminal(THREAD_REF, "terminal-2");
    store.splitTerminal(THREAD_REF, "terminal-3");
    store.closeTerminal(THREAD_REF, "terminal-3");

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalUiState.activeTerminalId).toBe("terminal-2");
    expect(terminalUiState.terminalIds).toEqual(["terminal-2"]);
    expect(terminalUiState.terminalGroups).toEqual([
      { id: "group-terminal-2", terminalIds: ["terminal-2"] },
    ]);
  });

  it.each([
    ["terminal-3", "terminal-3", DEFAULT_THREAD_TERMINAL_ID],
    [DEFAULT_THREAD_TERMINAL_ID, DEFAULT_THREAD_TERMINAL_ID, "terminal-3"],
    ["terminal-3", DEFAULT_THREAD_TERMINAL_ID, "terminal-3"],
  ])("keeps the split's tab when %s is active and %s closes", (activeId, closedId, nextId) => {
    const store = useTerminalUiStateStore.getState();
    store.setTerminalOpen(THREAD_REF, true);
    store.newTerminal(THREAD_REF, "terminal-2");
    store.setActiveTerminal(THREAD_REF, DEFAULT_THREAD_TERMINAL_ID);
    store.splitTerminal(THREAD_REF, "terminal-3");
    store.setActiveTerminal(THREAD_REF, activeId);
    store.closeTerminal(THREAD_REF, closedId);

    const terminalUiState = selectThreadTerminalUiState(
      useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
      THREAD_REF,
    );
    expect(terminalUiState.activeTerminalId).toBe(nextId);
    expect(terminalUiState.activeTerminalGroupId).toBe(`group-${DEFAULT_THREAD_TERMINAL_ID}`);
  });

  it("does not import a closed panel terminal from stale metadata", () => {
    const store = useTerminalUiStateStore.getState();
    store.newTerminal(THREAD_REF, "term-2");
    store.closeTerminal(THREAD_REF, "term-1");

    store.reconcileTerminalIds(THREAD_REF, ["term-1", "term-2"]);

    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        THREAD_REF,
      ).terminalIds,
    ).toEqual(["term-2"]);

    store.newTerminal(THREAD_REF, "term-1");
    expect(
      selectThreadTerminalUiState(
        useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
        THREAD_REF,
      ).terminalIds,
    ).toEqual(["term-2", "term-1"]);
  });
});

describe("terminalUiStateStore cross-window merging", () => {
  const THIRD_THREAD_REF = scopeThreadRef("environment-c" as never, THREAD_ID);

  function terminalUiState(overrides: { terminalOpen: boolean; terminalHeight: number }) {
    return {
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
      terminalGroups: [],
      activeTerminalGroupId: DEFAULT_THREAD_TERMINAL_ID,
      ...overrides,
    };
  }

  it("adopts another window's threads while defending the one it edited", () => {
    useTerminalUiStateStore.setState({
      terminalUiStateByThreadKey: {
        [scopedThreadKey(THREAD_REF)]: terminalUiState({
          terminalOpen: false,
          terminalHeight: 200,
        }),
        [scopedThreadKey(THIRD_THREAD_REF)]: terminalUiState({
          terminalOpen: true,
          terminalHeight: 240,
        }),
      },
      suppressedTerminalIdsByThreadKey: {},
    });
    const handler = createForeignStateHandler(foreignTerminalUiStateSync);

    // This window opens the drawer for its thread, so it owns that key now.
    useTerminalUiStateStore.getState().setTerminalOpen(THREAD_REF, true);

    handler(
      JSON.stringify({
        version: 4,
        state: {
          terminalUiStateByThreadKey: {
            [scopedThreadKey(THREAD_REF)]: terminalUiState({
              terminalOpen: false,
              terminalHeight: 400,
            }),
            [scopedThreadKey(OTHER_THREAD_REF)]: terminalUiState({
              terminalOpen: true,
              terminalHeight: 320,
            }),
          },
        },
      }),
    );

    const { terminalUiStateByThreadKey } = useTerminalUiStateStore.getState();
    expect(terminalUiStateByThreadKey[scopedThreadKey(THREAD_REF)]?.terminalOpen).toBe(true);
    expect(terminalUiStateByThreadKey[scopedThreadKey(THREAD_REF)]?.terminalHeight).toBe(200);
    expect(terminalUiStateByThreadKey[scopedThreadKey(OTHER_THREAD_REF)]?.terminalHeight).toBe(320);
    expect(terminalUiStateByThreadKey[scopedThreadKey(THIRD_THREAD_REF)]).toBeUndefined();
  });
});
