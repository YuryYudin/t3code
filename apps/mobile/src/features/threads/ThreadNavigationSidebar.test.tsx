import type { ProjectCollectionsView } from "../projects/useProjectCollections";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectId,
  ThreadId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const runtime = vi.hoisted(() => ({
  projectCollections: null as ProjectCollectionsView | null,
  projects: [] as ReadonlyArray<Record<string, unknown>>,
  threads: [] as ReadonlyArray<Record<string, unknown>>,
  pendingTasks: [] as ReadonlyArray<Record<string, unknown>>,
  threadListV2Enabled: false,
  confirmDeletePendingTask: vi.fn(),
  openPendingTask: vi.fn(),
  selectedEnvironmentId: null as EnvironmentId | null,
  savePreferences: vi.fn(),
  projectCollectionScope: { kind: "all" as const } as
    | { readonly kind: "all" }
    | { readonly kind: "unfiled" }
    | { readonly kind: "collection"; readonly collectionId: ProjectCollectionId },
}));
const atoms = vi.hoisted(() => ({
  preferences: Symbol("preferences"),
  serverConfigs: Symbol("serverConfigs"),
}));

vi.mock("react-native", () => ({
  Modal: ({ children, visible }: { readonly children?: unknown; readonly visible: boolean }) =>
    visible ? children : null,
  Platform: { OS: "android" },
  Pressable: "native-pressable",
  StyleSheet: { hairlineWidth: 1, create: (styles: unknown) => styles },
  TextInput: "native-text-input",
  View: "native-view",
  useWindowDimensions: () => ({ width: 820, height: 1180, fontScale: 1, scale: 2 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("react-native-gesture-handler", () => ({
  Gesture: { Native: () => ({}) },
  GestureDetector: ({ children }: { readonly children?: ReactNode }) => children,
}));
vi.mock("@legendapp/list/react-native", async () => {
  const React = await import("react");
  return {
    LegendList: (props: Record<string, unknown>) => React.createElement("legend-list", props),
  };
});
vi.mock("@effect/atom-react", () => ({
  useAtomSet: () => runtime.savePreferences,
  useAtomValue: (atom: symbol) =>
    atom === atoms.preferences
      ? { _tag: "Success", value: { projectCollectionScope: runtime.projectCollectionScope } }
      : new Map(),
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: atoms.preferences,
  updateMobilePreferencesAtom: Symbol("updateMobilePreferencesAtom"),
}));
vi.mock("../../state/server", () => ({ environmentServerConfigsAtom: atoms.serverConfigs }));
vi.mock("../../state/entities", () => ({
  useProjects: () => runtime.projects,
  useThreadShells: () => runtime.threads,
}));
vi.mock("../../state/queries", () => ({
  useThreadSearch: () => ({ matches: [], isPending: false }),
}));
vi.mock("../../state/thread-order", () => ({ usePendingThreadOrder: () => null }));
vi.mock("../../state/use-pending-new-tasks", () => ({
  usePendingNewTasks: () => runtime.pendingTasks,
}));
vi.mock("../../state/use-thread-outbox", () => ({ useQueuedThreadKeys: () => new Set() }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceState: () => ({
    environments: [{ environmentId: ENVIRONMENT_ID, connectionState: "connected" }],
    state: { isLoadingConnections: false },
  }),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnections: () => ({
    savedConnectionsById: {
      [ENVIRONMENT_ID]: { environmentId: ENVIRONMENT_ID, environmentLabel: "Mac" },
    },
  }),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({
    appearance: { baseFontSize: 16 },
    materialYouStyleLayoutActive: false,
    themeVariables: { "--color-screen": "black", "--color-foreground-muted": "gray" },
  }),
}));
vi.mock("../home/home-list-options", () => ({
  hasCustomHomeListOptions: () => false,
  PROJECT_SORT_OPTIONS: [],
  THREAD_SORT_OPTIONS: [],
  useHomeListOptions: () => ({
    options: {
      selectedEnvironmentId: runtime.selectedEnvironmentId,
      projectGroupingMode: "repository",
      projectSortOrder: "updated_at",
      threadSortOrder: "updated_at",
    },
    setSelectedEnvironmentId: vi.fn(),
    setProjectSortOrder: vi.fn(),
    setThreadSortOrder: vi.fn(),
  }),
}));
vi.mock("./use-thread-list-v2-enabled", () => ({
  useThreadListV2Enabled: () => runtime.threadListV2Enabled,
}));
vi.mock("./use-thread-list-v2-shelf-preferences", () => ({
  useThreadListV2ShelfPreferences: () => ({
    loaded: true,
    settledShelfExpanded: false,
    snoozedShelfExpanded: false,
    toggleSettledShelf: vi.fn(),
    toggleSnoozedShelf: vi.fn(),
  }),
}));
vi.mock("../home/usePendingTaskListActions", () => ({
  usePendingTaskListActions: () => ({
    openPendingTask: runtime.openPendingTask,
    confirmDeletePendingTask: runtime.confirmDeletePendingTask,
  }),
}));
vi.mock("../home/useThreadListActions", () => ({
  useThreadListActions: () => ({
    archiveThread: vi.fn(),
    confirmDeleteThread: vi.fn(),
    settleThread: vi.fn(),
    snoozeThread: vi.fn(),
    unsnoozeThread: vi.fn(),
    unsettleThread: vi.fn(),
    pinThread: vi.fn(),
    unpinThread: vi.fn(),
    moveThread: vi.fn(),
    regenerateThreadTitle: vi.fn(),
  }),
}));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({
  useHardwareKeyboardCommand: vi.fn(),
}));
vi.mock("../home/thread-swipe-actions", () => ({
  SwipeableScrollGateProvider: ({ children }: { readonly children?: unknown }) => children,
  useSwipeableScrollGate: () => ({ swipeEnabled: true, scrollGateHandlers: {} }),
}));
vi.mock("../../components/ControlPill", async () => {
  const React = await import("react");
  return {
    ControlPillMenu: (props: Record<string, unknown>) =>
      React.createElement("control-pill-menu", props, props.children as ReactNode),
  };
});
vi.mock("../../components/AppText", () => ({ AppText: "native-text" }));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "native-symbol" }));
vi.mock("../../components/CompactBrandTitle", () => ({ CompactBrandTitle: "compact-brand" }));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: "stack-options" }));
vi.mock("../home/WorkspaceConnectionTitle", () => ({
  WorkspaceConnectionTitle: "workspace-connection-title",
  getConnectionAwareBrandHeaderOptions: () => ({}),
}));
// Upstream routes the whole Android chrome through this toolbar, which pulls in
// native-only modules; stub it so the sidebar's own menu stays under test.
vi.mock("../home/MaterialThreadListToolbar", async () => {
  const React = await import("react");
  return {
    MaterialThreadListToolbar: (props: Record<string, unknown>) =>
      React.createElement("material-thread-list-toolbar", props),
  };
});
vi.mock("./sidebar-header-actions", () => ({ SidebarHeaderActions: "sidebar-header-actions" }));
vi.mock("./sidebar-filter-button", () => ({ SidebarFilterButton: "sidebar-filter-button" }));
vi.mock("./sidebar-navigation-shell", () => ({
  SidebarNavigationShell: ({ children }: { readonly children?: unknown }) => children,
}));
vi.mock("./thread-list-items", () => ({
  PendingTaskListRow: "pending-row",
  ThreadListGroupHeader: "group-header",
  ThreadListRow: "thread-row",
  ThreadListShowMoreRow: "show-more-row",
}));
vi.mock("./thread-list-v2-items", () => ({
  ThreadListV2PendingRow: "v2-pending-row",
  ThreadListV2Row: "v2-row",
  ThreadListV2SettledShelfHeader: "v2-settled",
  ThreadListV2SnoozedShelfHeader: "v2-snoozed",
}));
vi.mock("../projects/ProjectCollectionsSheet", async () => {
  const React = await import("react");
  return {
    ProjectCollectionsSheet: (props: Record<string, unknown>) =>
      React.createElement("project-collections-sheet", props),
  };
});
vi.mock("../projects/useProjectCollections", () => ({
  useProjectCollections: () => runtime.projectCollections,
}));

import { ThreadNavigationSidebar } from "./ThreadNavigationSidebar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ENVIRONMENT_ID = EnvironmentId.make("mac");
const STUDIO_ENVIRONMENT_ID = EnvironmentId.make("studio");
const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const WORK_KEY = ProjectCollectionProjectKey.make("repository:github.com/acme/work");
const PERSONAL_KEY = ProjectCollectionProjectKey.make("repository:github.com/acme/personal");
const REMOTE_KEY = ProjectCollectionProjectKey.make("repository:github.com/acme/remote");
const project = (
  id: string,
  canonicalKey: string,
  updatedAt: string,
  environmentId = ENVIRONMENT_ID,
) => ({
  environmentId,
  id: ProjectId.make(id),
  title: id,
  workspaceRoot: `/work/${id}`,
  repositoryIdentity: {
    canonicalKey,
    locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl: canonicalKey },
    rootPath: `/work/${id}`,
    displayName: id,
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
});
const PROJECTS = [
  project("work", "github.com/acme/work", "2026-09-03T00:00:00.000Z"),
  project("personal", "github.com/acme/personal", "2026-09-01T00:00:00.000Z"),
];
const THREADS = PROJECTS.map((candidate, index) => ({
  environmentId: ENVIRONMENT_ID,
  id: `thread-${index}`,
  projectId: candidate.id,
  title: candidate.title,
  archivedAt: null,
  createdAt: candidate.createdAt,
  updatedAt: candidate.updatedAt,
}));

function document(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      { id: WORK_ID, name: "Work", visual: { kind: "lucide", name: "briefcase", color: "blue" } },
    ],
    assignments: [{ projectKey: WORK_KEY, collectionId: WORK_ID }],
  };
}

function view(overrides: Partial<ProjectCollectionsView> = {}): ProjectCollectionsView {
  const source = document();
  return {
    document: source,
    confirmedDocument: source,
    optimisticDocument: null,
    rejectedCandidate: null,
    phase: "idle",
    status: { phase: "idle", savedCount: 1, eligibleCount: 1, message: null },
    referenceEnvironmentId: ENVIRONMENT_ID,
    referenceLabel: "Mac",
    eligibleEnvironmentIds: [ENVIRONMENT_ID],
    mismatchEnvironmentIds: [],
    canMutate: true,
    save: vi.fn((candidate) => ({ ok: true as const, value: candidate })),
    retry: vi.fn(),
    useThisLayoutEverywhere: vi.fn(),
    ...overrides,
  };
}

const props = {
  width: 360,
  visible: true,
  selectedThreadKey: null,
  onOpenSettings: vi.fn(),
  onOpenEnvironmentSettings: vi.fn(),
  onNewThreadOnBranch: vi.fn(),
  onNewThreadInProject: vi.fn(),
  onSearchQueryChange: vi.fn(),
  onSelectThread: vi.fn(),
  onRequestVisibility: vi.fn(),
  onStartNewProject: vi.fn(),
  searchQuery: "",
};

let renderer: ReactTestRenderer | undefined;

// Android routes the list filter menu through the Material toolbar; every other
// platform keeps it on the control pill. Both carry the same action list.
function filterMenu(): { readonly props: ReactTestInstance["props"] } {
  const toolbar = renderer!.root.findAllByType("material-thread-list-toolbar" as never)[0];
  if (toolbar !== undefined) {
    return {
      props: { actions: toolbar.props.filterActions, onPressAction: toolbar.props.onFilterAction },
    };
  }
  return renderer!.root.findByType("control-pill-menu" as never);
}

beforeEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  runtime.savePreferences.mockReset();
  runtime.projectCollectionScope = { kind: "all" };
  runtime.selectedEnvironmentId = null;
  runtime.projects = PROJECTS;
  runtime.threads = THREADS;
  runtime.pendingTasks = [];
  runtime.threadListV2Enabled = false;
  runtime.confirmDeletePendingTask.mockReset();
  runtime.openPendingTask.mockReset();
  props.onStartNewProject.mockReset();
  runtime.projectCollections = view();
});

describe("ThreadNavigationSidebar project collections", () => {
  it("persists collection scope, filters the flat tablet list, and composes the organizer", () => {
    act(() => {
      renderer = create(<ThreadNavigationSidebar {...props} />);
    });
    const menu = filterMenu();
    const collectionMenu = menu.props.actions.find(
      (action: { id: string }) => action.id === "collection-scope",
    );
    expect(collectionMenu.subactions.map((action: { title: string }) => action.title)).toEqual([
      "All projects (2)",
      "Work (1)",
      "Unfiled (1)",
    ]);

    act(() =>
      menu.props.onPressAction({
        nativeEvent: { event: `collection-scope:collection:${WORK_ID}` },
      }),
    );
    expect(runtime.savePreferences).toHaveBeenCalledWith({
      projectCollectionScope: { kind: "collection", collectionId: WORK_ID },
    });
    const listTypes = renderer!.root
      .findByType("legend-list" as never)
      .props.data.filter((item: { type: string }) => item.type === "header")
      .map((item: { group: { title: string } }) => item.group.title);
    expect(listTypes).toEqual(["work"]);

    act(() => menu.props.onPressAction({ nativeEvent: { event: "add:project" } }));
    expect(props.onStartNewProject).toHaveBeenCalledOnce();
    act(() => menu.props.onPressAction({ nativeEvent: { event: "add:manage" } }));
    expect(renderer!.root.findByType("project-collections-sheet" as never).props.projects).toEqual([
      { projectKey: WORK_KEY, label: "work", workspaceCount: 1 },
      { projectKey: PERSONAL_KEY, label: "personal", workspaceCount: 1 },
    ]);
  });

  it("keeps New project but removes collection mutation actions for old-only state", () => {
    runtime.projectCollections = view({
      document: null,
      confirmedDocument: null,
      referenceEnvironmentId: null,
      referenceLabel: null,
      eligibleEnvironmentIds: [],
      canMutate: false,
    });
    act(() => {
      renderer = create(<ThreadNavigationSidebar {...props} />);
    });
    const actions = filterMenu().props.actions;
    expect(actions.some((action: { id: string }) => action.id === "collection-scope")).toBe(false);
    expect(actions.filter((action: { id: string }) => action.id.startsWith("add:"))).toEqual([
      { id: "add:project", title: "New project" },
    ]);
    expect(renderer!.root.findAllByType("project-collections-sheet" as never)).toEqual([]);
  });

  it("preserves a stored collection scope while the authoritative document loads", () => {
    runtime.projectCollectionScope = { kind: "collection", collectionId: WORK_ID };
    runtime.projectCollections = view({
      document: null,
      confirmedDocument: null,
      referenceEnvironmentId: null,
      referenceLabel: null,
      eligibleEnvironmentIds: [],
      canMutate: false,
    });
    act(() => {
      renderer = create(<ThreadNavigationSidebar {...props} />);
    });

    expect(runtime.savePreferences).not.toHaveBeenCalled();

    runtime.projectCollections = view();
    act(() => renderer!.update(<ThreadNavigationSidebar {...props} />));

    expect(runtime.savePreferences).not.toHaveBeenCalled();
    const actions = filterMenu().props.actions;
    const collectionMenu = actions.find(
      (action: { id: string }) => action.id === "collection-scope",
    );
    expect(
      collectionMenu.subactions.find(
        (action: { id: string }) => action.id === `collection-scope:collection:${WORK_ID}`,
      ).state,
    ).toBe("on");
    expect(
      renderer!.root
        .findByType("legend-list" as never)
        .props.data.filter((item: { type: string }) => item.type === "header")
        .map((item: { group: { title: string } }) => item.group.title),
    ).toEqual(["work"]);
  });

  it("combines an environment with collection and project filters while keeping organizer rows global", () => {
    const remoteProject = project(
      "remote",
      "github.com/acme/remote",
      "2026-09-04T00:00:00.000Z",
      STUDIO_ENVIRONMENT_ID,
    );
    runtime.projects = [...PROJECTS, remoteProject];
    runtime.threads = [
      ...THREADS,
      {
        environmentId: remoteProject.environmentId,
        id: "thread-remote",
        projectId: remoteProject.id,
        title: remoteProject.title,
        archivedAt: null,
        createdAt: remoteProject.createdAt,
        updatedAt: remoteProject.updatedAt,
      },
    ];
    runtime.selectedEnvironmentId = ENVIRONMENT_ID;
    runtime.projectCollectionScope = { kind: "collection", collectionId: WORK_ID };

    act(() => {
      renderer = create(<ThreadNavigationSidebar {...props} />);
    });

    const menu = filterMenu();
    const projectMenu = menu.props.actions.find(
      (action: { id: string }) => action.id === "project",
    );
    expect(projectMenu.subactions.map((action: { title: string }) => action.title)).toEqual([
      "All projects",
      "work",
      "personal",
    ]);
    expect(
      renderer!.root
        .findByType("legend-list" as never)
        .props.data.filter((item: { type: string }) => item.type === "header")
        .map((item: { group: { title: string } }) => item.group.title),
    ).toEqual(["work"]);

    act(() => menu.props.onPressAction({ nativeEvent: { event: `project:${PERSONAL_KEY}` } }));
    expect(runtime.savePreferences).toHaveBeenLastCalledWith({
      projectCollectionScope: { kind: "project", projectKey: PERSONAL_KEY },
    });
    expect(
      renderer!.root
        .findByType("legend-list" as never)
        .props.data.filter((item: { type: string }) => item.type === "header")
        .map((item: { group: { title: string } }) => item.group.title),
    ).toEqual(["personal"]);

    act(() => menu.props.onPressAction({ nativeEvent: { event: "add:manage" } }));
    expect(renderer!.root.findByType("project-collections-sheet" as never).props.projects).toEqual([
      { projectKey: REMOTE_KEY, label: "remote", workspaceCount: 1 },
      { projectKey: WORK_KEY, label: "work", workspaceCount: 1 },
      { projectKey: PERSONAL_KEY, label: "personal", workspaceCount: 1 },
    ]);
  });

  it("keeps an unknown offline queued task visible and deletable in v2 Unfiled", () => {
    const projectId = ProjectId.make("offline-unknown");
    const creation = {
      projectId,
      workspaceMode: "worktree" as const,
      branch: null,
      worktreePath: null,
    };
    const unknownPendingTask = {
      kind: "pending",
      key: "pending-task:offline-unknown",
      environmentId: ENVIRONMENT_ID,
      projectId,
      projectTitle: undefined,
      projectCwd: undefined,
      branch: null,
      title: "Offline unknown task",
      createdAt: "2026-09-04T00:00:00.000Z",
      message: {
        environmentId: ENVIRONMENT_ID,
        threadId: ThreadId.make("thread-offline-unknown"),
        messageId: MessageId.make("offline-unknown"),
        commandId: CommandId.make("command-offline-unknown"),
        text: "Offline unknown task",
        attachments: [],
        createdAt: "2026-09-04T00:00:00.000Z",
        creation,
      },
      creation,
    };
    runtime.pendingTasks = [unknownPendingTask];
    runtime.threadListV2Enabled = true;
    runtime.projectCollectionScope = { kind: "unfiled" };

    act(() => {
      renderer = create(<ThreadNavigationSidebar {...props} />);
    });

    const list = renderer!.root.findByType("legend-list" as never);
    const pendingItem = list.props.data.find(
      (item: { type: string }) => item.type === "v2-pending",
    );
    expect(pendingItem?.pendingTask).toBe(unknownPendingTask);

    const pendingRow = list.props.renderItem({ item: pendingItem });
    act(() => pendingRow.props.onDeletePendingTask(unknownPendingTask));
    expect(runtime.confirmDeletePendingTask).toHaveBeenCalledWith(unknownPendingTask);
  });
});
