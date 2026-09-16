/**
 * Cross-window localStorage reconciliation.
 *
 * Several client stores persist a whole blob under one localStorage key, so
 * two windows (desktop multi-window, or two same-origin browser tabs) editing
 * different threads used to overwrite each other: last writer wins. These
 * helpers let a store listen for foreign writes and fold them into its own
 * state instead of ignoring them.
 *
 * Ownership rule: a window owns a key whose current value is not the value it
 * last synced with storage — that is, any key it changed since its last
 * hydration or merge — and ownership ends once that merge result is synced
 * back. Ownership is therefore derived from a baseline snapshot rather than
 * tracked by instrumenting every store action; because stores update
 * immutably, "changed" is a value-reference comparison.
 */

export interface StorageEventLike {
  readonly key: string | null;
  readonly newValue: string | null;
}

export interface StorageEventTargetLike {
  addEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
}

function defaultStorageEventTarget(): StorageEventTargetLike | null {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return null;
  return window;
}

/**
 * Calls `listener` with the key's new raw value whenever another document
 * writes it. The browser never fires `storage` for the window that performed
 * the write, so this only ever reports foreign changes. A no-op (and an
 * unsubscribe that does nothing) outside a browser.
 */
export function subscribeStorageKey(
  key: string,
  listener: (raw: string | null) => void,
  target: StorageEventTargetLike | null = defaultStorageEventTarget(),
): () => void {
  if (target === null) return () => {};
  const handle = (event: StorageEventLike) => {
    // A null key is another document calling `storage.clear()`: everything went.
    if (event.key !== null && event.key !== key) return;
    listener(event.key === null ? null : event.newValue);
  };
  target.addEventListener("storage", handle);
  return () => target.removeEventListener("storage", handle);
}

/**
 * Keys whose current value differs from the last synced snapshot, i.e. the
 * ones this window changed (including ones it deleted) and must defend.
 */
export function ownedEntryKeys<T>(
  local: Record<string, T>,
  baseline: Record<string, T>,
): ReadonlySet<string> {
  if (local === baseline) return new Set();
  const owned = new Set<string>();
  for (const [key, value] of Object.entries(local)) {
    if (baseline[key] !== value) owned.add(key);
  }
  for (const key of Object.keys(baseline)) {
    if (!(key in local)) owned.add(key);
  }
  return owned;
}

/**
 * Folds a foreign snapshot of a keyed map into the local one: owned keys keep
 * their local value (or stay deleted), every other key takes the incoming
 * value, including removal when the foreign snapshot dropped it. Returns
 * `local` itself when nothing changes, so subscribers do not re-render.
 */
export function mergeForeignEntries<T>(
  local: Record<string, T>,
  incoming: Record<string, T>,
  ownedKeys: ReadonlySet<string>,
): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const [key, value] of Object.entries(local)) {
    if (ownedKeys.has(key)) {
      merged[key] = value;
    } else if (key in incoming) {
      merged[key] = incoming[key] as T;
    }
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in merged) && !ownedKeys.has(key)) merged[key] = value;
  }
  const mergedKeys = Object.keys(merged);
  const unchanged =
    mergedKeys.length === Object.keys(local).length &&
    mergedKeys.every((key) => merged[key] === local[key]);
  return unchanged ? local : merged;
}

export interface ForeignStateSync<T> {
  /** The store's current view of the persisted shape. */
  readonly snapshot: () => T;
  /** Normalizes a raw storage value through the store's existing migrate path. */
  readonly parse: (raw: string | null) => T;
  /** Returns the state to apply, or null when the foreign write needs no action. */
  readonly merge: (input: {
    readonly local: T;
    readonly incoming: T;
    readonly baseline: T;
  }) => T | null;
  readonly apply: (merged: T) => void;
}

/**
 * Builds the foreign-write handler for one store. Kept separate from
 * {@link subscribeStorageKey} so tests can feed it raw storage values without
 * a DOM. Applying a merge that equals the local state is deliberate for stores
 * that defend owned keys: the resulting store write puts those keys back in
 * storage, which the other window then picks up.
 */
export function createForeignStateHandler<T>(
  sync: ForeignStateSync<T>,
): (raw: string | null) => void {
  let baseline = sync.snapshot();
  let lastRaw: string | null | undefined;
  return (raw) => {
    if (raw === lastRaw) return;
    lastRaw = raw;
    const local = sync.snapshot();
    let incoming: T;
    try {
      incoming = sync.parse(raw);
    } catch {
      return;
    }
    const merged = sync.merge({ local, incoming, baseline });
    if (merged === null) {
      baseline = local;
      return;
    }
    baseline = merged;
    sync.apply(merged);
  };
}
