import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useThreadListV2Enabled } from "../threads/use-thread-list-v2-enabled";
import { MaterialThreadListToolbar } from "./MaterialThreadListToolbar";
import {
  hasCustomHomeListOptions,
  PROJECT_SORT_OPTIONS,
  THREAD_SORT_OPTIONS,
} from "./home-list-options";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { mobileProjectCollectionScopeKey } from "./mobileProjectCollections";
import { ProjectCollectionScopeStrip } from "./ProjectCollectionScopeStrip";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function HomeHeader(props: HomeHeaderProps) {
  // Thread List v2 lays the list out in fixed creation order, so the
  // sort/group filter controls would be silently ignored — hide them and
  // key the "customized" icon state off the environment filter alone.
  const threadListV2Enabled = useThreadListV2Enabled();
  // A collection scope narrows the list the same way a project filter does, so
  // it has to count as a customized list even though it is not a project key.
  const collectionAwareSelectedProjectKey =
    props.projectCollectionScope.kind === "all" ? null : (props.selectedProjectKey ?? "collection");
  const hasCustomListOptions = threadListV2Enabled
    ? props.selectedEnvironmentId !== null || props.projectCollectionScope.kind !== "all"
    : hasCustomHomeListOptions({
        ...props,
        selectedProjectKey: collectionAwareSelectedProjectKey,
      });
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: "Environment",
        subactions: [
          {
            id: "environment:all",
            title: "All environments",
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.projectCollectionsAvailable
        ? ([
            {
              id: "collection-scope",
              title: "Collections",
              subactions: props.projectCollectionScopeOptions.map((option) => ({
                id: `collection-scope:${mobileProjectCollectionScopeKey(option.scope)}`,
                title: `${option.label} (${option.count})`,
                state: checkedMenuState(
                  mobileProjectCollectionScopeKey(option.scope) ===
                    mobileProjectCollectionScopeKey(props.projectCollectionScope),
                ),
              })),
            },
          ] satisfies MenuAction[])
        : []),
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: "Project",
              subactions: [
                {
                  id: "project:all",
                  title: "All projects",
                  state: checkedMenuState(props.projectCollectionScope.kind === "all"),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
              ],
            },
          ] satisfies MenuAction[])),
      ...(threadListV2Enabled
        ? []
        : ([
            {
              id: "project-sort",
              title: "Sort projects",
              subactions: PROJECT_SORT_OPTIONS.map((option) => ({
                id: `project-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.projectSortOrder === option.value),
              })),
            },
            {
              id: "thread-sort",
              title: "Sort threads",
              subactions: THREAD_SORT_OPTIONS.map((option) => ({
                id: `thread-sort:${option.value}`,
                title: option.label,
                state: checkedMenuState(props.threadSortOrder === option.value),
              })),
            },
          ] satisfies MenuAction[])),
    ],
    [
      props.environments,
      props.projectCollectionScope,
      props.projectCollectionScopeOptions,
      props.projectCollectionsAvailable,
      props.projectSortOrder,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectKey,
      props.threadSortOrder,
      threadListV2Enabled,
    ],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === "project:all") {
        props.onProjectCollectionScopeChange({ kind: "all" });
        return;
      }

      if (id.startsWith("collection-scope:")) {
        const scopeKey = id.slice("collection-scope:".length);
        const option = props.projectCollectionScopeOptions.find(
          (candidate) => mobileProjectCollectionScopeKey(candidate.scope) === scopeKey,
        );
        if (option) props.onProjectCollectionScopeChange(option.scope);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }

      const projectSort = PROJECT_SORT_OPTIONS.find(
        (option) => id === `project-sort:${option.value}`,
      );
      if (projectSort) {
        props.onProjectSortOrderChange(projectSort.value);
        return;
      }

      const threadSort = THREAD_SORT_OPTIONS.find((option) => id === `thread-sort:${option.value}`);
      if (threadSort) {
        props.onThreadSortOrderChange(threadSort.value);
        return;
      }
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <MaterialThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={hasCustomListOptions}
        onFilterAction={handleMenuAction}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
      />
      <ProjectCollectionScopeStrip {...props} />
    </>
  );
}
