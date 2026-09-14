import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts/settings";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { describe, expect, it } from "vite-plus/test";

import {
  planProjectCollectionMove,
  planSidebarProjectCollectionDrop,
} from "./Sidebar.projectCollectionsDrag";

const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PERSONAL_ID = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");

function project(environmentId: string, id: string, workspaceRoot: string): EnvironmentProject {
  return {
    environmentId: EnvironmentId.make(environmentId),
    id: ProjectId.make(id),
    title: "PockeoR",
    workspaceRoot,
    repositoryIdentity: {
      canonicalKey: "github.com/acme/pockeor",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/pockeor.git",
      },
      rootPath: workspaceRoot,
      provider: "github",
      owner: "acme",
      name: "pockeor",
      displayName: "PockeoR",
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const projects = [
  project("mac", "main", "/work/pockeor"),
  project("laptop", "feature", "/worktrees/pockeor-feature"),
  project("desktop", "release", "/worktrees/pockeor-release"),
];
const [group] = buildProjectGroups({
  projects,
  settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
});
const identity = { group: group!, projects };
const repositoryKey = ProjectCollectionProjectKey.make("repository:github.com/acme/pockeor");

function document(collectionId = WORK_ID): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      {
        id: WORK_ID,
        name: "Work",
        visual: { kind: "lucide", name: "briefcase", color: "blue" },
      },
      {
        id: PERSONAL_ID,
        name: "Personal",
        visual: { kind: "lucide", name: "home", color: "green" },
      },
    ],
    assignments: [{ projectKey: repositoryKey, collectionId }],
  };
}

const impact = { checkoutCount: 3, threadCount: 7 };

describe("project collection move planning", () => {
  it("plans one complete-document assignment from All without changing the active scope", () => {
    const source = document();
    const activeScope = { kind: "all" } as const;
    const result = planSidebarProjectCollectionDrop({
      document: source,
      identity,
      activeScope,
      destination: { kind: "collection", collectionId: PERSONAL_ID },
      impact,
    });

    expect(result).toMatchObject({
      kind: "mutation",
      projectKey: repositoryKey,
      activeScope,
      destination: { kind: "collection", collectionId: PERSONAL_ID },
      feedback: "Moved 3 checkouts and 7 threads to Personal.",
    });
    expect(result.document).not.toBe(source);
    expect(result.document.assignments).toEqual([
      { projectKey: repositoryKey, collectionId: PERSONAL_ID },
    ]);
  });

  it("returns explicit same-destination and already-Unfiled no-ops with no write document", () => {
    const assigned = document();
    const filteredScope = { kind: "collection", collectionId: WORK_ID } as const;
    const sameDestination = planProjectCollectionMove({
      document: assigned,
      identity,
      activeScope: filteredScope,
      destination: { kind: "collection", collectionId: WORK_ID },
      impact,
    });
    const unfiled: ProjectCollectionsDocument = { ...assigned, assignments: [] };
    const alreadyUnfiled = planProjectCollectionMove({
      document: unfiled,
      identity,
      activeScope: { kind: "unfiled" },
      destination: { kind: "unfiled" },
      impact,
    });

    expect(sameDestination).toMatchObject({
      kind: "noop",
      reason: "already-in-destination",
      activeScope: filteredScope,
      feedback: "Already in Work. No changes made.",
    });
    expect(sameDestination.document).toBe(assigned);
    expect(alreadyUnfiled).toMatchObject({
      kind: "noop",
      reason: "already-unfiled",
      feedback: "Already Unfiled. No changes made.",
    });
    expect(alreadyUnfiled.document).toBe(unfiled);
  });

  it("unfiles the whole stable identity and rejects a deleted destination", () => {
    const source = document();
    const unfiled = planSidebarProjectCollectionDrop({
      document: source,
      identity,
      activeScope: { kind: "collection", collectionId: WORK_ID },
      destination: { kind: "unfiled" },
      impact,
    });
    const staleDestination = ProjectCollectionId.make("ef5d7c34-0c54-48e7-935d-cf584b9f1ee8");
    const rejected = planSidebarProjectCollectionDrop({
      document: source,
      identity,
      activeScope: { kind: "all" },
      destination: { kind: "collection", collectionId: staleDestination },
      impact,
    });

    expect(unfiled).toMatchObject({
      kind: "mutation",
      projectKey: repositoryKey,
      activeScope: { kind: "collection", collectionId: WORK_ID },
      destination: { kind: "unfiled" },
      feedback: "Moved 3 checkouts and 7 threads to Unfiled.",
      document: { assignments: [] },
    });
    expect(rejected).toMatchObject({
      kind: "rejected",
      reason: "stale-destination",
      feedback: "That collection no longer exists. Refresh and choose another destination.",
    });
    expect(rejected.document).toBe(source);
  });

  it("returns domain validation feedback instead of planning an invalid write", () => {
    const oversizedProjects = [
      {
        ...projects[0]!,
        repositoryIdentity: {
          ...projects[0]!.repositoryIdentity!,
          canonicalKey: "x".repeat(502),
        },
      },
    ];
    const [oversizedGroup] = buildProjectGroups({
      projects: oversizedProjects,
      settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
    });
    const source = document();

    const rejected = planProjectCollectionMove({
      document: source,
      identity: { group: oversizedGroup!, projects: oversizedProjects },
      activeScope: { kind: "all" },
      destination: { kind: "collection", collectionId: PERSONAL_ID },
      impact,
    });

    expect(rejected).toMatchObject({
      kind: "rejected",
      reason: "invalid-mutation",
      error: { code: "project-key-limit", field: "projectKey" },
      feedback: "Collection project keys must be between 1 and 512 characters.",
    });
    expect(rejected.document).toBe(source);
  });
});
