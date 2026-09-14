import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import type { EnvironmentId, SidebarThreadSortOrder } from "@t3tools/contracts";
import type { HomeProjectSortOrder } from "./homeThreadList";
import type { MobileProjectCollectionsModel } from "./mobileProjectCollections";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export interface HomeHeaderProps {
  readonly environments: ReadonlyArray<HomeHeaderEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly searchQuery: string;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly projectCollectionScope: ProjectCollectionScope;
  readonly projectCollectionScopeOptions: MobileProjectCollectionsModel["scopeOptions"];
  readonly projectCollectionsAvailable: boolean;
  readonly canManageProjectCollections: boolean;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly threadSortOrder: SidebarThreadSortOrder;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onProjectCollectionScopeChange: (scope: ProjectCollectionScope) => void;
  readonly onManageProjectCollections: () => void;
  readonly onProjectSortOrderChange: (sortOrder: HomeProjectSortOrder) => void;
  readonly onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
  readonly onOpenEnvironments: () => void;
  readonly onOpenSettings: () => void;
  readonly onStartNewTask: () => void;
  readonly onStartNewProject: () => void;
}
