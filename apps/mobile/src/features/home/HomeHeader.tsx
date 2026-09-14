import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import type { EnvironmentId, SidebarThreadSortOrder } from "@t3tools/contracts";
import type { MenuAction } from "@react-native-menu/menu";
import { HeaderHeightContext } from "@react-navigation/elements";
import Constants from "expo-constants";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useCallback, useContext, useMemo, useRef } from "react";
import { Platform, Pressable, ScrollView, Text as RNText, TextInput, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ControlPillMenu } from "../../components/ControlPill";
import { ProjectCollectionIcon } from "../../components/ProjectCollectionIcon";
import { SymbolView } from "../../components/AppSymbol";
import { T3Wordmark } from "../../components/T3Wordmark";
import { HOME_HORIZONTAL_INSET, IOS_NAV_BAR_HEIGHT } from "../../lib/layoutMetrics";
import { resolveMobileStageLabel } from "../../lib/mobileBranding";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { useThreadListV2Enabled } from "../threads/use-thread-list-v2-enabled";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { withNativeGlassHeaderItem } from "../layout/native-glass-header-items";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import type { HomeProjectSortOrder } from "./homeThreadList";
import {
  mobileProjectCollectionScopeKey,
  type MobileProjectCollectionsModel,
} from "./mobileProjectCollections";
import { WorkspaceConnectionTitle } from "./WorkspaceConnectionTitle";
import {
  buildHomeListFilterMenu,
  type HomeListFilterMenuEnvironment,
  type HomeListFilterMenuProject,
} from "./home-list-filter-menu";
import {
  hasCustomHomeListOptions,
  PROJECT_SORT_OPTIONS,
  THREAD_SORT_OPTIONS,
} from "./home-list-options";

export type HomeHeaderEnvironment = HomeListFilterMenuEnvironment;

export function HomeHeader(props: {
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
}) {
  if (Platform.OS === "android") {
    return <AndroidHomeHeader {...props} />;
  }

  return <IosHomeHeader {...props} />;
}

type HomeHeaderProps = Parameters<typeof HomeHeader>[0];

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

function ProjectCollectionScopeStrip(props: HomeHeaderProps) {
  const insets = useSafeAreaInsets();
  const navigationHeaderHeight = useContext(HeaderHeightContext);
  const addActions = useMemo<MenuAction[]>(
    () => [
      { id: "add:project", title: "New project" },
      ...(props.canManageProjectCollections
        ? [
            { id: "add:collection", title: "New collection" },
            { id: "add:manage", title: "Manage collections" },
          ]
        : []),
    ],
    [props.canManageProjectCollections],
  );
  const handleAddAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "add:project") {
        props.onStartNewProject();
      } else if (nativeEvent.event === "add:collection" || nativeEvent.event === "add:manage") {
        props.onManageProjectCollections();
      }
    },
    [props.onManageProjectCollections, props.onStartNewProject],
  );

  return (
    <View
      testID="project-collection-scope-strip"
      className="flex-row items-center gap-2 px-4 py-2"
      // The native iOS navigation bar is translucent, so content begins behind
      // it. Prefer the navigator's measured height and retain a safe fallback
      // for previews and tests outside a header-providing screen.
      style={
        Platform.OS === "ios"
          ? { paddingTop: (navigationHeaderHeight || insets.top + IOS_NAV_BAR_HEIGHT) + 8 }
          : undefined
      }
    >
      {props.projectCollectionsAvailable ? (
        <ScrollView
          horizontal
          className="min-w-0 flex-1"
          contentContainerClassName="gap-2"
          showsHorizontalScrollIndicator={false}
        >
          {props.projectCollectionScopeOptions.map((option) => {
            const selected =
              mobileProjectCollectionScopeKey(option.scope) ===
              mobileProjectCollectionScopeKey(props.projectCollectionScope);
            return (
              <Pressable
                key={mobileProjectCollectionScopeKey(option.scope)}
                accessibilityLabel={`Show ${option.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className={
                  selected
                    ? "h-10 flex-row items-center gap-2 rounded-full bg-primary px-3"
                    : "h-10 flex-row items-center gap-2 rounded-full bg-subtle px-3"
                }
                onPress={() => props.onProjectCollectionScopeChange(option.scope)}
              >
                {option.collection ? (
                  <ProjectCollectionIcon size={16} visual={option.collection.visual} />
                ) : (
                  <SymbolView
                    name={option.scope.kind === "unfiled" ? "tray" : "square.grid.2x2"}
                    size={15}
                    tintColorClassName={selected ? "accent-primary-foreground" : "accent-icon"}
                    type="monochrome"
                  />
                )}
                <RNText
                  className={
                    selected
                      ? "text-xs font-t3-bold text-primary-foreground"
                      : "text-xs font-t3-bold text-foreground"
                  }
                >
                  {option.label} · {option.count}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View className="flex-1" />
      )}
      <ControlPillMenu actions={addActions} isAnchoredToRight onPressAction={handleAddAction}>
        <Pressable
          accessibilityLabel="Add project or collection"
          accessibilityRole="button"
          className="size-10 items-center justify-center rounded-full bg-subtle"
        >
          <SymbolView name="plus" size={17} tintColorClassName="accent-icon" type="monochrome" />
        </Pressable>
      </ControlPillMenu>
    </View>
  );
}

function AndroidHomeHeader(props: HomeHeaderProps) {
  const insets = useSafeAreaInsets();
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  // Thread List v2 lays the list out in fixed creation order, so the
  // sort/group filter controls would be silently ignored — hide them and
  // key the "customized" icon state off the environment filter alone.
  const threadListV2Enabled = useThreadListV2Enabled();
  const hasCustomListOptions = threadListV2Enabled
    ? props.selectedEnvironmentId !== null || props.projectCollectionScope.kind !== "all"
    : hasCustomHomeListOptions({
        ...props,
        selectedProjectKey:
          props.projectCollectionScope.kind === "all"
            ? null
            : (props.selectedProjectKey ?? "collection"),
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
      <View
        className="border-b border-header-border bg-header pb-3"
        style={{
          paddingHorizontal: HOME_HORIZONTAL_INSET,
          paddingTop: Math.max(insets.top, 12),
        }}
      >
        <View className="w-full max-w-[720px] self-center gap-3">
          <View className="flex-row items-center gap-2.5">
            {/* Brand slot doubles as the connection status surface: while an
                environment reconnects, the lockup fades to a status label in
                place (no layout shift in the list below). */}
            <WorkspaceConnectionTitle
              grow
              onPress={props.onOpenEnvironments}
              brand={
                <View className="flex-row items-center gap-2">
                  {/* Mirrors the desktop SidebarBrand: T3 mark + muted "Code". */}
                  <T3Wordmark colorClassName="accent-icon" height={15} />
                  <RNText className="-ml-0.5 text-[21px] font-t3-medium tracking-[-0.5px] text-foreground-muted">
                    Code
                  </RNText>
                  <View className="rounded-full bg-subtle px-2 py-0.75">
                    <RNText className="text-[11px] font-t3-bold tracking-[1.1px] text-foreground-muted uppercase">
                      {stageLabel}
                    </RNText>
                  </View>
                </View>
              }
            />

            <ControlPillMenu
              actions={menuActions}
              isAnchoredToRight
              onPressAction={handleMenuAction}
            >
              <Pressable
                accessibilityLabel="Filter and sort threads"
                accessibilityRole="button"
                className="size-11 items-center justify-center rounded-full bg-subtle"
              >
                <SymbolView
                  name={
                    hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease.circle"
                  }
                  size={16}
                  tintColorClassName={"accent-icon"}
                  type="monochrome"
                />
              </Pressable>
            </ControlPillMenu>
            {/* Built identically to the filter button so the two circles
                match exactly (ControlPill sizes via Tailwind classes and
                resolves to a different box). */}
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              onPress={props.onOpenSettings}
              className="size-11 items-center justify-center rounded-full bg-subtle"
            >
              <SymbolView
                name="gearshape"
                size={18}
                tintColorClassName={"accent-icon"}
                type="monochrome"
              />
            </Pressable>
          </View>

          <ProjectCollectionScopeStrip {...props} />

          <View className="min-h-12 flex-row items-center gap-2.5 rounded-2xl border border-input-border bg-input px-3.5">
            <SymbolView
              name="magnifyingglass"
              size={17}
              tintColorClassName={"accent-foreground-muted"}
              type="monochrome"
            />
            <TextInput
              accessibilityLabel="Search threads"
              autoCapitalize="none"
              onChangeText={props.onSearchQueryChange}
              placeholder="Search threads"
              placeholderTextColorClassName="accent-placeholder"
              className="flex-1 py-2.5 text-base font-sans text-foreground"
              value={props.searchQuery}
            />
            {props.searchQuery.length > 0 ? (
              <Pressable
                accessibilityLabel="Clear search"
                hitSlop={10}
                onPress={() => props.onSearchQueryChange("")}
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={17}
                  tintColorClassName={"accent-foreground-muted"}
                  type="monochrome"
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </>
  );
}

function IosHomeHeader(props: HomeHeaderProps) {
  const searchBarRef = useRef<SearchBarCommands>(null);
  const iconColor = useUniwindTheme()["--color-icon"];
  // Thread List v2 lays the list out in fixed creation order, so the
  // sort/group filter controls would be silently ignored — hide them and
  // key the "customized" icon state off the environment filter alone.
  const threadListV2Enabled = useThreadListV2Enabled();
  const hasCustomListOptions = threadListV2Enabled
    ? props.selectedEnvironmentId !== null || props.projectCollectionScope.kind !== "all"
    : hasCustomHomeListOptions({
        ...props,
        selectedProjectKey:
          props.projectCollectionScope.kind === "all"
            ? null
            : (props.selectedProjectKey ?? "collection"),
      });
  const focusSearch = useCallback(() => {
    searchBarRef.current?.focus();
    return searchBarRef.current !== null;
  }, []);
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  const filterMenu = buildHomeListFilterMenu({
    ...props,
    selectedProjectKey:
      props.projectCollectionScope.kind === "all"
        ? null
        : (props.selectedProjectKey ?? "collection"),
    listOrganization: !threadListV2Enabled,
  });

  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={filterMenu.items}
        options={{
          // Static header config (glass, title, fonts) lives in Stack.tsx
          // (GLASS_HEADER_OPTIONS). Only dynamic values are set here.
          headerTintColor: iconColor,
          unstable_headerRightItems:
            Platform.OS === "ios"
              ? () => [
                  withNativeGlassHeaderItem({
                    accessibilityLabel: "Open settings",
                    icon: { name: "ellipsis", type: "sfSymbol" } as const,
                    identifier: "home-settings",
                    label: "",
                    onPress: props.onOpenSettings,
                    type: "button",
                  }),
                ]
              : undefined,
          // The keys below are set per-branch (not `undefined`) so a later
          // reapply cannot clobber options owned by NativeHeaderToolbar.
          ...(NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
            ? {
                unstable_headerToolbarItems: () => [
                  createNativeMailSearchToolbarItem({
                    composeButtonId: "home-new-task",
                    composeSystemImageName: "square.and.pencil",
                    filterMenu,
                    filterButtonId: "home-filter",
                    filterSystemImageName: hasCustomListOptions
                      ? "line.3.horizontal.decrease.circle.fill"
                      : "line.3.horizontal.decrease",
                    onComposePress: props.onStartNewTask,
                    onSearchTextChange: props.onSearchQueryChange,
                    placeholder: "Search",
                    searchTextChangeId: "home-search-text",
                    showsSearchDismissButton: true,
                  }),
                ],
              }
            : {
                // Pre-Liquid-Glass iOS: standard pull-down search in the nav
                // bar; create + sort live in the plain bottom toolbar below.
                headerSearchBarOptions: {
                  ref: searchBarRef,
                  autoCapitalize: "none" as const,
                  hideNavigationBar: false,
                  placeholder: "Search",
                  onCancelButtonPress: () => {
                    props.onSearchQueryChange("");
                  },
                  onChangeText: (event) => {
                    props.onSearchQueryChange(event.nativeEvent.text);
                  },
                },
              }),
        }}
      />

      <ProjectCollectionScopeStrip {...props} />

      {NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED ? null : (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.Menu
            accessibilityLabel="Filter and sort threads"
            icon={
              hasCustomListOptions
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            title="Thread list options"
            separateBackground
          >
            <NativeHeaderToolbar.Menu title="Environment">
              <NativeHeaderToolbar.Label>Environment</NativeHeaderToolbar.Label>
              <NativeHeaderToolbar.MenuAction
                isOn={props.selectedEnvironmentId === null}
                onPress={() => props.onEnvironmentChange(null)}
                subtitle="Show threads from every environment"
              >
                <NativeHeaderToolbar.Label>All environments</NativeHeaderToolbar.Label>
              </NativeHeaderToolbar.MenuAction>
              {props.environments.map((environment) => (
                <NativeHeaderToolbar.MenuAction
                  key={environment.environmentId}
                  isOn={props.selectedEnvironmentId === environment.environmentId}
                  onPress={() => props.onEnvironmentChange(environment.environmentId)}
                >
                  <NativeHeaderToolbar.Label>{environment.label}</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
              ))}
            </NativeHeaderToolbar.Menu>

            {props.projects.length > 0 ? (
              <NativeHeaderToolbar.Menu title="Project">
                <NativeHeaderToolbar.Label>Project</NativeHeaderToolbar.Label>
                <NativeHeaderToolbar.MenuAction
                  isOn={props.projectCollectionScope.kind === "all"}
                  onPress={() => props.onProjectChange(null)}
                  subtitle="Show threads from every project"
                >
                  <NativeHeaderToolbar.Label>All projects</NativeHeaderToolbar.Label>
                </NativeHeaderToolbar.MenuAction>
                {props.projects.map((project) => (
                  <NativeHeaderToolbar.MenuAction
                    key={project.key}
                    isOn={props.selectedProjectKey === project.key}
                    onPress={() => props.onProjectChange(project.key)}
                  >
                    <NativeHeaderToolbar.Label>{project.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            ) : null}

            {threadListV2Enabled ? null : (
              <NativeHeaderToolbar.Menu title="Sort projects">
                <NativeHeaderToolbar.Label>Sort projects</NativeHeaderToolbar.Label>
                {PROJECT_SORT_OPTIONS.map((option) => (
                  <NativeHeaderToolbar.MenuAction
                    key={option.value}
                    isOn={props.projectSortOrder === option.value}
                    onPress={() => props.onProjectSortOrderChange(option.value)}
                  >
                    <NativeHeaderToolbar.Label>{option.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            )}

            {threadListV2Enabled ? null : (
              <NativeHeaderToolbar.Menu title="Sort threads">
                <NativeHeaderToolbar.Label>Sort threads</NativeHeaderToolbar.Label>
                {THREAD_SORT_OPTIONS.map((option) => (
                  <NativeHeaderToolbar.MenuAction
                    key={option.value}
                    isOn={props.threadSortOrder === option.value}
                    onPress={() => props.onThreadSortOrderChange(option.value)}
                  >
                    <NativeHeaderToolbar.Label>{option.label}</NativeHeaderToolbar.Label>
                  </NativeHeaderToolbar.MenuAction>
                ))}
              </NativeHeaderToolbar.Menu>
            )}
          </NativeHeaderToolbar.Menu>
          <NativeHeaderToolbar.Spacer flexible />
          <NativeHeaderToolbar.Menu
            accessibilityLabel="Add project or collection"
            icon="plus"
            title="Add"
            separateBackground
          >
            <NativeHeaderToolbar.MenuAction onPress={props.onStartNewProject}>
              <NativeHeaderToolbar.Label>New project</NativeHeaderToolbar.Label>
            </NativeHeaderToolbar.MenuAction>
            {props.canManageProjectCollections ? (
              <NativeHeaderToolbar.MenuAction onPress={props.onManageProjectCollections}>
                <NativeHeaderToolbar.Label>New collection</NativeHeaderToolbar.Label>
              </NativeHeaderToolbar.MenuAction>
            ) : null}
            {props.canManageProjectCollections ? (
              <NativeHeaderToolbar.MenuAction onPress={props.onManageProjectCollections}>
                <NativeHeaderToolbar.Label>Manage collections</NativeHeaderToolbar.Label>
              </NativeHeaderToolbar.MenuAction>
            ) : null}
          </NativeHeaderToolbar.Menu>
          <NativeHeaderToolbar.Button
            accessibilityLabel="New task"
            icon="square.and.pencil"
            onPress={props.onStartNewTask}
            separateBackground
          />
        </NativeHeaderToolbar>
      )}
    </>
  );
}
