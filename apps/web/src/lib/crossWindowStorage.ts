/**
 * Folds other windows' writes of a shared localStorage blob into this window.
 * A window owns, and defends, keys it changed since it last synced; it writes
 * back only then, because echoing every snapshot made 3+ windows loop forever.
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

function defaultStorageRead(key: string): (() => string | null) | undefined {
  if (typeof window === "undefined" || window.localStorage === undefined) return undefined;
  return () => window.localStorage.getItem(key);
}

/**
 * Calls `listener` with the key's live value whenever another document writes
 * it. Events queue, so an event's `newValue` may already be stale; `read`
 * returns what storage holds now. A no-op outside a browser.
 */
export function subscribeStorageKey(
  key: string,
  listener: (raw: string | null) => void,
  target: StorageEventTargetLike | null = defaultStorageEventTarget(),
  read: (() => string | null) | undefined = target === null ? undefined : defaultStorageRead(key),
): () => void {
  if (target === null) return () => {};
  const handle = (event: StorageEventLike) => {
    // A null key is another document calling `storage.clear()`: everything went.
    if (event.key !== null && event.key !== key) return;
    if (read) {
      listener(read());
      return;
    }
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

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  // JSON drops undefined members, so a parsed snapshot never carries them.
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length ===
      Object.values(rightRecord).filter((value) => value !== undefined).length &&
    leftEntries.every(([key, value]) => sameJson(value, rightRecord[key]))
  );
}

/**
 * {@link mergeForeignEntries} for JSON entries, or null when storage already
 * holds this window's entries, so nothing is written back. Entries compare by
 * content: an entry rebuilt unchanged is not an edit worth defending.
 */
export function mergeForeignRecord<T>(
  local: Record<string, T>,
  incoming: Record<string, T>,
  baseline: Record<string, T>,
): Record<string, T> | null {
  const incomingKeys = Object.keys(incoming);
  let matchesLocal = incomingKeys.length === Object.keys(local).length;
  const reconciled: Record<string, T> = {};
  for (const key of incomingKeys) {
    const value = incoming[key] as T;
    if (key in local && sameJson(local[key], value)) {
      reconciled[key] = local[key] as T;
    } else {
      reconciled[key] = value;
      matchesLocal = false;
    }
  }
  if (matchesLocal) return null;
  const owned = new Set<string>();
  for (const key of ownedEntryKeys(local, baseline)) {
    if (!(key in local) || !(key in baseline) || !sameJson(local[key], baseline[key])) {
      owned.add(key);
    }
  }
  return mergeForeignEntries(local, reconciled, owned);
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
  /** Deferred stores can keep local edits owned until a foreign write acknowledges them. */
  readonly acknowledge?: (incoming: T) => T;
}

/**
 * Builds one store's foreign-write handler; tests feed it raw values directly.
 * Applying a merge equal to local state is deliberate: the store's write puts
 * owned keys back in storage. A null merge means nothing to adopt or defend.
 */
export function createForeignStateHandler<T>(
  sync: ForeignStateSync<T>,
): (raw: string | null) => void {
  let baseline = sync.snapshot();
  let lastRaw: string | null | undefined;
  let lastLocal: T | undefined;
  return (raw) => {
    const local = sync.snapshot();
    // Storage can return to a value seen before after this window changed
    // state, so a repeat only counts when local state is also unchanged.
    if (raw === lastRaw && local === lastLocal) return;
    lastRaw = raw;
    let incoming: T;
    try {
      incoming = sync.parse(raw);
    } catch {
      return;
    }
    const merged = sync.merge({ local, incoming, baseline });
    if (merged === null) {
      baseline = local;
      lastLocal = local;
      return;
    }
    baseline = sync.acknowledge?.(incoming) ?? merged;
    sync.apply(merged);
    lastLocal = sync.snapshot();
  };
}
