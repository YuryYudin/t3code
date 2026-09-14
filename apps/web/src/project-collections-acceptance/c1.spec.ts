import {
  createProjectCollection,
  deleteProjectCollection,
  moveCollectionProject,
} from "@t3tools/client-runtime/state/project-collections";
import {
  EnvironmentId,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { expect, test } from "vite-plus/test";

const environmentId = EnvironmentId.make("phone");
const workId = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const personalId = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");
const workKey = ProjectCollectionProjectKey.make("repository:github.com/acme/work");
const personalKey = ProjectCollectionProjectKey.make("repository:github.com/acme/personal");

const project = (id: string, canonicalKey: string, updatedAt: string) => ({
  environmentId,
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: `/work/${id}`,
  repositoryIdentity: {
    canonicalKey,
    locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: canonicalKey },
    rootPath: `/work/${id}`,
    displayName: id,
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
});
const projects = [
  project("work-main", "github.com/acme/work", "2026-09-03T00:00:00.000Z"),
  project("work-feature", "github.com/acme/work", "2026-09-02T00:00:00.000Z"),
  project("personal", "github.com/acme/personal", "2026-09-01T00:00:00.000Z"),
];
const threads = projects.map((candidate, index) => ({
  environmentId,
  id: `thread-${index}`,
  projectId: candidate.id,
  title: candidate.title,
  archivedAt: null,
  createdAt: candidate.createdAt,
  updatedAt: candidate.updatedAt,
}));

test("S9: mobile creates, styles, filters, moves, and deletes whole project families", async () => {
  const moduleUrl = new URL(
    "../../../mobile/src/features/home/mobileProjectCollections.ts",
    import.meta.url,
  ).href;
  const { buildMobileProjectCollectionsModel } = (await import(moduleUrl)) as {
    readonly buildMobileProjectCollectionsModel: (input: unknown) => {
      readonly activeScopeLabel: string;
      readonly scopeOptions: ReadonlyArray<{
        readonly label: string;
        readonly collection?: { readonly visual: unknown };
      }>;
      readonly projects: ReadonlyArray<{
        readonly projectKey: string;
        readonly label: string;
        readonly workspaceCount: number;
      }>;
      readonly visibleThreads: ReadonlyArray<{ readonly title: string }>;
    };
  };
  const model = (document: ProjectCollectionsDocument, scope: object) =>
    buildMobileProjectCollectionsModel({
      projects,
      threads,
      pendingTasks: [],
      environmentId: null,
      projectGroupingMode: "repository",
      projectSortOrder: "updated_at",
      document,
      scope,
    });

  let document: ProjectCollectionsDocument = {
    schemaVersion: 1,
    collections: [
      { id: workId, name: "Work", visual: { kind: "lucide", name: "briefcase", color: "blue" } },
    ],
    assignments: [{ projectKey: workKey, collectionId: workId }],
  };
  const created = createProjectCollection(document, {
    id: personalId,
    name: "Personal",
    visual: { kind: "emoji", emoji: "🏠" },
  });
  if (!created.ok) throw new Error(created.error.message);
  document = created.value;

  const moved = moveCollectionProject(document, personalKey, personalId);
  if (!moved.ok) throw new Error(moved.error.message);
  document = moved.value;
  const personal = model(document, { kind: "collection", collectionId: personalId });
  expect(personal.activeScopeLabel).toBe("Personal");
  expect(
    personal.scopeOptions.find((option) => option.label === "Personal")?.collection?.visual,
  ).toEqual({
    kind: "emoji",
    emoji: "🏠",
  });
  expect(personal.visibleThreads.map((thread) => thread.title)).toEqual(["personal"]);
  expect(personal.projects).toEqual([
    { projectKey: workKey, label: "work-main", workspaceCount: 2 },
    { projectKey: personalKey, label: "personal", workspaceCount: 1 },
  ]);

  const deleted = deleteProjectCollection(document, personalId);
  if (!deleted.ok) throw new Error(deleted.error.message);
  const unfiled = model(deleted.value, { kind: "unfiled" });
  expect(unfiled.activeScopeLabel).toBe("Unfiled");
  expect(unfiled.visibleThreads.map((thread) => thread.title)).toEqual(["personal"]);
});
