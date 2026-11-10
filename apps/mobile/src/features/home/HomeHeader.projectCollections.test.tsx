import { ProjectCollectionId, ProjectCollectionProjectKey } from "@t3tools/contracts";
import type { ProjectCollectionScopeOption } from "@t3tools/client-runtime/state/project-collections";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: { dismiss: vi.fn(), isVisible: () => false },
  Platform: { OS: "android" },
  Pressable: "native-pressable",
  ScrollView: "native-scroll-view",
  Text: "native-text",
  View: "native-view",
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { appVariant: "development" } } },
}));
vi.mock("@react-navigation/elements", async () => {
  const React = await import("react");
  return { HeaderHeightContext: React.createContext(0) };
});
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ getState: () => null }),
  useNavigationState: () => true,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 12, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("../../components/ui/Menu", async () => {
  const React = await import("react");
  return {
    Menu: (props: Record<string, unknown>) =>
      React.createElement("control-pill-menu", props, props.children as ReactNode),
  };
});
vi.mock("../../components/ui/AppBar", async () => {
  const React = await import("react");
  return {
    AppBar: (props: Record<string, unknown>) => React.createElement("workspace-app-bar", props),
  };
});
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: "native-symbol" }));
vi.mock("../../components/ProjectCollectionIcon", () => ({
  ProjectCollectionIcon: "project-collection-icon",
}));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({ useHardwareKeyboardCommand: vi.fn() }));
vi.mock("../../state/workspace", () => ({
  useWorkspaceConnectionState: () => ({ hasConnections: true }),
}));
vi.mock("../layout/workspace/WorkspaceBrandTitle", () => ({
  WorkspaceBrandTitle: "workspace-brand-title",
}));
vi.mock("../layout/workspace/WorkspaceTabsContext", () => ({
  useWorkspaceTabs: () => null,
}));
vi.mock("../layout/workspace/brand-header-options", () => ({
  getConnectionAwareBrandHeaderOptions: () => ({}),
}));
vi.mock("../../native/StackHeader", () => ({ NativeStackScreenOptions: "native-header-options" }));
vi.mock("../layout/workspace/workspace-list-header-items", () => ({
  createWorkspaceListHeaderItems: () => [],
}));

import { ProjectCollectionScopeStrip } from "./ProjectCollectionScopeStrip";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";
import { WorkspaceListHeader as AndroidWorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader.android";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PROJECT_KEY = ProjectCollectionProjectKey.make("repository:github.com/acme/work");
const scopeOptions: ProjectCollectionScopeOption[] = [
  { scope: { kind: "all" }, label: "All projects", count: 2, collection: null },
  {
    scope: { kind: "collection", collectionId: WORK_ID },
    label: "Work",
    count: 1,
    collection: {
      id: WORK_ID,
      name: "Work",
      visual: { kind: "lucide", name: "briefcase", color: "blue" },
    },
  },
  { scope: { kind: "unfiled" }, label: "Unfiled", count: 1, collection: null },
];

const callbacks = {
  onProjectCollectionScopeChange: vi.fn(),
  onManageProjectCollections: vi.fn(),
  onStartNewProject: vi.fn(),
};
const collectionStrip = {
  projectCollectionScope: { kind: "all" as const },
  projectCollectionScopeOptions: scopeOptions,
  projectCollectionsAvailable: true,
  canManageProjectCollections: true,
  ...callbacks,
};
const headerProps = {
  accessibilityLabel: "T3 Code, Threads",
  onOpenEnvironments: vi.fn(),
  search: {
    value: "",
    onChangeText: vi.fn(),
    placeholder: "Search",
    accessibilityLabel: "Search threads",
  },
  filter: { customized: false, items: [] },
  collectionStrip,
};

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  for (const callback of Object.values(callbacks)) callback.mockReset();
});
describe("workspace list header project collections", () => {
  it("renders styled collection scopes and a distinct add menu", () => {
    act(() => {
      renderer = create(<ProjectCollectionScopeStrip {...collectionStrip} />);
    });

    const workScope = renderer!.root.findByProps({ accessibilityLabel: "Show Work" });
    expect(workScope.findByType("project-collection-icon" as never).props.visual).toEqual(
      scopeOptions[1]!.collection!.visual,
    );
    act(() => workScope.props.onPress());
    expect(callbacks.onProjectCollectionScopeChange).toHaveBeenCalledWith(scopeOptions[1]!.scope);

    const addMenu = renderer!.root.findByType("control-pill-menu" as never);
    act(() => addMenu.props.onPressAction({ nativeEvent: { event: "add:project" } }));
    act(() => addMenu.props.onPressAction({ nativeEvent: { event: "add:manage" } }));
    expect(callbacks.onStartNewProject).toHaveBeenCalledOnce();
    expect(callbacks.onManageProjectCollections).toHaveBeenCalledOnce();
  });

  it("renders the collection scope strip below the Android app bar", () => {
    act(() => {
      renderer = create(<AndroidWorkspaceListHeader {...headerProps} />);
    });

    const tree = renderer!.toJSON();
    const topLevelNodes = Array.isArray(tree) ? tree : [tree];
    const barIndex = topLevelNodes.findIndex((node) => node?.type === "workspace-app-bar");
    const stripIndex = topLevelNodes.findIndex(
      (node) => node?.props?.testID === "project-collection-scope-strip",
    );
    expect(barIndex).toBeGreaterThanOrEqual(0);
    expect(stripIndex).toBeGreaterThan(barIndex);
  });

  it("does not mark All projects selected for a collection scope", () => {
    const items = buildHomeListFilterMenuItems({
      environments: [],
      projects: [{ key: PROJECT_KEY, label: "Work repo" }],
      selectedEnvironmentId: null,
      selectedProjectKey: null,
      projectCollectionScope: { kind: "collection", collectionId: WORK_ID },
      projectCollectionScopeOptions: scopeOptions,
      projectCollectionsAvailable: true,
      canManageProjectCollections: true,
      onEnvironmentChange: vi.fn(),
      onProjectChange: vi.fn(),
      onProjectCollectionScopeChange: vi.fn(),
      onManageProjectCollections: vi.fn(),
    });

    const projects = items.find((item) => item.id === "project");
    const allProjects = projects && "items" in projects ? projects.items[0] : undefined;
    expect(allProjects && !("items" in allProjects) ? allProjects.selected : undefined).toBe(false);
  });

  it("leaves iOS header ownership to the workspace while retaining the collection strip", () => {
    act(() => {
      renderer = create(<WorkspaceListHeader {...headerProps} />);
    });

    expect(renderer!.root.findAllByType("native-header-options" as never)).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: "project-collection-scope-strip" })).toBeDefined();
  });
});
