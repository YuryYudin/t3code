import {
  MAX_PROJECT_COLLECTION_ASSIGNMENTS,
  MAX_PROJECT_COLLECTION_DOCUMENT_BYTES,
  MAX_PROJECT_COLLECTION_NAME_CODE_POINTS,
  MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH,
  MAX_PROJECT_COLLECTIONS,
  normalizeProjectCollectionName,
  ProjectCollectionId as ProjectCollectionIdSchema,
  ProjectCollectionVisual as ProjectCollectionVisualSchema,
  type ProjectCollection,
  type ProjectCollectionAssignment,
  type ProjectCollectionId,
  type ProjectCollectionProjectKey,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts/settings";
import * as Schema from "effect/Schema";

import type { ProjectCollectionProjectKeyCandidate } from "./projectCollectionIdentity.ts";

export {
  deriveProjectCollectionProjectKey,
  type ProjectCollectionIdentityInput,
  type ProjectCollectionProjectKeyCandidate,
} from "./projectCollectionIdentity.ts";

export type ProjectCollectionMutationErrorCode =
  | "invalid-name"
  | "duplicate-name"
  | "reserved-name"
  | "invalid-visual"
  | "dangling-collection"
  | "collection-limit"
  | "assignment-limit"
  | "project-key-limit"
  | "document-byte-limit";

export interface ProjectCollectionMutationError {
  readonly code: ProjectCollectionMutationErrorCode;
  readonly field: string;
  readonly message: string;
}

export type ProjectCollectionMutationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProjectCollectionMutationError };

function failure<T>(
  code: ProjectCollectionMutationErrorCode,
  field: string,
  message: string,
): ProjectCollectionMutationResult<T> {
  return { ok: false, error: { code, field, message } };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const isProjectCollectionVisual = Schema.is(ProjectCollectionVisualSchema);
const isProjectCollectionId = Schema.is(ProjectCollectionIdSchema);

function validateProjectCollectionsCandidate(
  candidate: unknown,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  let json: string | undefined;
  try {
    json = JSON.stringify(candidate);
  } catch {
    return failure(
      "document-byte-limit",
      "document",
      "Collection settings must be JSON serializable.",
    );
  }
  if (json === undefined || utf8ByteLength(json) > MAX_PROJECT_COLLECTION_DOCUMENT_BYTES) {
    return failure(
      "document-byte-limit",
      "document",
      `Collection settings must not exceed ${MAX_PROJECT_COLLECTION_DOCUMENT_BYTES} UTF-8 bytes.`,
    );
  }

  const document = asRecord(candidate);
  const collections = document?.collections;
  const assignments = document?.assignments;
  if (!Array.isArray(collections)) {
    return failure("collection-limit", "collections", "Collections must be a list.");
  }
  if (collections.length > MAX_PROJECT_COLLECTIONS) {
    return failure(
      "collection-limit",
      "collections",
      `Collection settings support at most ${MAX_PROJECT_COLLECTIONS} collections.`,
    );
  }
  if (!Array.isArray(assignments)) {
    return failure("assignment-limit", "assignments", "Assignments must be a list.");
  }
  if (assignments.length > MAX_PROJECT_COLLECTION_ASSIGNMENTS) {
    return failure(
      "assignment-limit",
      "assignments",
      `Collection settings support at most ${MAX_PROJECT_COLLECTION_ASSIGNMENTS} assignments.`,
    );
  }

  const collectionIds = new Set<string>();
  const names = new Set<string>();
  const canonicalCollections: ProjectCollection[] = [];
  for (let index = 0; index < collections.length; index += 1) {
    const collection = asRecord(collections[index]);
    const name = collection?.name;
    const nameField = `collections[${index}].name`;
    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      [...name.trim()].length > MAX_PROJECT_COLLECTION_NAME_CODE_POINTS
    ) {
      return failure(
        "invalid-name",
        nameField,
        `Collection name must be between 1 and ${MAX_PROJECT_COLLECTION_NAME_CODE_POINTS} Unicode code points.`,
      );
    }
    const normalizedName = normalizeProjectCollectionName(name);
    if (normalizedName === "all projects" || normalizedName === "unfiled") {
      return failure("reserved-name", nameField, "All projects and Unfiled are reserved names.");
    }
    if (names.has(normalizedName)) {
      return failure("duplicate-name", nameField, "Collection names must be unique.");
    }
    names.add(normalizedName);

    const visual = asRecord(collection?.visual);
    const canonicalVisual =
      visual?.kind === "emoji" && typeof visual.emoji === "string"
        ? { kind: "emoji" as const, emoji: visual.emoji.trim() }
        : visual?.kind === "lucide"
          ? { kind: "lucide" as const, name: visual.name, color: visual.color }
          : collection?.visual;
    if (!isProjectCollectionVisual(canonicalVisual)) {
      return failure(
        "invalid-visual",
        `collections[${index}].visual`,
        "Choose a supported collection icon and color or one emoji.",
      );
    }

    const id = collection?.id;
    if (!isProjectCollectionId(id)) {
      return failure(
        "dangling-collection",
        `collections[${index}].id`,
        "Collection identity is missing or invalid.",
      );
    }
    const canonicalId = id.toLowerCase();
    if (collectionIds.has(canonicalId)) {
      return failure(
        "dangling-collection",
        `collections[${index}].id`,
        "Collection identities must be unique.",
      );
    }
    collectionIds.add(canonicalId);
    canonicalCollections.push({
      id: canonicalId as ProjectCollectionId,
      name: name.trim(),
      visual: canonicalVisual,
    });
  }

  const projectKeys = new Set<string>();
  const canonicalAssignments: ProjectCollectionAssignment[] = [];
  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = asRecord(assignments[index]);
    const projectKey = assignment?.projectKey;
    const projectKeyField = `assignments[${index}].projectKey`;
    if (
      typeof projectKey !== "string" ||
      projectKey.trim().length === 0 ||
      projectKey.trim().length > MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH
    ) {
      return failure(
        "project-key-limit",
        projectKeyField,
        `Collection project keys must be between 1 and ${MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH} characters.`,
      );
    }
    const canonicalProjectKey = projectKey.trim();
    if (projectKeys.has(canonicalProjectKey)) {
      return failure(
        "assignment-limit",
        projectKeyField,
        "Each collection project may have only one assignment.",
      );
    }
    projectKeys.add(canonicalProjectKey);

    const collectionId = assignment?.collectionId;
    if (typeof collectionId !== "string" || !collectionIds.has(collectionId.toLowerCase())) {
      return failure(
        "dangling-collection",
        `assignments[${index}].collectionId`,
        "Collection assignment must reference an existing collection.",
      );
    }
    canonicalAssignments.push({
      projectKey: canonicalProjectKey as ProjectCollectionProjectKey,
      collectionId: collectionId.toLowerCase() as ProjectCollectionId,
    });
  }

  const value: ProjectCollectionsDocument = {
    schemaVersion: 1,
    collections: canonicalCollections,
    assignments: canonicalAssignments,
  };
  return { ok: true, value: json === JSON.stringify(value) ? (candidate as typeof value) : value };
}

/**
 * Validates domain constraints on an A3-decoded document. Wire shape and
 * schema-version validation remain owned by the contracts/server decoder.
 */
export function validateProjectCollectionsDocument(
  document: ProjectCollectionsDocument,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  return validateProjectCollectionsCandidate(document);
}

export function createProjectCollection(
  document: ProjectCollectionsDocument,
  collection: ProjectCollection,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  const sourceResult = validateProjectCollectionsDocument(document);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  const name = typeof collection?.name === "string" ? collection.name.trim() : collection?.name;
  return validateProjectCollectionsCandidate({
    ...source,
    collections: [...source.collections, { ...collection, name }],
  });
}

function findCollectionIndex(document: ProjectCollectionsDocument, collectionId: string): number {
  const canonicalId = collectionId.toLowerCase();
  return document.collections.findIndex(
    (collection) => collection.id.toLowerCase() === canonicalId,
  );
}

function missingCollection<T>(collectionId: string): ProjectCollectionMutationResult<T> {
  return failure(
    "dangling-collection",
    "collectionId",
    `Collection ${collectionId} does not exist.`,
  );
}

function validateProjectKeyCandidate(
  projectKeyCandidate: ProjectCollectionProjectKeyCandidate,
): ProjectCollectionMutationResult<ProjectCollectionProjectKey> {
  const projectKey = projectKeyCandidate.trim();
  if (projectKey.length === 0 || projectKey.length > MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH) {
    return failure(
      "project-key-limit",
      "projectKey",
      `Collection project keys must be between 1 and ${MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH} characters.`,
    );
  }
  return { ok: true, value: projectKey as ProjectCollectionProjectKey };
}

export function renameProjectCollection(
  document: ProjectCollectionsDocument,
  collectionId: ProjectCollectionId,
  name: string,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  const sourceResult = validateProjectCollectionsDocument(document);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  const index = findCollectionIndex(source, collectionId);
  if (index < 0) return missingCollection(collectionId);
  const collections = [...source.collections];
  collections[index] = {
    ...collections[index]!,
    name: typeof name === "string" ? name.trim() : name,
  } as ProjectCollection;
  return validateProjectCollectionsCandidate({ ...source, collections });
}

export function styleProjectCollection(
  document: ProjectCollectionsDocument,
  collectionId: ProjectCollectionId,
  visual: ProjectCollection["visual"],
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  const sourceResult = validateProjectCollectionsDocument(document);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  const index = findCollectionIndex(source, collectionId);
  if (index < 0) return missingCollection(collectionId);
  const collections = [...source.collections];
  collections[index] = { ...collections[index]!, visual };
  return validateProjectCollectionsCandidate({ ...source, collections });
}

export interface ProjectCollectionDeletionImpact {
  readonly collectionId: ProjectCollectionId;
  readonly assignedProjectKeys: ReadonlyArray<ProjectCollectionProjectKey>;
  readonly projectCount: number;
}

export function getProjectCollectionDeletionImpact(
  document: ProjectCollectionsDocument,
  collectionId: ProjectCollectionId,
): ProjectCollectionDeletionImpact {
  const canonicalId = collectionId.toLowerCase();
  const assignedProjectKeys = document.assignments
    .filter((assignment) => assignment.collectionId.toLowerCase() === canonicalId)
    .map((assignment) => assignment.projectKey);
  return { collectionId, assignedProjectKeys, projectCount: assignedProjectKeys.length };
}

export function deleteProjectCollection(
  document: ProjectCollectionsDocument,
  collectionId: ProjectCollectionId,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  const sourceResult = validateProjectCollectionsDocument(document);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  if (findCollectionIndex(source, collectionId) < 0) return missingCollection(collectionId);
  const canonicalId = collectionId.toLowerCase();
  return validateProjectCollectionsCandidate({
    ...source,
    collections: source.collections.filter(
      (collection) => collection.id.toLowerCase() !== canonicalId,
    ),
    assignments: source.assignments.filter(
      (assignment) => assignment.collectionId.toLowerCase() !== canonicalId,
    ),
  });
}

export function assignCollectionProject(
  document: ProjectCollectionsDocument,
  projectKeyCandidate: ProjectCollectionProjectKeyCandidate,
  collectionId: ProjectCollectionId,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  const sourceResult = validateProjectCollectionsDocument(document);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  const projectKeyResult = validateProjectKeyCandidate(projectKeyCandidate);
  if (!projectKeyResult.ok) return projectKeyResult;
  if (findCollectionIndex(source, collectionId) < 0) return missingCollection(collectionId);
  const projectKey = projectKeyResult.value;
  const assignmentIndex = source.assignments.findIndex(
    (assignment) => assignment.projectKey === projectKey,
  );
  if (
    assignmentIndex >= 0 &&
    source.assignments[assignmentIndex]!.collectionId.toLowerCase() === collectionId.toLowerCase()
  ) {
    return { ok: true, value: source };
  }
  const nextAssignment = { projectKey, collectionId } as ProjectCollectionAssignment;
  const assignments = [...source.assignments];
  if (assignmentIndex >= 0) assignments[assignmentIndex] = nextAssignment;
  else assignments.push(nextAssignment);
  return validateProjectCollectionsCandidate({ ...source, assignments });
}

export function moveCollectionProject(
  document: ProjectCollectionsDocument,
  projectKey: ProjectCollectionProjectKeyCandidate,
  collectionId: ProjectCollectionId,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  return assignCollectionProject(document, projectKey, collectionId);
}

export function unfileCollectionProject(
  document: ProjectCollectionsDocument,
  projectKeyCandidate: ProjectCollectionProjectKeyCandidate,
): ProjectCollectionMutationResult<ProjectCollectionsDocument> {
  const sourceResult = validateProjectCollectionsDocument(document);
  if (!sourceResult.ok) return sourceResult;
  const source = sourceResult.value;
  const projectKeyResult = validateProjectKeyCandidate(projectKeyCandidate);
  if (!projectKeyResult.ok) return projectKeyResult;
  const projectKey = projectKeyResult.value;
  if (!source.assignments.some((assignment) => assignment.projectKey === projectKey)) {
    return { ok: true, value: source };
  }
  return validateProjectCollectionsCandidate({
    ...source,
    assignments: source.assignments.filter((assignment) => assignment.projectKey !== projectKey),
  });
}

export type ProjectCollectionScope =
  | { readonly kind: "all" }
  | { readonly kind: "collection"; readonly collectionId: ProjectCollectionId }
  | { readonly kind: "unfiled" }
  | { readonly kind: "project"; readonly projectKey: ProjectCollectionProjectKeyCandidate };

export const ALL_PROJECTS_COLLECTION_SCOPE = { kind: "all" } as const;
export const UNFILED_PROJECT_COLLECTION_SCOPE = { kind: "unfiled" } as const;

export function sanitizeProjectCollectionScope(
  document: ProjectCollectionsDocument,
  scope: ProjectCollectionScope,
  availableProjectKeys?: ReadonlyArray<ProjectCollectionProjectKeyCandidate>,
): ProjectCollectionScope {
  if (scope.kind === "collection") {
    return findCollectionIndex(document, scope.collectionId) >= 0
      ? scope
      : ALL_PROJECTS_COLLECTION_SCOPE;
  }
  if (scope.kind === "project") {
    if (scope.projectKey.trim().length === 0) return ALL_PROJECTS_COLLECTION_SCOPE;
    if (availableProjectKeys !== undefined && !availableProjectKeys.includes(scope.projectKey)) {
      return ALL_PROJECTS_COLLECTION_SCOPE;
    }
  }
  return scope;
}

function assignmentByProjectKey(
  document: ProjectCollectionsDocument,
): ReadonlyMap<string, ProjectCollectionId> {
  return new Map(
    document.assignments.map((assignment) => [assignment.projectKey, assignment.collectionId]),
  );
}

export function filterItemsByProjectCollectionScope<T>(input: {
  readonly document: ProjectCollectionsDocument;
  readonly items: ReadonlyArray<T>;
  readonly scope: ProjectCollectionScope;
  readonly projectKey: (item: T) => ProjectCollectionProjectKeyCandidate;
}): ReadonlyArray<T> {
  const scope = input.scope;
  if (scope.kind === "all") return input.items;
  const assignments = assignmentByProjectKey(input.document);
  return input.items.filter((item) => {
    const projectKey = input.projectKey(item);
    if (scope.kind === "project") return projectKey === scope.projectKey;
    const collectionId = assignments.get(projectKey);
    if (scope.kind === "unfiled") return collectionId === undefined;
    return collectionId?.toLowerCase() === scope.collectionId.toLowerCase();
  });
}

export interface ProjectCollectionCounts {
  readonly allProjects: number;
  readonly unfiled: number;
  readonly byCollectionId: Readonly<Record<string, number>>;
}

export function deriveProjectCollectionCounts(
  document: ProjectCollectionsDocument,
  availableProjectKeys: ReadonlyArray<ProjectCollectionProjectKeyCandidate>,
): ProjectCollectionCounts {
  const projectKeys = [...new Set(availableProjectKeys)];
  const assignments = assignmentByProjectKey(document);
  const byCollectionId: Record<string, number> = Object.fromEntries(
    document.collections.map((collection) => [collection.id, 0]),
  );
  let unfiled = 0;
  for (const projectKey of projectKeys) {
    const collectionId = assignments.get(projectKey);
    if (collectionId === undefined) {
      unfiled += 1;
    } else if (byCollectionId[collectionId] !== undefined) {
      byCollectionId[collectionId] += 1;
    }
  }
  return { allProjects: projectKeys.length, unfiled, byCollectionId };
}

export interface ProjectCollectionScopeOption {
  readonly scope: Exclude<ProjectCollectionScope, { readonly kind: "project" }>;
  readonly label: string;
  readonly count: number;
  readonly collection: ProjectCollection | null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function deriveProjectCollectionScopeOptions(
  document: ProjectCollectionsDocument,
  orderedProjectKeys: ReadonlyArray<ProjectCollectionProjectKeyCandidate>,
): ReadonlyArray<ProjectCollectionScopeOption> {
  const projectKeys = [...new Set(orderedProjectKeys)];
  const projectRanks = new Map(projectKeys.map((projectKey, rank) => [projectKey, rank]));
  const assignments = assignmentByProjectKey(document);
  const counts = deriveProjectCollectionCounts(document, projectKeys);
  const highestRankByCollectionId = new Map<string, number>();
  for (const [projectKey, collectionId] of assignments) {
    const rank = projectRanks.get(projectKey);
    if (rank === undefined) continue;
    const existing = highestRankByCollectionId.get(collectionId);
    if (existing === undefined || rank < existing) {
      highestRankByCollectionId.set(collectionId, rank);
    }
  }

  const collections = [...document.collections].sort((left, right) => {
    const leftRank = highestRankByCollectionId.get(left.id);
    const rightRank = highestRankByCollectionId.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1;
      if (rightRank === undefined) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
    const nameOrder = compareStrings(
      normalizeProjectCollectionName(left.name),
      normalizeProjectCollectionName(right.name),
    );
    return nameOrder || compareStrings(left.id, right.id);
  });

  return [
    {
      scope: ALL_PROJECTS_COLLECTION_SCOPE,
      label: "All projects",
      count: counts.allProjects,
      collection: null,
    },
    ...collections.map((collection) => ({
      scope: { kind: "collection" as const, collectionId: collection.id },
      label: collection.name,
      count: counts.byCollectionId[collection.id] ?? 0,
      collection,
    })),
    {
      scope: UNFILED_PROJECT_COLLECTION_SCOPE,
      label: "Unfiled",
      count: counts.unfiled,
      collection: null,
    },
  ];
}
