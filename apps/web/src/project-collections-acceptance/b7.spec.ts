import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveSidebarProjectCollections,
  type SidebarProjectCollectionGroup,
} from "../components/Sidebar.logic";
import { sidebarProjectCollectionScopeValue } from "../components/SidebarProjectCollections";

const environmentId = EnvironmentId.make("mac");
const workId = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const personalId = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");
const clientsId = ProjectCollectionId.make("4a41b57e-ff30-42f2-bc72-02e638de0f2d");
const archiveId = ProjectCollectionId.make("00000000-0000-4000-8000-000000000001");

function project(id: string, canonicalKey: string | null): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity:
      canonicalKey === null
        ? null
        : {
            canonicalKey,
            locator: {
              source: "git-remote",
              remoteName: "origin",
              remoteUrl: `git:${canonicalKey}`,
            },
            rootPath: `/work/${id}`,
            provider: "github",
            owner: "acme",
            name: id,
            displayName: id,
          },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const pockeor = project("PockeoR", "github.com/acme/pockeor");
const tcoder = project("tcoder", "github.com/acme/tcoder");
const homelab = project("HomeLab", "github.com/acme/homelab");
const scratch = project("scratch-api", null);
const projects = [tcoder, pockeor, homelab, scratch];
const groups: SidebarProjectCollectionGroup<EnvironmentProject>[] = projects.map((candidate) => ({
  displayName: candidate.title,
  memberProjects: [
    { ...candidate, physicalProjectKey: `${candidate.environmentId}:${candidate.id}` },
  ],
  memberProjectRefs: [{ environmentId: candidate.environmentId, projectId: candidate.id }],
}));
const pockeorKey = ProjectCollectionProjectKey.make("repository:github.com/acme/pockeor");
const tcoderKey = ProjectCollectionProjectKey.make("repository:github.com/acme/tcoder");
const homelabKey = ProjectCollectionProjectKey.make("repository:github.com/acme/homelab");

function source(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      { id: workId, name: "Work", visual: { kind: "lucide", name: "briefcase", color: "blue" } },
      { id: personalId, name: "Personal", visual: { kind: "emoji", emoji: "🏠" } },
      {
        id: clientsId,
        name: "Clients",
        visual: { kind: "lucide", name: "layers", color: "green" },
      },
      {
        id: archiveId,
        name: "Archive",
        visual: { kind: "lucide", name: "book-open", color: "gray" },
      },
    ],
    assignments: [
      { projectKey: pockeorKey, collectionId: workId },
      { projectKey: tcoderKey, collectionId: workId },
      { projectKey: homelabKey, collectionId: personalId },
    ],
  };
}

const threads = [
  { id: "tcoder-newest", environmentId, projectId: tcoder.id },
  { id: "pockeor-middle", environmentId, projectId: pockeor.id },
  { id: "homelab-older", environmentId, projectId: homelab.id },
  { id: "scratch-oldest", environmentId, projectId: scratch.id },
];

const derive = (scope: Parameters<typeof deriveSidebarProjectCollections>[0]["scope"]) =>
  deriveSidebarProjectCollections({
    document: source(),
    groups,
    projects,
    threads,
    scope,
    sanitizeUnavailableProjects: true,
  });

describe("desktop sidebar project collections acceptance", () => {
  it("S8: filters All, named, Unfiled, and individual project scopes without nesting the recency list", () => {
    expect(derive({ kind: "all" }).filteredItems.map(({ id }) => id)).toEqual([
      "tcoder-newest",
      "pockeor-middle",
      "homelab-older",
      "scratch-oldest",
    ]);
    expect(
      derive({ kind: "collection", collectionId: workId }).filteredItems.map(({ id }) => id),
    ).toEqual(["tcoder-newest", "pockeor-middle"]);
    expect(derive({ kind: "unfiled" }).filteredItems.map(({ id }) => id)).toEqual([
      "scratch-oldest",
    ]);
    expect(
      derive({ kind: "project", projectKey: pockeorKey }).filteredItems.map(({ id }) => id),
    ).toEqual(["pockeor-middle"]);
    expect(derive({ kind: "collection", collectionId: clientsId }).filteredItems).toEqual([]);
  });

  it("S14: derives populated and empty collection order between pinned virtual scopes", () => {
    const model = derive({ kind: "all" });

    expect(model.scopeOptions.map(({ label, count }) => [label, count])).toEqual([
      ["All projects", 4],
      ["Work", 2],
      ["Personal", 1],
      ["Archive", 0],
      ["Clients", 0],
      ["Unfiled", 1],
    ]);
    expect(sidebarProjectCollectionScopeValue(model.scopeOptions[0]!.scope)).toBe("all");
    expect(sidebarProjectCollectionScopeValue(model.scopeOptions.at(-1)!.scope)).toBe("unfiled");
  });
});
