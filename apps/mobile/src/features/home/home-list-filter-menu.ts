import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import type { EnvironmentId } from "@t3tools/contracts";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import type { MobileProjectCollectionsModel } from "./mobileProjectCollections";
import { mobileProjectCollectionScopeKey } from "./mobileProjectCollections";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
}

export function buildHomeListFilterMenuItems(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly projectCollectionScope: ProjectCollectionScope;
  readonly projectCollectionScopeOptions: MobileProjectCollectionsModel["scopeOptions"];
  readonly projectCollectionsAvailable: boolean;
  readonly canManageProjectCollections: boolean;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onProjectCollectionScopeChange: (scope: ProjectCollectionScope) => void;
  readonly onManageProjectCollections: () => void;
}): AppBarMenuItem[] {
  const items: AppBarMenuItem[] = [
    {
      id: "environment",
      title: "Environment",
      items: [
        {
          id: "environment:all",
          title: "All environments",
          subtitle: "Show threads from every environment",
          selected: props.selectedEnvironmentId === null,
          onPress: () => props.onEnvironmentChange(null),
        },
        ...props.environments.map((environment) => ({
          id: `environment:${environment.environmentId}`,
          title: environment.label,
          selected: props.selectedEnvironmentId === environment.environmentId,
          onPress: () => props.onEnvironmentChange(environment.environmentId),
        })),
      ],
    },
  ];

  if (props.projectCollectionsAvailable) {
    items.push({
      id: "collections",
      title: "Collections",
      items: props.projectCollectionScopeOptions.map((option) => ({
        id: `collection:${mobileProjectCollectionScopeKey(option.scope)}`,
        title: `${option.label} (${option.count})`,
        selected:
          mobileProjectCollectionScopeKey(option.scope) ===
          mobileProjectCollectionScopeKey(props.projectCollectionScope),
        onPress: () => props.onProjectCollectionScopeChange(option.scope),
      })),
    });
  }

  if (props.projects.length > 0) {
    items.push({
      id: "project",
      title: "Project",
      items: [
        {
          id: "project:all",
          title: "All projects",
          subtitle: "Show threads from every project",
          selected: props.projectCollectionScope.kind === "all",
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          id: `project:${project.key}`,
          title: project.label,
          selected: props.selectedProjectKey === project.key,
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }

  if (props.canManageProjectCollections) {
    items.push({
      id: "manage-collections",
      title: "Manage collections",
      onPress: props.onManageProjectCollections,
    });
  }

  return items;
}
