import type { EnvironmentId } from "@t3tools/contracts";
import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
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

type HomeListFilterMenuAction = {
  readonly type: "action";
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  readonly onPress: () => void;
};

type HomeListFilterMenuSubmenu = {
  readonly type: "submenu";
  readonly title: string;
  readonly items: HomeListFilterMenuAction[];
};

export interface HomeListFilterMenu {
  readonly title: string;
  readonly items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu>;
}

export function buildHomeListFilterMenu(props: {
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
}): HomeListFilterMenu {
  const items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu> = [];

  items.push({
    type: "submenu",
    title: "Environment",
    items: [
      {
        type: "action",
        title: "All environments",
        subtitle: "Show threads from every environment",
        state: props.selectedEnvironmentId === null ? "on" : "off",
        onPress: () => props.onEnvironmentChange(null),
      },
      ...props.environments.map((environment) => ({
        type: "action" as const,
        title: environment.label,
        state:
          props.selectedEnvironmentId === environment.environmentId
            ? ("on" as const)
            : ("off" as const),
        onPress: () => props.onEnvironmentChange(environment.environmentId),
      })),
    ],
  });

  if (props.projectCollectionsAvailable) {
    items.push({
      type: "submenu",
      title: "Collections",
      items: props.projectCollectionScopeOptions.map((option) => ({
        type: "action" as const,
        title: `${option.label} (${option.count})`,
        state:
          mobileProjectCollectionScopeKey(option.scope) ===
          mobileProjectCollectionScopeKey(props.projectCollectionScope)
            ? ("on" as const)
            : ("off" as const),
        onPress: () => props.onProjectCollectionScopeChange(option.scope),
      })),
    });
  }

  if (props.projects.length > 0) {
    items.push({
      type: "submenu",
      title: "Project",
      items: [
        {
          type: "action",
          title: "All projects",
          subtitle: "Show threads from every project",
          state: props.projectCollectionScope.kind === "all" ? "on" : "off",
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          type: "action" as const,
          title: project.label,
          state: props.selectedProjectKey === project.key ? ("on" as const) : ("off" as const),
          onPress: () => props.onProjectChange(project.key),
        })),
      ],
    });
  }

  if (props.canManageProjectCollections) {
    items.push({
      type: "action",
      title: "Manage collections",
      onPress: props.onManageProjectCollections,
    });
  }

  return {
    title: "Thread list options",
    items,
  };
}
