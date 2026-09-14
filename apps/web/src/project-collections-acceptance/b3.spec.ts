import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts/settings";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  deriveProjectCollectionCounts,
  deriveProjectCollectionProjectKey,
  filterItemsByProjectCollectionScope,
} from "@t3tools/client-runtime/state/project-collections";
import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { describe, expect, it } from "vite-plus/test";

import {
  planProjectCollectionMove,
  planSidebarProjectCollectionDrop,
} from "../components/Sidebar.projectCollectionsDrag";
import {
  beginSidebarProjectCollectionDrag,
  deriveSidebarProjectCollections,
  resolveSidebarProjectCollectionDragProject,
} from "../components/Sidebar.logic";

const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PERSONAL_ID = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");
const projectKey = ProjectCollectionProjectKey.make("repository:github.com/acme/pockeor");

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
const separateGroups = buildProjectGroups({
  projects,
  settings: { sidebarProjectGroupingMode: "separate", sidebarProjectGroupingOverrides: {} },
});
const identity = { group: separateGroups[0]!, projects };

function document(collectionId: typeof WORK_ID | null = WORK_ID): ProjectCollectionsDocument {
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
    assignments: collectionId === null ? [] : [{ projectKey, collectionId }],
  };
}

const impact = { checkoutCount: 3, threadCount: 7 };

describe("desktop project collection assignment", () => {
  it("S3: moves one repository family from All while preserving the All view", () => {
    const source = document();
    const activeScope = { kind: "all" } as const;
    const visibleThreads = Array.from({ length: 7 }, (_, index) => ({
      environmentId: projects[index % projects.length]!.environmentId,
      projectId: projects[index % projects.length]!.id,
      id: `thread-${index}`,
    }));
    const model = deriveSidebarProjectCollections({
      document: source,
      groups: separateGroups.map((group) => ({
        displayName: group.label,
        memberProjects: group.members.map((member) => ({
          ...member.project,
          physicalProjectKey: member.physicalProjectKey,
        })),
        memberProjectRefs: group.memberProjectRefs,
      })),
      projects,
      threads: visibleThreads,
      scope: activeScope,
      sanitizeUnavailableProjects: true,
    });
    const visibleThread = visibleThreads[0]!;
    const draggedProject = resolveSidebarProjectCollectionDragProject({
      model,
      environmentId: visibleThread.environmentId,
      projectId: visibleThread.projectId,
      canMutate: true,
    })!;
    let pickerOpen = false;
    const transfer = {
      effectAllowed: "none" as DataTransfer["effectAllowed"],
      type: "",
      value: "",
      setData(type: string, value: string) {
        this.type = type;
        this.value = value;
      },
    };
    beginSidebarProjectCollectionDrag({
      dataTransfer: transfer,
      projectKey: draggedProject.projectKey,
      openPicker: () => {
        pickerOpen = true;
      },
    });
    const plan = planSidebarProjectCollectionDrop({
      document: source,
      identity: draggedProject.identity,
      activeScope,
      destination: { kind: "collection", collectionId: PERSONAL_ID },
      impact: draggedProject.impact,
    });

    expect(pickerOpen).toBe(true);
    expect(transfer).toMatchObject({
      effectAllowed: "move",
      type: "application/x-t3-sidebar-project-collection",
      value: projectKey,
    });
    expect(transfer.value).not.toBe(visibleThread.id);
    expect(
      new Set(
        visibleThreads.map(
          (thread) =>
            resolveSidebarProjectCollectionDragProject({
              model,
              environmentId: thread.environmentId,
              projectId: thread.projectId,
              canMutate: true,
            })?.projectKey,
        ),
      ),
    ).toEqual(new Set([projectKey]));
    expect(plan.kind).toBe("mutation");
    expect(plan.activeScope).toBe(activeScope);
    expect(plan.document.assignments).toEqual([{ projectKey, collectionId: PERSONAL_ID }]);
    expect(plan.feedback).toBe("Moved 3 checkouts and 7 threads to Personal.");
    expect(deriveProjectCollectionCounts(source, [projectKey]).byCollectionId).toEqual({
      [WORK_ID]: 1,
      [PERSONAL_ID]: 0,
    });
    expect(deriveProjectCollectionCounts(plan.document, [projectKey]).byCollectionId).toEqual({
      [WORK_ID]: 0,
      [PERSONAL_ID]: 1,
    });
    expect(
      new Set(
        separateGroups.map((group) => deriveProjectCollectionProjectKey({ group, projects })),
      ),
    ).toEqual(new Set([projectKey]));
    expect(
      filterItemsByProjectCollectionScope({
        document: plan.document,
        items: separateGroups,
        scope: plan.activeScope,
        projectKey: (group) => deriveProjectCollectionProjectKey({ group, projects }),
      }),
    ).toHaveLength(3);
  });

  it("S4: moving from a filtered collection preserves the filter and removes every family row", () => {
    const activeScope = { kind: "collection", collectionId: WORK_ID } as const;
    const plan = planProjectCollectionMove({
      document: document(),
      identity,
      activeScope,
      destination: { kind: "collection", collectionId: PERSONAL_ID },
      impact,
    });

    expect(plan.kind).toBe("mutation");
    expect(plan.activeScope).toBe(activeScope);
    expect(
      filterItemsByProjectCollectionScope({
        document: plan.document,
        items: separateGroups,
        scope: plan.activeScope,
        projectKey: (group) => deriveProjectCollectionProjectKey({ group, projects }),
      }),
    ).toEqual([]);
  });

  it("S5: reports same-destination no-op and supports Remove from collection", () => {
    const source = document();
    const sameDestination = planProjectCollectionMove({
      document: source,
      identity,
      activeScope: { kind: "collection", collectionId: WORK_ID },
      destination: { kind: "collection", collectionId: WORK_ID },
      impact,
    });
    const unfiled = planProjectCollectionMove({
      document: source,
      identity,
      activeScope: { kind: "collection", collectionId: WORK_ID },
      destination: { kind: "unfiled" },
      impact,
    });

    expect(sameDestination).toMatchObject({
      kind: "noop",
      reason: "already-in-destination",
      feedback: "Already in Work. No changes made.",
    });
    expect(sameDestination.document).toBe(source);
    expect(unfiled).toMatchObject({ kind: "mutation", document: { assignments: [] } });
    expect(
      filterItemsByProjectCollectionScope({
        document: unfiled.document,
        items: separateGroups,
        scope: { kind: "unfiled" },
        projectKey: (group) => deriveProjectCollectionProjectKey({ group, projects }),
      }),
    ).toHaveLength(3);
  });
});
