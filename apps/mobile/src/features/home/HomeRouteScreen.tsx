import { resolveScratchProjectScopeKey } from "@t3tools/client-runtime/state/project-grouping";
import { uuidv4 } from "../../lib/uuid";
import { ThreadUndoNotice } from "./ThreadUndoNotice";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { DEFAULT_PROJECT_COLLECTIONS_DOCUMENT } from "@t3tools/contracts";
import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import { AsyncResult } from "effect/reactivity";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform } from "react-native";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { useProjects } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useLaunchingThreads, usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen } from "./HomeScreen";
import { useHomeListOptions } from "./home-list-options";
import { useAtomValueWhileVisible, useHomeRouteVisible } from "./home-route-visibility";
import {
  buildMobileProjectCollectionsModel,
  mobileProjectCollectionScopeKey,
} from "./mobileProjectCollections";
import { ProjectCollectionsSheet } from "../projects/ProjectCollectionsSheet";
import { useProjectCollections } from "../projects/useProjectCollections";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "../layout/workspace/useSelectWorkspaceTab";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { WorkspaceListEmptyDetail } from "../layout/workspace/WorkspaceListEmptyDetail";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

export function HomeRouteScreen() {
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  const { layout } = useAdaptiveWorkspaceLayout();
  return layout.usesSplitView && nativePrimaryColumn === null ? (
    <SplitHomeRouteScreen />
  ) : (
    <CompactHomeRouteScreen />
  );
}

function SplitHomeRouteScreen() {
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const { state: catalogState } = useWorkspaceState();
  const navigation = useNavigation();
  return (
    <WorkspaceListEmptyDetail
      hasConnections={catalogState.hasConnections}
      onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
      onStartNewTask={startNewTask}
    />
  );
}

function CompactHomeRouteScreen() {
  const { setPrimarySidebarSearchQuery, startNewTask } = useAdaptiveWorkspaceLayout();
  const { primarySidebarSearchQuery } = useWorkspacePaneState();
  const selectDetail = useSelectWorkspaceDetail();
  const projects = useProjects();
  // Stop rebuilding the streaming thread list while Thread covers Home.
  const visible = useHomeRouteVisible();
  const threads = useLaunchingThreads(
    useAtomValueWhileVisible(steadyNavigationThreadShellsAtom, visible),
  );
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const workspace = useWorkspaceTabs();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery =
    Platform.OS === "android"
      ? primarySidebarSearchQuery
      : (workspace?.state.tabs.threads.query ?? localSearchQuery);
  const setSearchQuery = (query: string) => {
    if (Platform.OS === "android") setPrimarySidebarSearchQuery(query);
    else if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setLocalSearchQuery(query);
  };
  const handleSelectThread = useCallback(
    (thread: EnvironmentThreadShell) =>
      selectDetail({
        name: "Thread",
        params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
      }),
    [selectDetail],
  );
  const selectThreadRoute = useCallback(
    (params: ReactNavigation.RootParamList["Thread"]) => selectDetail({ name: "Thread", params }),
    [selectDetail],
  );
  const [projectCollectionsOpen, setProjectCollectionsOpen] = useState(false);
  const [scopeOverride, setScopeOverride] = useState<ProjectCollectionScope | null>(null);
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const projectCollections = useProjectCollections();
  const handleNewThreadOnBranch = useCallback(
    (thread: EnvironmentThreadShell) => {
      selectThreadRoute({
        draft: {
          requestId: uuidv4(),
          environmentId: String(thread.environmentId),
          projectId: String(thread.projectId),
          branch: thread.branch,
          worktreePath: thread.worktreePath,
        },
      });
    },
    [selectThreadRoute],
  );

  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    moveThread,
    renameThread,
    regenerateThreadTitle,
    unsettleThread,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const { openPendingTask, confirmDeletePendingTask } =
    usePendingTaskListActions(selectThreadRoute);
  const connectionStateByEnvironmentId = new Map(
    workspaceEnvironments.map(
      (environment) => [environment.environmentId, environment.connectionState] as const,
    ),
  );
  const environments = Arr.sort(
    Object.values(savedConnectionsById).map((connection) => ({
      environmentId: connection.environmentId,
      label: connection.environmentLabel,
      connectionState: connectionStateByEnvironmentId.get(connection.environmentId) ?? "available",
    })),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const { options: listOptions, setSelectedEnvironmentId } =
    useHomeListOptions(availableEnvironmentIds);
  const selectedEnvironmentId = listOptions.selectedEnvironmentId;
  const storedProjectCollectionScope = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.projectCollectionScope ?? ({ kind: "all" } as const))
    : ({ kind: "all" } as const);
  const requestedProjectCollectionScope = scopeOverride ?? storedProjectCollectionScope;
  const resolvedProjectCollectionScope = useMemo<ProjectCollectionScope>(() => {
    if (requestedProjectCollectionScope.kind !== "project") {
      return requestedProjectCollectionScope;
    }
    return {
      kind: "project",
      projectKey:
        resolveScratchProjectScopeKey(requestedProjectCollectionScope.projectKey, projects, {
          sidebarProjectGroupingMode: listOptions.projectGroupingMode,
          sidebarProjectGroupingOverrides: {},
        }) ?? requestedProjectCollectionScope.projectKey,
    };
  }, [listOptions.projectGroupingMode, projects, requestedProjectCollectionScope]);
  const projectCollectionModel = useMemo(
    () =>
      buildMobileProjectCollectionsModel({
        projects,
        threads,
        pendingTasks,
        environmentId: selectedEnvironmentId,
        projectGroupingMode: listOptions.projectGroupingMode,
        projectSortOrder: listOptions.projectSortOrder,
        document: projectCollections.document ?? DEFAULT_PROJECT_COLLECTIONS_DOCUMENT,
        scope: resolvedProjectCollectionScope,
      }),
    [
      listOptions.projectGroupingMode,
      listOptions.projectSortOrder,
      pendingTasks,
      projectCollections.document,
      projects,
      resolvedProjectCollectionScope,
      selectedEnvironmentId,
      threads,
    ],
  );
  const selectedProjectKey =
    projectCollectionModel.activeScope.kind === "project"
      ? projectCollectionModel.activeScope.projectKey
      : null;
  const projectFilterOptions = useMemo(
    () =>
      projectCollectionModel.projectChoices.map((project) => ({
        key: project.projectKey,
        label: project.label,
      })),
    [projectCollectionModel.projectChoices],
  );
  useEffect(() => {
    if (projectCollections.document === null) return;
    if (
      mobileProjectCollectionScopeKey(requestedProjectCollectionScope) !==
      mobileProjectCollectionScopeKey(projectCollectionModel.activeScope)
    ) {
      setScopeOverride(projectCollectionModel.activeScope);
      if (AsyncResult.isSuccess(preferencesResult)) {
        savePreferences({ projectCollectionScope: projectCollectionModel.activeScope });
      }
    }
  }, [
    preferencesResult,
    projectCollectionModel.activeScope,
    projectCollections.document,
    savePreferences,
    requestedProjectCollectionScope,
  ]);
  const setProjectCollectionScope = useCallback(
    (scope: ProjectCollectionScope) => {
      setScopeOverride(scope);
      savePreferences({ projectCollectionScope: scope });
    },
    [savePreferences],
  );
  const setSelectedProjectKey = useCallback(
    (projectKey: string | null) => {
      setProjectCollectionScope(
        projectKey === null ? { kind: "all" } : { kind: "project", projectKey },
      );
    },
    [setProjectCollectionScope],
  );
  return (
    <AndroidHomeFabLayout onStartNewTask={startNewTask}>
      <>
        <WorkspaceListHeader
          accessibilityLabel="T3 Code, Threads"
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          search={{
            value: searchQuery,
            onChangeText: setSearchQuery,
            placeholder: "Search",
            accessibilityLabel: "Search threads",
          }}
          filter={{
            customized:
              selectedEnvironmentId !== null || projectCollectionModel.activeScope.kind !== "all",
            items: buildHomeListFilterMenuItems({
              environments,
              projects: projectFilterOptions,
              selectedEnvironmentId,
              selectedProjectKey,
              projectCollectionScope: projectCollectionModel.activeScope,
              projectCollectionScopeOptions: projectCollectionModel.scopeOptions,
              projectCollectionsAvailable: projectCollections.document !== null,
              canManageProjectCollections: projectCollections.document !== null,
              onEnvironmentChange: setSelectedEnvironmentId,
              onProjectChange: setSelectedProjectKey,
              onProjectCollectionScopeChange: setProjectCollectionScope,
              onManageProjectCollections: () => setProjectCollectionsOpen(true),
            }),
          }}
          collectionStrip={{
            projectCollectionScope: projectCollectionModel.activeScope,
            projectCollectionScopeOptions: projectCollectionModel.scopeOptions,
            projectCollectionsAvailable: projectCollections.document !== null,
            canManageProjectCollections: projectCollections.document !== null,
            onProjectCollectionScopeChange: setProjectCollectionScope,
            onManageProjectCollections: () => setProjectCollectionsOpen(true),
            onStartNewProject: () => navigation.navigate("AddProject"),
          }}
        />

        <HomeScreen
          catalogState={catalogState}
          environments={environments}
          onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
          onArchiveThread={archiveThread}
          onDeleteThread={confirmDeleteThread}
          onSettleThread={settleThread}
          onSnoozeThread={snoozeThread}
          onUnsnoozeThread={unsnoozeThread}
          onUnsettleThread={unsettleThread}
          onPinThread={pinThread}
          onUnpinThread={unpinThread}
          onSetThreadAutoSettle={setThreadAutoSettle}
          onMoveThread={moveThread}
          onRenameThread={renameThread}
          onRegenerateThreadTitle={regenerateThreadTitle}
          onEnvironmentChange={setSelectedEnvironmentId}
          onProjectChange={setSelectedProjectKey}
          onOpenSettings={() => selectTab("settings")}
          onSearchQueryChange={setSearchQuery}
          onSelectThread={handleSelectThread}
          onSelectPendingTask={openPendingTask}
          onDeletePendingTask={confirmDeletePendingTask}
          onNewThreadOnBranch={handleNewThreadOnBranch}
          onNewThreadInProject={(project) => {
            selectThreadRoute({
              draft: {
                requestId: uuidv4(),
                environmentId: String(project.environmentId),
                projectId: String(project.id),
                title: project.title,
              },
            });
          }}
          onStartNewTask={startNewTask}
          pendingTasks={projectCollectionModel.visiblePendingTasks}
          projectGroupingMode={listOptions.projectGroupingMode}
          projects={projectCollectionModel.visibleProjects}
          projectSortOrder={listOptions.projectSortOrder}
          savedConnectionsById={savedConnectionsById}
          searchQuery={searchQuery}
          selectedEnvironmentId={selectedEnvironmentId}
          selectedProjectKey={selectedProjectKey}
          threads={projectCollectionModel.visibleThreads}
        />
        <Modal
          animationType="slide"
          onRequestClose={() => setProjectCollectionsOpen(false)}
          presentationStyle="pageSheet"
          visible={projectCollectionsOpen && projectCollections.document !== null}
        >
          <ProjectCollectionsSheet
            onClose={() => setProjectCollectionsOpen(false)}
            projects={projectCollectionModel.projects}
            sync={projectCollections}
          />
        </Modal>
        <ThreadUndoNotice visible={visible} />
      </>
    </AndroidHomeFabLayout>
  );
}
