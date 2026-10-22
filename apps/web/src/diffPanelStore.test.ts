import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, RunId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createForeignStateHandler } from "./lib/crossWindowStorage";
import {
  foreignDiffPanelStateSync,
  selectThreadDiffPanelSelection,
  useDiffPanelSessionStore,
  useDiffPanelStore,
} from "./diffPanelStore";

const THREAD_REF = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));

describe("diffPanelStore", () => {
  beforeEach(() => {
    useDiffPanelStore.setState({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
    });
    useDiffPanelSessionStore.setState({ collapsedFileKeysByScopeKey: {} });
  });

  it("retains fold choices when a panel consumer returns with fresh defaults", () => {
    const scopeKey = "environment-1:thread-1:branch";
    const defaults = new Set(["src/app.ts", "src/index.ts"]);
    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, defaults, (current) => {
      const next = new Set(current);
      next.delete("src/app.ts");
      return next;
    });

    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(["src/index.ts"]),
    );

    useDiffPanelSessionStore.getState().updateCollapsedFileKeys(scopeKey, new Set(), (current) => {
      const next = new Set(current);
      next.delete("src/index.ts");
      return next;
    });
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );

    useDiffPanelSessionStore
      .getState()
      .updateCollapsedFileKeys(scopeKey, defaults, (current) => current);
    expect(useDiffPanelSessionStore.getState().collapsedFileKeysByScopeKey[scopeKey]).toEqual(
      new Set(),
    );
    expect(defaults).toEqual(new Set(["src/app.ts", "src/index.ts"]));
  });
});

describe("diffPanelStore cross-window merging", () => {
  it("adopts another window's threads while defending the one it edited", () => {
    const refB = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-2"));
    const refC = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-3"));
    const keyOf = (ref: typeof THREAD_REF) => scopedThreadKey(ref);
    useDiffPanelStore.setState({
      byThreadKey: {
        [keyOf(THREAD_REF)]: { kind: "branch", baseRef: null },
        [keyOf(refC)]: { kind: "unstaged" },
      },
      branchBaseRefByThreadKey: {},
    });
    const handler = createForeignStateHandler(foreignDiffPanelStateSync);

    // This window edits thread A, so it owns that key from here on.
    useDiffPanelStore.getState().selectGitScope(THREAD_REF, "unstaged");

    handler(
      JSON.stringify({
        version: 2,
        state: {
          byThreadKey: {
            [keyOf(THREAD_REF)]: { kind: "branch", baseRef: "main" },
            [keyOf(refB)]: { kind: "unstaged" },
          },
          branchBaseRefByThreadKey: {},
        },
      }),
    );

    const { byThreadKey } = useDiffPanelStore.getState();
    expect(byThreadKey[keyOf(THREAD_REF)]).toEqual({ kind: "unstaged" });
    expect(byThreadKey[keyOf(refB)]).toEqual({ kind: "unstaged" });
    expect(byThreadKey[keyOf(refC)]).toBeUndefined();
  });
});
