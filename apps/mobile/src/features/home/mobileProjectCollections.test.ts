import {
  EnvironmentId,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProjectCollectionsDocument,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildMobileProjectCollectionsModel } from "./mobileProjectCollections";

const ENVIRONMENT_ID = EnvironmentId.make("mac");
const COLLECTION_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PROJECT_KEY = ProjectCollectionProjectKey.make("repository:github.com/acme/platform");

const identified = {
  environmentId: ENVIRONMENT_ID,
  id: ProjectId.make("identified"),
  title: "Platform",
  workspaceRoot: "/work/platform",
  repositoryIdentity: {
    canonicalKey: "github.com/acme/platform",
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/platform.git",
    },
    rootPath: "/work/platform",
    provider: "github",
    owner: "acme",
    name: "platform",
    displayName: "Platform",
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const freshUnidentified = {
  ...identified,
  id: ProjectId.make("fresh-unidentified"),
  title: "Fresh Platform",
  workspaceRoot: "/work/platform/",
  repositoryIdentity: null,
  updatedAt: "2026-09-02T00:00:00.000Z",
};
const projects = [identified, freshUnidentified];
const threads = projects.map((project, index) => ({
  environmentId: project.environmentId,
  id: ThreadId.make(`thread-${index}`),
  projectId: project.id,
  title: project.title,
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  latestTurn: null,
  archivedAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  settledOverride: null,
  settledAt: null,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
}));
const document: ProjectCollectionsDocument = {
  schemaVersion: 1,
  collections: [
    {
      id: COLLECTION_ID,
      name: "Work",
      visual: { kind: "lucide", name: "briefcase", color: "blue" },
    },
  ],
  assignments: [{ projectKey: PROJECT_KEY, collectionId: COLLECTION_ID }],
};

describe("buildMobileProjectCollectionsModel", () => {
  it.each(["repository", "repository_path", "separate"] satisfies SidebarProjectGroupingMode[])(
    "retains recovered repository collection identity in %s grouping",
    (projectGroupingMode) => {
      const model = buildMobileProjectCollectionsModel({
        projects,
        threads,
        pendingTasks: [],
        environmentId: ENVIRONMENT_ID,
        projectGroupingMode,
        projectSortOrder: "updated_at",
        document,
        scope: { kind: "collection", collectionId: COLLECTION_ID },
      });

      expect(model.activeScope).toEqual({ kind: "collection", collectionId: COLLECTION_ID });
      expect(model.projects).toEqual([
        { projectKey: PROJECT_KEY, label: "Fresh Platform", workspaceCount: 1 },
      ]);
      expect(model.projectChoices).toEqual([{ projectKey: PROJECT_KEY, label: "Fresh Platform" }]);
      expect(model.visibleProjects.map((project) => project.id)).toEqual([
        identified.id,
        freshUnidentified.id,
      ]);
      expect(model.visibleThreads.map((thread) => thread.id)).toEqual(["thread-0", "thread-1"]);
    },
  );
});
