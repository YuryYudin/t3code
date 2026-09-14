import {
  MAX_PROJECT_COLLECTION_ASSIGNMENTS,
  MAX_PROJECT_COLLECTION_DOCUMENT_BYTES,
  MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH,
  MAX_PROJECT_COLLECTIONS,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts/settings";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  assignCollectionProject,
  createProjectCollection,
  deleteProjectCollection,
  deriveProjectCollectionCounts,
  deriveProjectCollectionProjectKey,
  deriveProjectCollectionScopeOptions,
  filterItemsByProjectCollectionScope,
  getProjectCollectionDeletionImpact,
  moveCollectionProject,
  renameProjectCollection,
  styleProjectCollection,
  sanitizeProjectCollectionScope,
  unfileCollectionProject,
  validateProjectCollectionsDocument,
} from "./projectCollections.ts";
import type { EnvironmentProject } from "./models.ts";
import { buildProjectGroups } from "./projectGrouping.ts";

const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PERSONAL_ID = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");

function emptyDocument(): ProjectCollectionsDocument {
  return { schemaVersion: 1, collections: [], assignments: [] };
}

function collection(id = WORK_ID, name = "Work") {
  return {
    id,
    name,
    visual: { kind: "lucide" as const, name: "briefcase" as const, color: "blue" as const },
  };
}

function projectKey(value: string) {
  return ProjectCollectionProjectKey.make(value);
}

function decodedDocument(candidate: unknown): ProjectCollectionsDocument {
  return candidate as ProjectCollectionsDocument;
}

describe("project collection mutations", () => {
  it("canonicalizes accepted decoded documents before selectors or mutations consume them", () => {
    const upperWorkId = WORK_ID.toUpperCase() as typeof WORK_ID;
    const noncanonical = {
      schemaVersion: 1,
      collections: [
        {
          id: upperWorkId,
          name: "  Work  ",
          visual: { kind: "emoji", emoji: "  💼  ", ignored: true },
          ignored: true,
        },
      ],
      assignments: [
        {
          projectKey: "  repository:acme/app  ",
          collectionId: upperWorkId,
          ignored: true,
        },
      ],
      ignored: true,
    } as unknown as ProjectCollectionsDocument;
    const canonical: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [
        {
          id: WORK_ID,
          name: "Work",
          visual: { kind: "emoji", emoji: "💼" },
        },
      ],
      assignments: [{ projectKey: projectKey("repository:acme/app"), collectionId: WORK_ID }],
    };

    expect(validateProjectCollectionsDocument(noncanonical)).toEqual({
      ok: true,
      value: canonical,
    });
    expect(renameProjectCollection(noncanonical, WORK_ID, "Company")).toEqual({
      ok: true,
      value: {
        ...canonical,
        collections: [{ ...canonical.collections[0]!, name: "Company" }],
      },
    });
  });

  it("creates a trimmed collection without mutating the source document", () => {
    const source = emptyDocument();
    const result = createProjectCollection(source, {
      id: WORK_ID,
      name: "  Work  ",
      visual: { kind: "lucide", name: "briefcase", color: "blue" },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        collections: [
          {
            id: WORK_ID,
            name: "Work",
            visual: { kind: "lucide", name: "briefcase", color: "blue" },
          },
        ],
        assignments: [],
      },
    });
    expect(source).toEqual(emptyDocument());
  });

  it("reports measurable document validation failures without throwing", () => {
    const base = { schemaVersion: 1 as const, collections: [collection()], assignments: [] };
    const error = (candidate: unknown) =>
      validateProjectCollectionsDocument(decodedDocument(candidate));

    expect(error({ ...base, collections: [collection(WORK_ID, "   ")] })).toEqual({
      ok: false,
      error: {
        code: "invalid-name",
        field: "collections[0].name",
        message: "Collection name must be between 1 and 80 Unicode code points.",
      },
    });
    expect(
      error({
        ...base,
        collections: [collection(WORK_ID, "Ｗｏｒｋ"), collection(PERSONAL_ID, " work ")],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "duplicate-name",
        field: "collections[1].name",
        message: "Collection names must be unique.",
      },
    });
    expect(error({ ...base, collections: [collection(WORK_ID, "  UnFiLeD ")] })).toEqual({
      ok: false,
      error: {
        code: "reserved-name",
        field: "collections[0].name",
        message: "All projects and Unfiled are reserved names.",
      },
    });
    expect(
      error({
        ...base,
        collections: [{ ...collection(), visual: { kind: "lucide", name: "cat", color: "blue" } }],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid-visual",
        field: "collections[0].visual",
        message: "Choose a supported collection icon and color or one emoji.",
      },
    });
    expect(
      error({
        ...base,
        assignments: [{ projectKey: "repository:acme/app", collectionId: PERSONAL_ID }],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "dangling-collection",
        field: "assignments[0].collectionId",
        message: "Collection assignment must reference an existing collection.",
      },
    });

    expect(
      error({
        ...base,
        collections: Array.from({ length: MAX_PROJECT_COLLECTIONS + 1 }, (_, index) =>
          collection(
            `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` as typeof WORK_ID,
            `Collection ${index}`,
          ),
        ),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "collection-limit",
        field: "collections",
        message: `Collection settings support at most ${MAX_PROJECT_COLLECTIONS} collections.`,
      },
    });
    expect(
      error({
        ...base,
        assignments: Array.from({ length: MAX_PROJECT_COLLECTION_ASSIGNMENTS + 1 }, (_, index) => ({
          projectKey: `repository:${index}`,
          collectionId: WORK_ID,
        })),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "assignment-limit",
        field: "assignments",
        message: `Collection settings support at most ${MAX_PROJECT_COLLECTION_ASSIGNMENTS} assignments.`,
      },
    });
    expect(
      error({
        ...base,
        assignments: [
          {
            projectKey: "x".repeat(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH + 1),
            collectionId: WORK_ID,
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "project-key-limit",
        field: "assignments[0].projectKey",
        message: `Collection project keys must be between 1 and ${MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH} characters.`,
      },
    });
    expect(
      error({
        ...base,
        ignored: "😀".repeat(MAX_PROJECT_COLLECTION_DOCUMENT_BYTES),
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "document-byte-limit",
        field: "document",
        message: `Collection settings must not exceed ${MAX_PROJECT_COLLECTION_DOCUMENT_BYTES} UTF-8 bytes.`,
      },
    });
  });

  it("accepts exact collection and assignment maxima and rejects the next entry", () => {
    const collections = Array.from({ length: MAX_PROJECT_COLLECTIONS }, (_, index) =>
      collection(
        `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` as typeof WORK_ID,
        `Collection ${index}`,
      ),
    );
    const atCollectionLimit = decodedDocument({
      schemaVersion: 1,
      collections,
      assignments: [],
    });
    expect(validateProjectCollectionsDocument(atCollectionLimit)).toEqual({
      ok: true,
      value: atCollectionLimit,
    });
    expect(
      validateProjectCollectionsDocument(
        decodedDocument({
          ...atCollectionLimit,
          collections: [
            ...collections,
            collection("00000000-0000-4000-8000-000000000080" as typeof WORK_ID, "Overflow"),
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "collection-limit",
        field: "collections",
        message: `Collection settings support at most ${MAX_PROJECT_COLLECTIONS} collections.`,
      },
    });

    const assignments = Array.from({ length: MAX_PROJECT_COLLECTION_ASSIGNMENTS }, (_, index) => ({
      projectKey: projectKey(`repository:${index}`),
      collectionId: WORK_ID,
    }));
    const atAssignmentLimit: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [collection()],
      assignments,
    };
    expect(validateProjectCollectionsDocument(atAssignmentLimit)).toEqual({
      ok: true,
      value: atAssignmentLimit,
    });
    expect(
      validateProjectCollectionsDocument(
        decodedDocument({
          ...atAssignmentLimit,
          assignments: [
            ...assignments,
            { projectKey: "repository:overflow", collectionId: WORK_ID },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "assignment-limit",
        field: "assignments",
        message: `Collection settings support at most ${MAX_PROJECT_COLLECTION_ASSIGNMENTS} assignments.`,
      },
    });
  });

  it("measures the exact raw UTF-8 byte boundary before canonicalization", () => {
    const base = { schemaVersion: 1, collections: [], assignments: [], ignored: "" };
    const baseBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength;
    const paddingBytes = MAX_PROJECT_COLLECTION_DOCUMENT_BYTES - baseBytes;
    const padding = `${"😀".repeat(Math.floor(paddingBytes / 4))}${"x".repeat(paddingBytes % 4)}`;
    const atLimit = { ...base, ignored: padding };
    const overLimit = { ...atLimit, ignored: `${padding}x` };

    expect(new TextEncoder().encode(JSON.stringify(atLimit))).toHaveLength(
      MAX_PROJECT_COLLECTION_DOCUMENT_BYTES,
    );
    expect(padding.length).toBeLessThan(paddingBytes);
    expect(validateProjectCollectionsDocument(decodedDocument(atLimit))).toEqual({
      ok: true,
      value: emptyDocument(),
    });
    expect(new TextEncoder().encode(JSON.stringify(overLimit))).toHaveLength(
      MAX_PROJECT_COLLECTION_DOCUMENT_BYTES + 1,
    );
    expect(validateProjectCollectionsDocument(decodedDocument(overLimit))).toEqual({
      ok: false,
      error: {
        code: "document-byte-limit",
        field: "document",
        message: `Collection settings must not exceed ${MAX_PROJECT_COLLECTION_DOCUMENT_BYTES} UTF-8 bytes.`,
      },
    });
  });

  it("rejects invalid or ambiguous identities at the domain boundary", () => {
    const base = { schemaVersion: 1 as const, collections: [collection()], assignments: [] };

    expect(
      validateProjectCollectionsDocument(
        decodedDocument({
          ...base,
          collections: [{ ...collection(), id: "not-a-uuid" }],
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "dangling-collection",
        field: "collections[0].id",
        message: "Collection identity is missing or invalid.",
      },
    });
    expect(
      validateProjectCollectionsDocument({
        ...base,
        collections: [collection(), collection(WORK_ID.toUpperCase() as typeof WORK_ID, "Other")],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "dangling-collection",
        field: "collections[1].id",
        message: "Collection identities must be unique.",
      },
    });
    expect(
      validateProjectCollectionsDocument(
        decodedDocument({
          ...base,
          assignments: [
            { projectKey: "repository:app", collectionId: WORK_ID },
            { projectKey: " repository:app ", collectionId: WORK_ID },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "assignment-limit",
        field: "assignments[1].projectKey",
        message: "Each collection project may have only one assignment.",
      },
    });
  });

  it("immutably renames, styles, moves, unfiles, and safely deletes collections", () => {
    const source: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [collection(), collection(PERSONAL_ID, "Personal")],
      assignments: [{ projectKey: projectKey("repository:acme/app"), collectionId: WORK_ID }],
    };
    const snapshot = structuredClone(source);

    expect(renameProjectCollection(source, WORK_ID, "  Company  ")).toEqual({
      ok: true,
      value: {
        ...source,
        collections: [{ ...collection(), name: "Company" }, collection(PERSONAL_ID, "Personal")],
      },
    });
    expect(styleProjectCollection(source, WORK_ID, { kind: "emoji", emoji: "🏢" })).toEqual({
      ok: true,
      value: {
        ...source,
        collections: [
          { ...collection(), visual: { kind: "emoji", emoji: "🏢" } },
          collection(PERSONAL_ID, "Personal"),
        ],
      },
    });

    expect(assignCollectionProject(source, " repository:acme/new ", WORK_ID)).toEqual({
      ok: true,
      value: {
        ...source,
        assignments: [
          { projectKey: "repository:acme/app", collectionId: WORK_ID },
          { projectKey: "repository:acme/new", collectionId: WORK_ID },
        ],
      },
    });
    expect(moveCollectionProject(source, "repository:acme/app", PERSONAL_ID)).toEqual({
      ok: true,
      value: {
        ...source,
        assignments: [{ projectKey: "repository:acme/app", collectionId: PERSONAL_ID }],
      },
    });
    expect(moveCollectionProject(source, "repository:acme/app", WORK_ID)).toEqual({
      ok: true,
      value: source,
    });
    expect(unfileCollectionProject(source, "repository:missing")).toEqual({
      ok: true,
      value: source,
    });
    expect(unfileCollectionProject(source, "repository:acme/app")).toEqual({
      ok: true,
      value: { ...source, assignments: [] },
    });

    expect(getProjectCollectionDeletionImpact(source, WORK_ID)).toEqual({
      collectionId: WORK_ID,
      assignedProjectKeys: ["repository:acme/app"],
      projectCount: 1,
    });
    expect(deleteProjectCollection(source, WORK_ID)).toEqual({
      ok: true,
      value: {
        schemaVersion: 1,
        collections: [collection(PERSONAL_ID, "Personal")],
        assignments: [],
      },
    });
    expect(source).toEqual(snapshot);
  });

  it("returns exact mutation errors and never exposes a partial candidate", () => {
    const source: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [collection(), collection(PERSONAL_ID, "Personal")],
      assignments: [],
    };
    const snapshot = structuredClone(source);

    expect(createProjectCollection(source, collection(PERSONAL_ID, "  WORK "))).toEqual({
      ok: false,
      error: {
        code: "duplicate-name",
        field: "collections[2].name",
        message: "Collection names must be unique.",
      },
    });
    expect(renameProjectCollection(source, WORK_ID, "All projects")).toEqual({
      ok: false,
      error: {
        code: "reserved-name",
        field: "collections[0].name",
        message: "All projects and Unfiled are reserved names.",
      },
    });
    expect(
      styleProjectCollection(source, WORK_ID, {
        kind: "emoji",
        emoji: "not emoji",
      } as never),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid-visual",
        field: "collections[0].visual",
        message: "Choose a supported collection icon and color or one emoji.",
      },
    });
    expect(assignCollectionProject(source, "repository:acme/app", "missing" as never)).toEqual({
      ok: false,
      error: {
        code: "dangling-collection",
        field: "collectionId",
        message: "Collection missing does not exist.",
      },
    });

    const overlongKey = `repository:${"x".repeat(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH)}`;
    expect(() => assignCollectionProject(source, overlongKey, WORK_ID)).not.toThrow();
    expect(assignCollectionProject(source, overlongKey, WORK_ID)).toEqual({
      ok: false,
      error: {
        code: "project-key-limit",
        field: "projectKey",
        message: `Collection project keys must be between 1 and ${MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH} characters.`,
      },
    });
    expect(unfileCollectionProject(source, overlongKey)).toEqual({
      ok: false,
      error: {
        code: "project-key-limit",
        field: "projectKey",
        message: `Collection project keys must be between 1 and ${MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH} characters.`,
      },
    });
    expect(source).toEqual(snapshot);
  });

  it("accepts 512-character A4 identity candidates and rejects 513 without throwing", () => {
    const deriveCandidate = (canonicalKey: string) => {
      const project: EnvironmentProject = {
        environmentId: EnvironmentId.make("mac"),
        id: ProjectId.make("app"),
        title: "App",
        workspaceRoot: "/work/app",
        repositoryIdentity: {
          canonicalKey,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: "https://example.com/acme/app.git",
          },
          rootPath: "/work/app",
          provider: "example",
          owner: "acme",
          name: "app",
          displayName: "App",
        },
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };
      const [group] = buildProjectGroups({
        projects: [project],
        settings: {
          sidebarProjectGroupingMode: "repository",
          sidebarProjectGroupingOverrides: {},
        },
      });
      return deriveProjectCollectionProjectKey({ group: group!, projects: [project] });
    };
    const repositoryPrefix = "repository:";
    const atLimit = deriveCandidate(
      "x".repeat(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH - repositoryPrefix.length),
    );
    const overLimit = deriveCandidate(
      "x".repeat(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH - repositoryPrefix.length + 1),
    );
    const source: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [collection()],
      assignments: [],
    };

    expect(atLimit).toHaveLength(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH);
    expect(assignCollectionProject(source, atLimit, WORK_ID)).toEqual({
      ok: true,
      value: {
        ...source,
        assignments: [{ projectKey: atLimit, collectionId: WORK_ID }],
      },
    });
    expect(overLimit).toHaveLength(MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH + 1);
    expect(() => assignCollectionProject(source, overLimit, WORK_ID)).not.toThrow();
    expect(assignCollectionProject(source, overLimit, WORK_ID)).toEqual({
      ok: false,
      error: {
        code: "project-key-limit",
        field: "projectKey",
        message: `Collection project keys must be between 1 and ${MAX_PROJECT_COLLECTION_PROJECT_KEY_LENGTH} characters.`,
      },
    });
  });

  it("retains stale assignments and enforces capacity only when adding a project", () => {
    const assignments = Array.from({ length: MAX_PROJECT_COLLECTION_ASSIGNMENTS }, (_, index) => ({
      projectKey: projectKey(`repository:offline/${index}`),
      collectionId: WORK_ID,
    }));
    const source: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [collection(), collection(PERSONAL_ID, "Personal")],
      assignments,
    };

    const moved = moveCollectionProject(source, assignments[100]!.projectKey, PERSONAL_ID);
    expect(moved.ok && moved.value.assignments).toHaveLength(MAX_PROJECT_COLLECTION_ASSIGNMENTS);
    expect(
      moved.ok &&
        moved.value.assignments.find((assignment) => assignment.projectKey.endsWith("/100")),
    ).toEqual({ projectKey: "repository:offline/100", collectionId: PERSONAL_ID });
    expect(assignCollectionProject(source, "repository:new", PERSONAL_ID)).toEqual({
      ok: false,
      error: {
        code: "assignment-limit",
        field: "assignments",
        message: `Collection settings support at most ${MAX_PROJECT_COLLECTION_ASSIGNMENTS} assignments.`,
      },
    });
    expect(source.assignments).toEqual(assignments);
  });

  it("counts and filters flat project families for every scope without reordering rows", () => {
    const source: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [collection(), collection(PERSONAL_ID, "Personal")],
      assignments: [
        { projectKey: projectKey("repository:acme/app"), collectionId: WORK_ID },
        { projectKey: projectKey("repository:offline/stale"), collectionId: WORK_ID },
        { projectKey: projectKey("repository:acme/home"), collectionId: PERSONAL_ID },
      ],
    };
    const rows = [
      { id: "app-first", projectKey: "repository:acme/app" },
      { id: "scratch", projectKey: 'physical:["mac","/scratch"]' },
      { id: "app-second", projectKey: "repository:acme/app" },
      { id: "home", projectKey: "repository:acme/home" },
    ];
    const filter = (scope: Parameters<typeof filterItemsByProjectCollectionScope>[0]["scope"]) =>
      filterItemsByProjectCollectionScope({
        document: source,
        items: rows,
        scope,
        projectKey: (row) => row.projectKey,
      }).map((row) => row.id);

    expect(filter({ kind: "all" })).toEqual(rows.map((row) => row.id));
    expect(filter({ kind: "collection", collectionId: WORK_ID })).toEqual([
      "app-first",
      "app-second",
    ]);
    expect(filter({ kind: "unfiled" })).toEqual(["scratch"]);
    expect(filter({ kind: "project", projectKey: "repository:acme/app" })).toEqual([
      "app-first",
      "app-second",
    ]);
    expect(
      deriveProjectCollectionCounts(source, [
        "repository:acme/app",
        'physical:["mac","/scratch"]',
        "repository:acme/app",
        "repository:acme/home",
      ]),
    ).toEqual({
      allProjects: 3,
      unfiled: 1,
      byCollectionId: { [WORK_ID]: 1, [PERSONAL_ID]: 1 },
    });
    expect(
      sanitizeProjectCollectionScope(source, {
        kind: "collection",
        collectionId: "missing" as never,
      }),
    ).toEqual({ kind: "all" });
    expect(
      sanitizeProjectCollectionScope(source, { kind: "project", projectKey: "repository:gone" }, [
        "repository:acme/app",
      ]),
    ).toEqual({ kind: "all" });
  });

  it("derives populated collection order from the highest-ranked project and pins virtual scopes", () => {
    const ALPHA_ID = ProjectCollectionId.make("00000000-0000-4000-8000-000000000002");
    const ZETA_ID = ProjectCollectionId.make("00000000-0000-4000-8000-000000000001");
    const source: ProjectCollectionsDocument = {
      schemaVersion: 1,
      collections: [
        collection(WORK_ID, "Work"),
        collection(PERSONAL_ID, "Personal"),
        collection(ZETA_ID, "Zeta"),
        collection(ALPHA_ID, "Alpha"),
      ],
      assignments: [
        { projectKey: projectKey("repository:work"), collectionId: WORK_ID },
        { projectKey: projectKey("repository:personal"), collectionId: PERSONAL_ID },
      ],
    };

    const options = deriveProjectCollectionScopeOptions(source, [
      "repository:personal",
      "repository:unfiled",
      "repository:work",
    ]);
    expect(options.map((option) => [option.label, option.count])).toEqual([
      ["All projects", 3],
      ["Personal", 1],
      ["Work", 1],
      ["Alpha", 0],
      ["Zeta", 0],
      ["Unfiled", 1],
    ]);
    expect(options.map((option) => option.scope.kind)).toEqual([
      "all",
      "collection",
      "collection",
      "collection",
      "collection",
      "unfiled",
    ]);

    const duplicateEmptyNames = {
      ...source,
      collections: [collection(ALPHA_ID, "Same"), collection(ZETA_ID, "Same")],
      assignments: [],
    } as ProjectCollectionsDocument;
    expect(
      deriveProjectCollectionScopeOptions(duplicateEmptyNames, []).map((option) => option.scope),
    ).toEqual([
      { kind: "all" },
      { kind: "collection", collectionId: ZETA_ID },
      { kind: "collection", collectionId: ALPHA_ID },
      { kind: "unfiled" },
    ]);
  });
});
