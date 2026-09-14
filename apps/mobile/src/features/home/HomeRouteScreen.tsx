import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { DEFAULT_PROJECT_COLLECTIONS_DOCUMENT } from "@t3tools/contracts";
import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Platform, useWindowDimensions } from "react-native";

import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import { useProjects, useThreadShells } from "../../state/entities";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { WorkspaceEmptyDetail } from "../layout/WorkspaceEmptyDetail";
import { WorkspaceSidebarToolbar } from "../layout/workspace-sidebar-toolbar";
import { checkForAppUpdateOnLaunch, startAppUpdateForegroundRecheck } from "../updates/app-updates";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen } from "./HomeScreen";
import { HomeHeader } from "./HomeHeader";
import { useHomeListOptions } from "./home-list-options";
import { useHomeThreadSelection } from "./home-thread-navigation";
import {
  buildMobileProjectCollectionsModel,
  mobileProjectCollectionScopeKey,
} from "./mobileProjectCollections";
import { ProjectCollectionsSheet } from "../projects/ProjectCollectionsSheet";
import { useProjectCollections } from "../projects/useProjectCollections";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { getConnectionAwareBrandHeaderOptions } from "./WorkspaceConnectionTitle";

/* ─── Route screen ───────────────────────────────────────────────────── */

export function HomeRouteScreen() {
  const { layout } = useAdaptiveWorkspaceLayout();
  return layout.usesSplitView ? <SplitHomeRouteScreen /> : <CompactHomeRouteScreen />;
}

function SplitHomeRouteScreen() {
  const navigation = useNavigation();

  return (
    <>
      <NativeStackScreenOptions
        options={
          Platform.OS === "android"
            ? { headerShown: false }
            : { title: "", headerTitle: "", unstable_headerLeftItems: () => [] }
        }
      />
      <WorkspaceSidebarToolbar
        afterSidebarButton={
          <NativeHeaderToolbar.Button
            accessibilityLabel="New task"
            icon="square.and.pencil"
            onPress={() => navigation.navigate("NewTaskSheet", { screen: "NewTask" })}
          />
        }
      />
      <WorkspaceEmptyDetail
        onStartNewTask={() => navigation.navigate("NewTaskSheet", { screen: "NewTask" })}
      />
    </>
  );
}

function CompactHomeRouteScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState("");
  const [projectCollectionsOpen, setProjectCollectionsOpen] = useState(false);
  const [scopeOverride, setScopeOverride] = useState<ProjectCollectionScope | null>(null);
  const handleSelectThread = useHomeThreadSelection();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const projectCollections = useProjectCollections();

  useEffect(() => {
    void checkForAppUpdateOnLaunch();
    startAppUpdateForegroundRecheck();
  }, []);

  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    moveThread,
    renameThread,
    regenerateThreadTitle,
    unsettleThread,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const { openPendingTask, confirmDeletePendingTask } = usePendingTaskListActions();
  const environments = useMemo(() => {
    const connectionStateByEnvironmentId = new Map(
      workspaceEnvironments.map(
        (environment) => [environment.environmentId, environment.connectionState] as const,
      ),
    );
    return Arr.sort(
      Object.values(savedConnectionsById).map((connection) => ({
        environmentId: connection.environmentId,
        label: connection.environmentLabel,
        connectionState:
          connectionStateByEnvironmentId.get(connection.environmentId) ?? "available",
      })),
      Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
    );
  }, [savedConnectionsById, workspaceEnvironments]);
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const {
    options: listOptions,
    setSelectedEnvironmentId,
    setProjectSortOrder,
    setThreadSortOrder,
  } = useHomeListOptions(availableEnvironmentIds);
  const selectedEnvironmentId = listOptions.selectedEnvironmentId;
  const storedProjectCollectionScope = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.projectCollectionScope ?? ({ kind: "all" } as const))
    : ({ kind: "all" } as const);
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
        scope: scopeOverride ?? storedProjectCollectionScope,
      }),
    [
      listOptions.projectGroupingMode,
      listOptions.projectSortOrder,
      pendingTasks,
      projectCollections.document,
      projects,
      scopeOverride,
      selectedEnvironmentId,
      storedProjectCollectionScope,
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
    const requested = scopeOverride ?? storedProjectCollectionScope;
    if (
      mobileProjectCollectionScopeKey(requested) !==
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
    scopeOverride,
    storedProjectCollectionScope,
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
    <AndroidHomeFabLayout
      onStartNewTask={() => navigation.navigate("NewTaskSheet", { screen: "NewTask" })}
    >
      <>
        {/* Restore the header after leaving split view; screen options are
            shallow-merged. The brand slot also doubles as the connection
            status surface while an environment reconnects. */}
        <NativeStackScreenOptions
          optionsVersion={windowWidth}
          options={{
            ...getConnectionAwareBrandHeaderOptions({
              headerWidth: windowWidth,
              onOpenEnvironments: () =>
                navigation.navigate("SettingsSheet", {
                  screen: "SettingsContent",
                  params: { screen: "SettingsEnvironments" },
                }),
            }),
            headerShown: true,
          }}
        />
        <HomeHeader
          environments={environments}
          projects={projectFilterOptions}
          searchQuery={searchQuery}
          selectedEnvironmentId={selectedEnvironmentId}
          selectedProjectKey={selectedProjectKey}
          projectCollectionScope={projectCollectionModel.activeScope}
          projectCollectionScopeOptions={projectCollectionModel.scopeOptions}
          projectCollectionsAvailable={projectCollections.document !== null}
          canManageProjectCollections={projectCollections.document !== null}
          projectSortOrder={listOptions.projectSortOrder}
          threadSortOrder={listOptions.threadSortOrder}
          onEnvironmentChange={setSelectedEnvironmentId}
          onProjectChange={setSelectedProjectKey}
          onProjectCollectionScopeChange={setProjectCollectionScope}
          onManageProjectCollections={() => setProjectCollectionsOpen(true)}
          onOpenEnvironments={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsEnvironments" },
            })
          }
          onOpenSettings={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "Settings" },
            })
          }
          onProjectSortOrderChange={setProjectSortOrder}
          onSearchQueryChange={setSearchQuery}
          onStartNewTask={() => navigation.navigate("NewTaskSheet", { screen: "NewTask" })}
          onStartNewProject={() => navigation.navigate("NewTaskSheet", { screen: "AddProject" })}
          onThreadSortOrderChange={setThreadSortOrder}
        />

        <HomeScreen
          catalogState={catalogState}
          environments={environments}
          onAddConnection={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsEnvironmentNew" },
            })
          }
          onArchiveThread={archiveThread}
          onDeleteThread={confirmDeleteThread}
          onSettleThread={settleThread}
          onSnoozeThread={snoozeThread}
          onUnsnoozeThread={unsnoozeThread}
          onUnsettleThread={unsettleThread}
          onPinThread={pinThread}
          onUnpinThread={unpinThread}
          onMoveThread={moveThread}
          onRenameThread={renameThread}
          onRegenerateThreadTitle={regenerateThreadTitle}
          onEnvironmentChange={setSelectedEnvironmentId}
          onProjectChange={setSelectedProjectKey}
          onOpenSettings={() =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "Settings" },
            })
          }
          onProjectSortOrderChange={setProjectSortOrder}
          onSearchQueryChange={setSearchQuery}
          onSelectThread={handleSelectThread}
          onSelectPendingTask={openPendingTask}
          onDeletePendingTask={confirmDeletePendingTask}
          onNewThreadOnBranch={(thread) => {
            navigation.navigate("NewTaskSheet", {
              screen: "NewTaskDraft",
              params: {
                environmentId: String(thread.environmentId),
                projectId: String(thread.projectId),
                branch: thread.branch,
                worktreePath: thread.worktreePath,
              },
            });
          }}
          onNewThreadInProject={(project) => {
            navigation.navigate("NewTaskSheet", {
              screen: "NewTaskDraft",
              params: {
                environmentId: String(project.environmentId),
                projectId: String(project.id),
                title: project.title,
              },
            });
          }}
          onStartNewTask={() => navigation.navigate("NewTaskSheet", { screen: "NewTask" })}
          onThreadSortOrderChange={setThreadSortOrder}
          pendingTasks={projectCollectionModel.visiblePendingTasks}
          projectGroupingMode={listOptions.projectGroupingMode}
          projects={projectCollectionModel.visibleProjects}
          projectSortOrder={listOptions.projectSortOrder}
          savedConnectionsById={savedConnectionsById}
          searchQuery={searchQuery}
          selectedEnvironmentId={selectedEnvironmentId}
          selectedProjectKey={selectedProjectKey}
          threads={projectCollectionModel.visibleThreads}
          threadSortOrder={listOptions.threadSortOrder}
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
      </>
    </AndroidHomeFabLayout>
  );
}
