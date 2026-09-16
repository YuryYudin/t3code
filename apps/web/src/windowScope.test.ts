import { ProjectCollectionId } from "@t3tools/contracts";
import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  canOpenWindowForScope,
  decodeProjectCollectionScope,
  encodeProjectCollectionScope,
  openWindowForScope,
  publishWindowScope,
  readLaunchScopeParam,
  readWindowScope,
  resolveInitialProjectCollectionScope,
  WINDOW_SCOPE_STORAGE_KEY,
  writeWindowScope,
} from "./windowScope";

const collectionId = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => {
      store.clear();
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project collection scope encoding", () => {
  it("round-trips every scope kind", () => {
    const scopes: ReadonlyArray<ProjectCollectionScope> = [
      { kind: "all" },
      { kind: "unfiled" },
      { kind: "collection", collectionId },
      { kind: "project", projectKey: "repository:acme/work" },
    ];

    for (const scope of scopes) {
      expect(decodeProjectCollectionScope(encodeProjectCollectionScope(scope))).toEqual(scope);
    }
    expect(encodeProjectCollectionScope({ kind: "collection", collectionId })).toBe(
      `collection:${collectionId}`,
    );
  });

  it("rejects malformed encodings instead of silently showing all projects", () => {
    for (const value of [
      "",
      "banana",
      "collection",
      "collection:",
      "collection:not-a-uuid",
      "project:",
      "project: leading-space",
      null,
      undefined,
    ]) {
      expect(decodeProjectCollectionScope(value)).toBeNull();
    }
  });

  it("normalizes collection id casing", () => {
    expect(decodeProjectCollectionScope(`collection:${collectionId.toUpperCase()}`)).toEqual({
      kind: "collection",
      collectionId,
    });
  });
});

describe("launch scope param", () => {
  it("reads the scope the desktop shell put before the hash", () => {
    expect(readLaunchScopeParam(`?scope=collection%3A${collectionId}`)).toEqual({
      kind: "collection",
      collectionId,
    });
    expect(readLaunchScopeParam("t3code://app/?scope=unfiled#/")).toEqual({ kind: "unfiled" });
    expect(readLaunchScopeParam("scope=all")).toEqual({ kind: "all" });
  });

  it("ignores absent, unrelated, and hash-only params", () => {
    expect(readLaunchScopeParam("")).toBeNull();
    expect(readLaunchScopeParam(null)).toBeNull();
    expect(readLaunchScopeParam("?other=1")).toBeNull();
    expect(readLaunchScopeParam("?scope=nonsense")).toBeNull();
    expect(readLaunchScopeParam("#/chat?scope=unfiled")).toBeNull();
  });
});

describe("per-window scope storage", () => {
  it("writes and reads this window's scope", () => {
    const storage = createStorageStub();

    writeWindowScope({ kind: "collection", collectionId }, storage);

    expect(storage.getItem(WINDOW_SCOPE_STORAGE_KEY)).toBe(`collection:${collectionId}`);
    expect(readWindowScope(storage)).toEqual({ kind: "collection", collectionId });
  });

  it("stays silent without sessionStorage", () => {
    expect(readWindowScope(null)).toBeNull();
    expect(() => writeWindowScope({ kind: "all" }, null)).not.toThrow();
    // No window at all (SSR / node) resolves to no storage.
    expect(readWindowScope()).toBeNull();
    expect(() => writeWindowScope({ kind: "all" })).not.toThrow();
  });

  it("treats a corrupted stored value as no scope", () => {
    const storage = createStorageStub();
    storage.setItem(WINDOW_SCOPE_STORAGE_KEY, "collection:nope");

    expect(readWindowScope(storage)).toBeNull();
  });
});

describe("hydration precedence", () => {
  it("prefers the window's own scope, then the launch param, then the shared default", () => {
    const launch = { kind: "collection", collectionId } as const;
    const session = { kind: "unfiled" } as const;
    const persisted = { kind: "project", projectKey: "repository:acme/work" } as const;

    // A reload re-runs the launch URL; the user's later choice must survive it.
    expect(resolveInitialProjectCollectionScope({ launch, session, persisted })).toEqual(session);
    expect(resolveInitialProjectCollectionScope({ launch, session: null, persisted })).toEqual(
      launch,
    );
    expect(
      resolveInitialProjectCollectionScope({ launch: null, session: null, persisted }),
    ).toEqual(persisted);
  });
});

describe("desktop window bridge", () => {
  it("is unavailable without a bridge that can open windows", () => {
    expect(canOpenWindowForScope()).toBe(false);
    expect(canOpenWindowForScope({})).toBe(false);
    expect(canOpenWindowForScope({ openWindow: async () => {} })).toBe(true);
  });

  it("opens a window with the encoded scope and swallows failures", async () => {
    const openWindow = vi.fn(async () => {});
    openWindowForScope({ kind: "collection", collectionId }, { openWindow });
    expect(openWindow).toHaveBeenCalledWith({ scope: `collection:${collectionId}` });

    const failing = vi.fn(() => Promise.reject(new Error("no window")));
    expect(() => openWindowForScope({ kind: "all" }, { openWindow: failing })).not.toThrow();
    await Promise.resolve();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("publishes a scope change to sessionStorage and the desktop shell", () => {
    const storage = createStorageStub();
    const setWindowScope = vi.fn(async () => {});

    publishWindowScope({ kind: "unfiled" }, { storage, bridge: { setWindowScope } });

    expect(storage.getItem(WINDOW_SCOPE_STORAGE_KEY)).toBe("unfiled");
    expect(setWindowScope).toHaveBeenCalledWith("unfiled");
  });

  it("still records the scope when no desktop bridge exists", () => {
    const storage = createStorageStub();

    expect(() => publishWindowScope({ kind: "all" }, { storage, bridge: {} })).not.toThrow();
    expect(() => publishWindowScope({ kind: "all" }, { storage })).not.toThrow();
    expect(storage.getItem(WINDOW_SCOPE_STORAGE_KEY)).toBe("all");
  });
});
