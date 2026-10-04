import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { MaterialThreadListToolbar } from "./MaterialThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { mobileProjectCollectionScopeKey } from "./mobileProjectCollections";
import { ProjectCollectionScopeStrip } from "./ProjectCollectionScopeStrip";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function HomeHeader(props: HomeHeaderProps) {
  // Collection scopes narrow the list just like a project filter.
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null || props.projectCollectionScope.kind !== "all";
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
    ],
    [
      props.environments,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectKey,
      props.projectCollectionScope,
      props.projectCollectionScopeOptions,
      props.projectCollectionsAvailable,
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

      if (id.startsWith("collection-scope:")) {
        const scopeKey = id.slice("collection-scope:".length);
        const option = props.projectCollectionScopeOptions.find(
          (candidate) => mobileProjectCollectionScopeKey(candidate.scope) === scopeKey,
        );
        if (option) props.onProjectCollectionScopeChange(option.scope);
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
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
      {/* Below the toolbar: with headerShown false, the toolbar is the only
          thing applying the status-bar inset (see useMaterialToolbarLayout).
          A strip rendered above it would sit under the status bar. */}
      <ProjectCollectionScopeStrip {...props} />
    </>
  );
}
