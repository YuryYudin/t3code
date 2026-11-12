import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

type StorageListener = (event: { key: string | null; newValue: string | null }) => void;
type RightPanelStore = (typeof import("./rightPanelStore"))["useRightPanelStore"];

const ref = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-T"));
const threadKey = scopedThreadKey(ref);
const originalWindow = (globalThis as { window?: unknown }).window;

/**
 * Same-origin windows sharing one localStorage. Each window queues the
 * `storage` events other windows cause and handles them when `deliver` picks
 * it, so tests control the interleaving a browser leaves unspecified.
 */
function createWindows() {
  const storage = new Map<string, string>();
  const windows: { listeners: Set<StorageListener>; queue: (() => void)[] }[] = [];
  let writes = 0;

  async function open(): Promise<RightPanelStore> {
    const self = { listeners: new Set<StorageListener>(), queue: [] as (() => void)[] };
    windows.push(self);
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          // Browsers fire no event when the stored value is unchanged.
          if (storage.get(key) === value) return;
          storage.set(key, value);
          writes += 1;
          for (const other of windows) {
            if (other === self) continue;
            for (const listener of other.listeners) {
              other.queue.push(() => listener({ key, newValue: value }));
            }
          }
        },
        removeItem: (key: string) => storage.delete(key),
      },
      addEventListener: (_type: string, listener: StorageListener) => self.listeners.add(listener),
      removeEventListener: (_type: string, listener: StorageListener) =>
        self.listeners.delete(listener),
    };
    vi.resetModules();
    return (await import("./rightPanelStore")).useRightPanelStore;
  }

  /** Hands queued events to windows in a seeded order; returns events delivered. */
  function deliver(seed: number, limit: number): number {
    let state = seed;
    let delivered = 0;
    while (delivered < limit) {
      const pending = windows.filter((entry) => entry.queue.length > 0);
      if (pending.length === 0) break;
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      const chosen = pending[Math.floor((state / 2_147_483_648) * pending.length)];
      chosen?.queue.shift()?.();
      delivered += 1;
    }
    return delivered;
  }

  return { open, deliver, writes: () => writes };
}

function isOpen(store: RightPanelStore) {
  return store.getState().byThreadKey[threadKey]?.isOpen ?? false;
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  vi.resetModules();
});

describe("right panel across windows", () => {
  it.each([3, 4])(
    "closing a maximized file panel settles closed in %i windows",
    async (windowCount) => {
      for (let seed = 1; seed <= 40; seed += 1) {
        const harness = createWindows();
        const stores: RightPanelStore[] = [];
        for (let index = 0; index < windowCount; index += 1) stores.push(await harness.open());
        const [clicking] = stores;
        if (!clicking) throw new Error("no window");
        clicking.getState().openFile(ref, "README.md");
        clicking.getState().setMaximized(ref, true);
        harness.deliver(seed, 1_000);

        const writesBeforeClose = harness.writes();
        clicking.getState().close(ref);
        const delivered = harness.deliver(seed, 1_000);

        expect(delivered, `seed ${seed}`).toBeLessThan(50);
        expect(harness.writes() - writesBeforeClose, `seed ${seed}`).toBeLessThan(windowCount * 2);
        expect(stores.map(isOpen), `seed ${seed}`).toEqual(stores.map(() => false));
      }
    },
  );

  it("a window touching the same thread mid-close still ends closed", async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const harness = createWindows();
      const clicking = await harness.open();
      const other = await harness.open();
      clicking.getState().openFile(ref, "README.md");
      harness.deliver(seed, 1_000);

      clicking.getState().close(ref);
      // The other window's preview reconciliation rewrites the thread before
      // the close reaches it.
      other.getState().reconcileBrowserSurfaces(ref, [], new Set());
      harness.deliver(seed, 1_000);

      expect([isOpen(clicking), isOpen(other)], `seed ${seed}`).toEqual([false, false]);
    }
  });
});
