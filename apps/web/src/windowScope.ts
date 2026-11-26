import {
  MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH,
  ProjectCollectionId as ProjectCollectionIdSchema,
} from "@t3tools/contracts";
import {
  ALL_PROJECTS_COLLECTION_SCOPE,
  type ProjectCollectionScope,
} from "@t3tools/client-runtime/state/project-collections";
import * as Schema from "effect/Schema";

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
