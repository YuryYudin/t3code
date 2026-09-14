import type { ProjectCollectionsView } from "../projects/useProjectCollections";
import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import {
  EnvironmentId,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const runtime = vi.hoisted(() => ({
  navigation: { navigate: vi.fn() },
  savePreferences: vi.fn(),
  preferences: {
    _tag: "Success",
    value: { projectCollectionScope: { kind: "all" as const } },
  } as {
    readonly _tag: "Success";
    readonly value: { projectCollectionScope: ProjectCollectionScope };
  },
  projectCollections: null as ProjectCollectionsView | null,
  projects: [] as ReadonlyArray<Record<string, unknown>>,
  threads: [] as ReadonlyArray<Record<string, unknown>>,
  selectedEnvironmentId: null as EnvironmentId | null,
  usesSplitView: false,
  useProjectCollections: vi.fn(),
}));

vi.mock("react-native", () => ({
  Modal: ({ children, visible }: { readonly children?: unknown; readonly visible: boolean }) =>
    visible ? children : null,
  Platform: { OS: "android" },
  View: "native-view",
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => runtime.navigation }));
vi.mock("@effect/atom-react", () => ({
  useAtomSet: () => runtime.savePreferences,
  useAtomValue: () => runtime.preferences,
}));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: Symbol("mobilePreferencesAtom"),
  updateMobilePreferencesAtom: Symbol("updateMobilePreferencesAtom"),
}));
vi.mock("../../native/StackHeader", () => ({
  NativeHeaderToolbar: {
    Button: "native-header-button",
  },
  NativeStackScreenOptions: "native-stack-screen-options",
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => runtime.projects,
  useThreadShells: () => runtime.threads,
}));
vi.mock("../../state/use-pending-new-tasks", () => ({ usePendingNewTasks: () => [] }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceState: () => ({
    environments: [{ environmentId: ENVIRONMENT_ID, connectionState: "connected" }],
    state: {
      connectionError: null,
      connectionState: "connected",
      hasConnectingEnvironment: false,
      hasConnections: true,
      hasLoadedShellSnapshot: true,
      isLoadingConnections: false,
    },
  }),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnections: () => ({
    savedConnectionsById: {
      [ENVIRONMENT_ID]: {
        environmentId: ENVIRONMENT_ID,
        environmentLabel: "Mac",
      },
    },
  }),
}));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({
    layout: { usesSplitView: runtime.usesSplitView },
    panes: { primarySidebarVisible: false },
  }),
}));
vi.mock("../layout/WorkspaceEmptyDetail", () => ({
  WorkspaceEmptyDetail: "workspace-empty-detail",
}));
vi.mock("../../components/AndroidScreenHeader", () => ({
  AndroidScreenHeader: "android-screen-header",
}));
vi.mock("../updates/app-updates", () => ({
  checkForAppUpdateOnLaunch: vi.fn(),
  startAppUpdateForegroundRecheck: vi.fn(),
}));
vi.mock("./AndroidHomeFab", () => ({
  AndroidHomeFabLayout: ({ children }: { readonly children?: unknown }) => children,
}));
vi.mock("./home-list-options", () => ({
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
vi.mock("./home-thread-navigation", () => ({ useHomeThreadSelection: () => vi.fn() }));
vi.mock("./usePendingTaskListActions", () => ({
  usePendingTaskListActions: () => ({
    openPendingTask: vi.fn(),
    confirmDeletePendingTask: vi.fn(),
  }),
}));
vi.mock("./useThreadListActions", () => ({
  useThreadListActions: () => ({
    archiveThread: vi.fn(),
    confirmDeleteThread: vi.fn(),
    settleThread: vi.fn(),
    snoozeThread: vi.fn(),
    unsnoozeThread: vi.fn(),
    pinThread: vi.fn(),
    unpinThread: vi.fn(),
    moveThread: vi.fn(),
    regenerateThreadTitle: vi.fn(),
    unsettleThread: vi.fn(),
  }),
}));
vi.mock("./WorkspaceConnectionTitle", () => ({
  getConnectionAwareBrandHeaderOptions: () => ({}),
}));
vi.mock("./HomeHeader", async () => {
  const React = await import("react");
  return {
    HomeHeader: (props: Record<string, unknown>) =>
      React.createElement(
        "home-header",
        props,
        React.createElement("native-button", {
          accessibilityLabel: "New project",
          onPress: props.onStartNewProject,
        }),
        React.createElement("native-button", {
          accessibilityLabel: "New task",
          onPress: props.onStartNewTask,
        }),
        props.canManageProjectCollections
          ? React.createElement("native-button", {
              accessibilityLabel: "Manage collections",
              onPress: props.onManageProjectCollections,
            })
          : null,
      ),
  };
});
vi.mock("./HomeScreen", async () => {
  const React = await import("react");
  return {
    HomeScreen: (props: Record<string, unknown>) => React.createElement("home-screen", props),
  };
});
vi.mock("../projects/ProjectCollectionsSheet", async () => {
  const React = await import("react");
  return {
    ProjectCollectionsSheet: (props: Record<string, unknown>) =>
      React.createElement("project-collections-sheet", props),
  };
});
vi.mock("../projects/useProjectCollections", () => ({
  useProjectCollections: () => {
    runtime.useProjectCollections();
    return runtime.projectCollections;
  },
}));

import { HomeRouteScreen } from "./HomeRouteScreen";

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
    locator: {
      source: "git-remote" as const,
      remoteName: "origin",
      remoteUrl: `https://${canonicalKey}.git`,
    },
    rootPath: `/work/${id}`,
    displayName: id,
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt,
});

const PROJECTS = [
  project("work-main", "github.com/acme/work", "2026-09-03T00:00:00.000Z"),
  project("work-checkout", "github.com/acme/work", "2026-09-02T00:00:00.000Z"),
  project("personal", "github.com/acme/personal", "2026-09-01T00:00:00.000Z"),
];
const THREADS = PROJECTS.map((candidate, index) => ({
  environmentId: candidate.environmentId,
  id: `thread-${index}`,
  projectId: candidate.id,
  title: candidate.title,
  branch: "main",
  worktreePath: null,
  archivedAt: null,
  createdAt: candidate.createdAt,
  updatedAt: candidate.updatedAt,
}));

function document(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      {
        id: WORK_ID,
        name: "Work",
        visual: { kind: "lucide", name: "briefcase", color: "blue" },
      },
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

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  runtime.navigation.navigate.mockReset();
  runtime.savePreferences.mockReset();
  runtime.useProjectCollections.mockReset();
  runtime.usesSplitView = false;
  runtime.selectedEnvironmentId = null;
  runtime.projects = PROJECTS;
  runtime.threads = THREADS;
  runtime.preferences = {
    _tag: "Success",
    value: { projectCollectionScope: { kind: "all" } },
  };
  runtime.projectCollections = view();
});

describe("HomeRouteScreen project collections", () => {
  it("keeps New project on AddProject, New task on NewTask, and filters whole families", () => {
    act(() => {
      renderer = create(<HomeRouteScreen />);
    });

    const header = renderer!.root.findByType("home-header" as never);
    expect(
      header.props.projectCollectionScopeOptions.map((option: { label: string }) => option.label),
    ).toEqual(["All projects", "Work", "Unfiled"]);
    act(() => renderer!.root.findByProps({ accessibilityLabel: "New project" }).props.onPress());
    expect(runtime.navigation.navigate).toHaveBeenLastCalledWith("NewTaskSheet", {
      screen: "AddProject",
    });
    act(() => renderer!.root.findByProps({ accessibilityLabel: "New task" }).props.onPress());
    expect(runtime.navigation.navigate).toHaveBeenLastCalledWith("NewTaskSheet", {
      screen: "NewTask",
    });

    act(() =>
      header.props.onProjectCollectionScopeChange({ kind: "collection", collectionId: WORK_ID }),
    );
    expect(runtime.savePreferences).toHaveBeenCalledWith({
      projectCollectionScope: { kind: "collection", collectionId: WORK_ID },
    });
    expect(
      renderer!.root
        .findByType("home-screen" as never)
        .props.projects.map((candidate: { id: string }) => candidate.id),
    ).toEqual(["work-main", "work-checkout"]);

    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: "Manage collections" }).props.onPress(),
    );
    const sheet = renderer!.root.findByType("project-collections-sheet" as never);
    expect(sheet.props.sync).toBe(runtime.projectCollections);
    expect(sheet.props.projects).toEqual([
      { projectKey: WORK_KEY, label: "work-main", workspaceCount: 2 },
      { projectKey: PERSONAL_KEY, label: "personal", workspaceCount: 1 },
    ]);
  });

  it("keeps New project reachable but hides collection mutation controls for old-only state", () => {
    runtime.projectCollections = view({
      document: null,
      confirmedDocument: null,
      referenceEnvironmentId: null,
      referenceLabel: null,
      eligibleEnvironmentIds: [],
      canMutate: false,
    });
    act(() => {
      renderer = create(<HomeRouteScreen />);
    });

    expect(renderer!.root.findAllByProps({ accessibilityLabel: "Manage collections" })).toEqual([]);
    expect(renderer!.root.findAllByType("project-collections-sheet" as never)).toEqual([]);
    act(() => renderer!.root.findByProps({ accessibilityLabel: "New project" }).props.onPress());
    expect(runtime.navigation.navigate).toHaveBeenCalledWith("NewTaskSheet", {
      screen: "AddProject",
    });
  });

  it("preserves a stored collection scope while the authoritative document loads", () => {
    runtime.preferences = {
      _tag: "Success",
      value: { projectCollectionScope: { kind: "collection", collectionId: WORK_ID } },
    };
    runtime.projectCollections = view({
      document: null,
      confirmedDocument: null,
      referenceEnvironmentId: null,
      referenceLabel: null,
      eligibleEnvironmentIds: [],
      canMutate: false,
    });
    act(() => {
      renderer = create(<HomeRouteScreen />);
    });

    expect(runtime.savePreferences).not.toHaveBeenCalled();

    runtime.projectCollections = view();
    act(() => renderer!.update(<HomeRouteScreen />));

    expect(runtime.savePreferences).not.toHaveBeenCalled();
    expect(renderer!.root.findByType("home-header" as never).props.projectCollectionScope).toEqual({
      kind: "collection",
      collectionId: WORK_ID,
    });
    expect(
      renderer!.root
        .findByType("home-screen" as never)
        .props.projects.map((candidate: { id: string }) => candidate.id),
    ).toEqual(["work-main", "work-checkout"]);
  });

  it("combines an environment with collection and project scopes without hiding global organizer rows", () => {
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
        branch: "main",
        worktreePath: null,
        archivedAt: null,
        createdAt: remoteProject.createdAt,
        updatedAt: remoteProject.updatedAt,
      },
    ];
    runtime.selectedEnvironmentId = ENVIRONMENT_ID;
    runtime.preferences = {
      _tag: "Success",
      value: { projectCollectionScope: { kind: "collection", collectionId: WORK_ID } },
    };

    act(() => {
      renderer = create(<HomeRouteScreen />);
    });

    const header = renderer!.root.findByType("home-header" as never);
    expect(header.props.projects.map((choice: { label: string }) => choice.label)).toEqual([
      "work-main",
      "personal",
    ]);
    expect(
      renderer!.root
        .findByType("home-screen" as never)
        .props.projects.map((candidate: { id: string }) => candidate.id),
    ).toEqual(["work-main", "work-checkout"]);

    act(() => header.props.onProjectChange(PERSONAL_KEY));
    expect(
      renderer!.root
        .findByType("home-screen" as never)
        .props.projects.map((candidate: { id: string }) => candidate.id),
    ).toEqual(["personal"]);

    act(() =>
      renderer!.root.findByProps({ accessibilityLabel: "Manage collections" }).props.onPress(),
    );
    expect(renderer!.root.findByType("project-collections-sheet" as never).props.projects).toEqual([
      { projectKey: REMOTE_KEY, label: "remote", workspaceCount: 1 },
      { projectKey: WORK_KEY, label: "work-main", workspaceCount: 2 },
      { projectKey: PERSONAL_KEY, label: "personal", workspaceCount: 1 },
    ]);
  });

  it("does not mount the compact collection controller in split view", () => {
    runtime.usesSplitView = true;
    act(() => {
      renderer = create(<HomeRouteScreen />);
    });

    expect(runtime.useProjectCollections).not.toHaveBeenCalled();
    act(() => renderer!.root.findByType("workspace-empty-detail" as never).props.onStartNewTask());
    expect(runtime.navigation.navigate).toHaveBeenCalledWith("NewTaskSheet", {
      screen: "NewTask",
    });
  });
});
