import { describe, expect, it } from "vite-plus/test";

import {
  createForeignStateHandler,
  mergeForeignEntries,
  ownedEntryKeys,
  subscribeStorageKey,
  type StorageEventLike,
  type StorageEventTargetLike,
} from "./crossWindowStorage";

function createTarget() {
  const listeners = new Set<(event: StorageEventLike) => void>();
  const target: StorageEventTargetLike = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  return {
    target,
    listenerCount: () => listeners.size,
    emit: (event: StorageEventLike) => {
      for (const listener of listeners) listener(event);
    },
  };
}

describe("subscribeStorageKey", () => {
  it("reports writes to its key and ignores other keys", () => {
    const { target, emit } = createTarget();
    const seen: (string | null)[] = [];
    subscribeStorageKey("key", (raw) => seen.push(raw), target);

    emit({ key: "other", newValue: "ignored" });
    emit({ key: "key", newValue: "next" });

    expect(seen).toEqual(["next"]);
  });

  it("treats a cleared storage (null key) as the key being removed", () => {
    const { target, emit } = createTarget();
    const seen: (string | null)[] = [];
    subscribeStorageKey("key", (raw) => seen.push(raw), target);

    emit({ key: null, newValue: null });

    expect(seen).toEqual([null]);
  });

  it("stops reporting after unsubscribe", () => {
    const { target, emit, listenerCount } = createTarget();
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeStorageKey("key", (raw) => seen.push(raw), target);

    unsubscribe();
    emit({ key: "key", newValue: "next" });

    expect(listenerCount()).toBe(0);
    expect(seen).toEqual([]);
  });

  it("is a no-op without a browser event target", () => {
    const unsubscribe = subscribeStorageKey("key", () => {}, null);
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("ownedEntryKeys", () => {
  it("owns keys this window added, changed, or deleted since the baseline", () => {
    const shared = { value: "shared" };
    const baseline = { kept: shared, changed: { value: "old" }, dropped: { value: "gone" } };
    const local = { kept: shared, changed: { value: "new" }, added: { value: "added" } };

    expect([...ownedEntryKeys(local, baseline)].sort()).toEqual(["added", "changed", "dropped"]);
  });

  it("owns nothing when the map is still the synced one", () => {
    const baseline = { a: 1 };
    expect(ownedEntryKeys(baseline, baseline).size).toBe(0);
  });
});

describe("mergeForeignEntries", () => {
  it("keeps owned entries and takes foreign additions, changes, and deletions", () => {
    const merged = mergeForeignEntries(
      { owned: "mine", changed: "old", deleted: "still-here" },
      { owned: "theirs", changed: "new", added: "fresh" },
      new Set(["owned"]),
    );

    expect(merged).toEqual({ owned: "mine", changed: "new", added: "fresh" });
  });

  it("keeps an owned key deleted locally even when the foreign snapshot still has it", () => {
    const merged = mergeForeignEntries({}, { gone: "theirs" }, new Set(["gone"]));

    expect(merged).toEqual({});
  });

  it("returns the same reference when nothing changes", () => {
    const local = { a: "one", b: "two" };
    const merged = mergeForeignEntries(local, { a: "one", b: "two" }, new Set(["a", "b"]));

    expect(merged).toBe(local);
  });
});

describe("createForeignStateHandler", () => {
  interface Fake {
    byKey: Record<string, string>;
  }

  function createFakeStore(initial: Record<string, string>) {
    let state: Fake = { byKey: initial };
    const applied: Fake[] = [];
    const handler = createForeignStateHandler<Fake>({
      snapshot: () => state,
      parse: (raw) => ({ byKey: raw === null ? {} : (JSON.parse(raw) as Record<string, string>) }),
      merge: ({ local, incoming, baseline }) => ({
        byKey: mergeForeignEntries(
          local.byKey,
          incoming.byKey,
          ownedEntryKeys(local.byKey, baseline.byKey),
        ),
      }),
      apply: (merged) => {
        applied.push(merged);
        state = merged;
      },
    });
    return {
      handler,
      applied,
      write: (byKey: Record<string, string>) => {
        state = { byKey };
      },
      read: () => state.byKey,
    };
  }

  it("defends keys written since the last sync and adopts the rest", () => {
    const store = createFakeStore({ a: "hydrated", c: "hydrated" });
    store.write({ a: "mine", c: "hydrated" });

    store.handler(JSON.stringify({ a: "theirs", b: "theirs" }));

    // `a` is owned, `b` arrives, `c` was dropped by the other window.
    expect(store.read()).toEqual({ a: "mine", b: "theirs" });
  });

  it("releases ownership once the merge result is synced back", () => {
    const store = createFakeStore({ a: "hydrated" });
    store.write({ a: "mine" });
    store.handler(JSON.stringify({ a: "theirs" }));
    expect(store.read()).toEqual({ a: "mine" });

    store.handler(JSON.stringify({}));

    expect(store.read()).toEqual({});
  });

  it("ignores a repeat of the value it last saw", () => {
    const store = createFakeStore({});
    store.handler(JSON.stringify({ a: "theirs" }));
    store.handler(JSON.stringify({ a: "theirs" }));

    expect(store.applied.length).toBe(1);
  });

  it("skips unparseable foreign writes", () => {
    const store = createFakeStore({ a: "mine" });

    store.handler("not json");

    expect(store.applied).toEqual([]);
    expect(store.read()).toEqual({ a: "mine" });
  });
});
