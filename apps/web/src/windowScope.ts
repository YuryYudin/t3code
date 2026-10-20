import {
  MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH,
  ProjectCollectionId as ProjectCollectionIdSchema,
} from "@t3tools/contracts";
import {
  ALL_PROJECTS_COLLECTION_SCOPE,
  type ProjectCollectionScope,
} from "@t3tools/client-runtime/state/project-collections";
import * as Schema from "effect/Schema";

/**
 * Per-window sidebar scope. Desktop opens each window at `?scope=<encoded>` and
 * every window (or browser tab) keeps its own scope in sessionStorage, so two
 * windows can show different collections without fighting over the shared
 * localStorage ui-state blob.
 */
export const WINDOW_SCOPE_STORAGE_KEY = "t3code:window-scope:v1";
export const LAUNCH_SCOPE_SEARCH_PARAM = "scope";

const isProjectCollectionId = Schema.is(ProjectCollectionIdSchema);

/**
 * Accepts any persisted/untrusted shape and returns a usable scope, falling
 * back to "all projects". Shared by the ui-state hydration path and the
 * launch-URL decoder so both apply the same rules.
 */
export function sanitizePersistedProjectCollectionScope(value: unknown): ProjectCollectionScope {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return ALL_PROJECTS_COLLECTION_SCOPE;
  }
  if (value.kind === "all") return ALL_PROJECTS_COLLECTION_SCOPE;
  if (value.kind === "unfiled") return { kind: "unfiled" };
  if (value.kind === "collection" && "collectionId" in value) {
    const collectionId =
      typeof value.collectionId === "string" ? value.collectionId.toLowerCase() : null;
    if (isProjectCollectionId(collectionId)) {
      return { kind: "collection", collectionId };
    }
  }
  if (
    value.kind === "project" &&
    "projectKey" in value &&
    typeof value.projectKey === "string" &&
    value.projectKey.trim().length > 0 &&
    value.projectKey.trim() === value.projectKey &&
    value.projectKey.length <= MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH
  ) {
    return { kind: "project", projectKey: value.projectKey };
  }
  return ALL_PROJECTS_COLLECTION_SCOPE;
}

/** `all` | `unfiled` | `collection:<id>` | `project:<key>`. */
export function encodeProjectCollectionScope(scope: ProjectCollectionScope): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "unfiled":
      return "unfiled";
    case "collection":
      return `collection:${scope.collectionId}`;
    case "project":
      return `project:${scope.projectKey}`;
  }
}

/** Inverse of {@link encodeProjectCollectionScope}. Null for anything unusable. */
export function decodeProjectCollectionScope(
  value: string | null | undefined,
): ProjectCollectionScope | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value === "all") return ALL_PROJECTS_COLLECTION_SCOPE;
  if (value === "unfiled") return { kind: "unfiled" };
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);
  const candidate =
    kind === "collection"
      ? { kind, collectionId: rest }
      : kind === "project"
        ? { kind, projectKey: rest }
        : null;
  if (candidate === null) return null;
  const sanitized = sanitizePersistedProjectCollectionScope(candidate);
  // Sanitizing falls back to "all" for invalid ids; that is a decode failure
  // here, because an "all" window must not be conjured from a broken URL.
  return sanitized.kind === candidate.kind ? sanitized : null;
}

/**
 * Reads the launch scope from a location search string. Tolerates a full URL or
 * a hash-router location, since the desktop shell puts the query before the
 * hash (`t3code://app/?scope=…#/`).
 */
export function readLaunchScopeParam(
  search: string | null | undefined,
): ProjectCollectionScope | null {
  if (typeof search !== "string" || search.length === 0) return null;
  const withoutHash = search.split("#")[0] ?? "";
  const questionMark = withoutHash.indexOf("?");
  const query = questionMark < 0 ? withoutHash : withoutHash.slice(questionMark + 1);
  if (query.length === 0) return null;
  try {
    return decodeProjectCollectionScope(new URLSearchParams(query).get(LAUNCH_SCOPE_SEARCH_PARAM));
  } catch {
    return null;
  }
}

function windowSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    // Storage access can throw outright under strict cookie policies.
    return null;
  }
}

/** The scope this window last selected, or null when it has none yet. */
export function readWindowScope(storage: Storage | null = windowSessionStorage()) {
  if (storage === null) return null;
  try {
    return decodeProjectCollectionScope(storage.getItem(WINDOW_SCOPE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeWindowScope(
  scope: ProjectCollectionScope,
  storage: Storage | null = windowSessionStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(WINDOW_SCOPE_STORAGE_KEY, encodeProjectCollectionScope(scope));
  } catch {
    // Quota/private-mode failures must never break scope switching.
  }
}

/**
 * This window's own memory wins over the launch URL, which wins over the shared
 * default. A fresh window has no memory, so its launch scope applies; after
 * that the user's later choice must survive a reload even though the launch
 * URL (still carrying the original `?scope=`) is loaded again.
 */
export function resolveInitialProjectCollectionScope(input: {
  readonly launch: ProjectCollectionScope | null;
  readonly session: ProjectCollectionScope | null;
  readonly persisted: ProjectCollectionScope;
}): ProjectCollectionScope {
  return input.session ?? input.launch ?? input.persisted;
}

export interface WindowScopeBridge {
  readonly openWindow?: (input: { scope?: string }) => Promise<void>;
  readonly setWindowScope?: (scope: string) => Promise<void>;
}

function windowScopeBridge(): WindowScopeBridge | undefined {
  return typeof window === "undefined" ? undefined : window.desktopBridge;
}

/** True only on a desktop shell new enough to expose window management. */
export function canOpenWindowForScope(bridge?: WindowScopeBridge): boolean {
  return (bridge ?? windowScopeBridge())?.openWindow !== undefined;
}

/** Fire and forget: a failed window open must not break the click that asked for it. */
export function openWindowForScope(
  scope: ProjectCollectionScope,
  bridge?: WindowScopeBridge,
): void {
  void (bridge ?? windowScopeBridge())
    ?.openWindow?.({ scope: encodeProjectCollectionScope(scope) })
    ?.catch(() => {});
}

/**
 * Records the window's new scope locally and tells the desktop shell, which
 * persists it so the window can be restored with the same scope.
 */
export function publishWindowScope(
  scope: ProjectCollectionScope,
  options: { readonly storage?: Storage | null; readonly bridge?: WindowScopeBridge } = {},
): void {
  writeWindowScope(scope, options.storage === undefined ? windowSessionStorage() : options.storage);
  const bridge = options.bridge ?? windowScopeBridge();
  void bridge?.setWindowScope?.(encodeProjectCollectionScope(scope))?.catch(() => {});
}
