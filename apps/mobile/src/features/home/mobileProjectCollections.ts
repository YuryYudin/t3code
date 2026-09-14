import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import {
  deriveProjectCollectionProjectKey,
  filterItemsByProjectCollectionScope,
  type ProjectCollectionCounts,
  type ProjectCollectionScope,
  type ProjectCollectionScopeOption,
} from "@t3tools/client-runtime/state/project-collections";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ProjectCollectionProjectKey,
  ProjectCollectionsDocument,
  SidebarProjectGroupingMode,
} from "@t3tools/contracts";

import { scopedProjectKey } from "../../lib/scopedEntities";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import {
  buildHomeProjectScopes,
  buildHomeThreadListModel,
  sortHomeProjectScopes,
  type HomeProjectScope,
  type HomeProjectSortOrder,
} from "./homeThreadList";

export interface MobileProjectCollectionProject {
  readonly projectKey: ProjectCollectionProjectKey;
  readonly label: string;
  readonly workspaceCount: number;
}

export interface MobileProjectCollectionProjectChoice {
  readonly projectKey: ProjectCollectionProjectKey;
  readonly label: string;
}

export interface MobileProjectCollectionsModel {
  readonly activeScope: ProjectCollectionScope;
  readonly activeScopeLabel: string;
  readonly scopeOptions: ReadonlyArray<ProjectCollectionScopeOption>;
  readonly collectionCounts: ProjectCollectionCounts;
  readonly projects: ReadonlyArray<MobileProjectCollectionProject>;
  readonly projectChoices: ReadonlyArray<MobileProjectCollectionProjectChoice>;
  readonly visibleProjects: ReadonlyArray<EnvironmentProject>;
  readonly visibleThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly visiblePendingTasks: ReadonlyArray<PendingNewTask>;
}

export function mobileProjectCollectionScopeKey(scope: ProjectCollectionScope): string {
  if (scope.kind === "collection") return `collection:${scope.collectionId}`;
  if (scope.kind === "project") return `project:${scope.projectKey}`;
  return scope.kind;
}

function projectCollectionKey(
  scope: HomeProjectScope,
  projects: ReadonlyArray<EnvironmentProject>,
): ProjectCollectionProjectKey {
  return deriveProjectCollectionProjectKey({
    group: {
      members: scope.projects.map((project) => ({
        project,
        physicalProjectKey: derivePhysicalProjectKey(project),
      })),
      memberProjectRefs: scope.projectRefs,
    },
    projects,
  }) as ProjectCollectionProjectKey;
}

export function buildMobileProjectCollectionsModel(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly environmentId: EnvironmentId | null;
  readonly projectGroupingMode: SidebarProjectGroupingMode;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly document: ProjectCollectionsDocument;
  readonly scope: ProjectCollectionScope;
}): MobileProjectCollectionsModel {
  const homeScopes = buildHomeProjectScopes({
    projects: input.projects,
    environmentId: null,
    projectGroupingMode: input.projectGroupingMode,
  });
  const orderedScopes = sortHomeProjectScopes({
    scopes: homeScopes,
    threads: input.threads,
    pendingTasks: input.pendingTasks,
    projectSortOrder: input.projectSortOrder,
  });
  const projectKeyByProjectRef = new Map<string, ProjectCollectionProjectKey>();
  const projectRows = new Map<
    ProjectCollectionProjectKey,
    {
      readonly projectKey: ProjectCollectionProjectKey;
      readonly label: string;
      readonly physicalKeys: Set<string>;
      readonly environmentIds: Set<EnvironmentId>;
    }
  >();
  const orderedProjectKeys: ProjectCollectionProjectKey[] = [];
  for (const scope of orderedScopes) {
    const projectKey = projectCollectionKey(scope, input.projects);
    for (const projectRef of scope.projectRefs) {
      projectKeyByProjectRef.set(
        scopedProjectKey(projectRef.environmentId, projectRef.projectId),
        projectKey,
      );
    }
    if (!projectRows.has(projectKey)) {
      projectRows.set(projectKey, {
        projectKey,
        label: scope.title,
        physicalKeys: new Set(),
        environmentIds: new Set(),
      });
      orderedProjectKeys.push(projectKey);
    }
    const row = projectRows.get(projectKey)!;
    for (const project of scope.projects) {
      row.physicalKeys.add(derivePhysicalProjectKey(project));
      row.environmentIds.add(project.environmentId);
    }
  }
  const listModel = buildHomeThreadListModel({
    projects: input.projects,
    threads: input.threads,
    pendingTasks: input.pendingTasks,
    environmentId: null,
    searchQuery: "",
    projectSortOrder: input.projectSortOrder,
    threadSortOrder: "updated_at",
    projectGroupingMode: input.projectGroupingMode,
    projectCollections: input.document,
    projectCollectionScope: input.scope,
  });
  const activeScope = listModel.activeScope;
  const visibleProjectKeys = new Set(
    filterItemsByProjectCollectionScope({
      document: input.document,
      items: orderedProjectKeys,
      scope: activeScope,
      projectKey: (projectKey) => projectKey,
    }),
  );
  const projectIsVisible = (project: EnvironmentProject) => {
    if (input.environmentId !== null && project.environmentId !== input.environmentId) return false;
    const projectKey = projectKeyByProjectRef.get(
      scopedProjectKey(project.environmentId, project.id),
    );
    return projectKey !== undefined && visibleProjectKeys.has(projectKey);
  };
  const projectRefIsVisible = (
    environmentId: EnvironmentId,
    projectId: EnvironmentProject["id"],
  ) => {
    if (input.environmentId !== null && environmentId !== input.environmentId) return false;
    const projectKey = projectKeyByProjectRef.get(scopedProjectKey(environmentId, projectId));
    return projectKey !== undefined && visibleProjectKeys.has(projectKey);
  };
  const scopeOptions = listModel.scopeOptions;
  const activeScopeLabel =
    activeScope.kind === "project"
      ? (projectRows.get(activeScope.projectKey as ProjectCollectionProjectKey)?.label ??
        "All projects")
      : (scopeOptions.find(
          (option) =>
            mobileProjectCollectionScopeKey(option.scope) ===
            mobileProjectCollectionScopeKey(activeScope),
        )?.label ?? "All projects");

  return {
    activeScope,
    activeScopeLabel,
    scopeOptions,
    collectionCounts: listModel.collectionCounts,
    projects: orderedProjectKeys.map((projectKey) => {
      const row = projectRows.get(projectKey)!;
      return {
        projectKey,
        label: row.label,
        workspaceCount: row.physicalKeys.size,
      };
    }),
    projectChoices: orderedProjectKeys.flatMap((projectKey) => {
      const row = projectRows.get(projectKey)!;
      return input.environmentId === null || row.environmentIds.has(input.environmentId)
        ? [{ projectKey, label: row.label }]
        : [];
    }),
    visibleProjects: input.projects.filter(projectIsVisible),
    visibleThreads: input.threads.filter((thread) =>
      projectRefIsVisible(thread.environmentId, thread.projectId),
    ),
    visiblePendingTasks: input.pendingTasks.filter((pendingTask) => {
      if (input.environmentId !== null && pendingTask.environmentId !== input.environmentId) {
        return false;
      }
      const knownProject = projectKeyByProjectRef.get(
        scopedProjectKey(pendingTask.environmentId, pendingTask.projectId),
      );
      if (knownProject !== undefined) return visibleProjectKeys.has(knownProject);
      return activeScope.kind === "all" || activeScope.kind === "unfiled";
    }),
  };
}
