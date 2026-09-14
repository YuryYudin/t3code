import type { ProjectCollectionScopeOption } from "@t3tools/client-runtime/state/project-collections";
import { ProjectCollectionId, ProjectCollectionProjectKey } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const runtime = vi.hoisted(() => ({ os: "android" }));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return runtime.os;
    },
  },
  Pressable: "native-pressable",
  ScrollView: "native-scroll-view",
  Text: "native-text",
  TextInput: "native-text-input",
  View: "native-view",
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { appVariant: "development" } } },
}));
vi.mock("@react-navigation/elements", async () => {
  const React = await import("react");
  return { HeaderHeightContext: React.createContext(0) };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 12, right: 0, bottom: 0, left: 0 }),
}));
vi.mock("../../components/ControlPill", async () => {
  const React = await import("react");
  return {
    ControlPillMenu: (props: Record<string, unknown>) =>
      React.createElement("control-pill-menu", props, props.children as ReactNode),
  };
});
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "native-symbol" }));
vi.mock("../../components/ProjectCollectionIcon", () => ({
  ProjectCollectionIcon: "project-collection-icon",
}));
vi.mock("../../components/T3Wordmark", () => ({ T3Wordmark: "t3-wordmark" }));
vi.mock("../../native/StackHeader", async () => {
  const React = await import("react");
  const component = (name: string) => (props: Record<string, unknown>) =>
    React.createElement(name, props, props.children as ReactNode);
  return {
    NativeStackScreenOptions: component("native-stack-screen-options"),
    NativeHeaderToolbar: Object.assign(component("native-header-toolbar"), {
      Button: component("native-header-button"),
      Label: component("native-header-label"),
      Menu: component("native-header-menu"),
      MenuAction: component("native-header-menu-action"),
      Spacer: component("native-header-spacer"),
    }),
  };
});
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ materialYouStyleLayoutActive: false }),
}));
vi.mock("../../lib/useUniwindTheme", () => ({
  useUniwindTheme: () => ({ "--color-icon": "gray" }),
}));
vi.mock("../threads/use-thread-list-v2-enabled", () => ({
  useThreadListV2Enabled: () => false,
}));
vi.mock("../keyboard/hardwareKeyboardCommands", () => ({ useHardwareKeyboardCommand: vi.fn() }));
vi.mock("../layout/native-glass-header-items", () => ({
  withNativeGlassHeaderItem: (item: unknown) => item,
}));
vi.mock("../layout/native-mail-search-toolbar", () => ({
  createNativeMailSearchToolbarItem: (item: unknown) => item,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED: false,
}));
vi.mock("./WorkspaceConnectionTitle", () => ({
  WorkspaceConnectionTitle: "workspace-connection-title",
}));

import { HomeHeader } from "./HomeHeader";

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
  onSearchQueryChange: vi.fn(),
  onEnvironmentChange: vi.fn(),
  onProjectChange: vi.fn(),
  onProjectCollectionScopeChange: vi.fn(),
  onProjectSortOrderChange: vi.fn(),
  onThreadSortOrderChange: vi.fn(),
  onOpenEnvironments: vi.fn(),
  onOpenSettings: vi.fn(),
  onManageProjectCollections: vi.fn(),
  onStartNewTask: vi.fn(),
  onStartNewProject: vi.fn(),
};
const props = {
  environments: [],
  projects: [{ key: PROJECT_KEY, label: "Work repo" }],
  searchQuery: "",
  selectedEnvironmentId: null,
  selectedProjectKey: null,
  projectCollectionScope: { kind: "all" as const },
  projectCollectionScopeOptions: scopeOptions,
  projectCollectionsAvailable: true,
  canManageProjectCollections: true,
  projectSortOrder: "updated_at" as const,
  threadSortOrder: "updated_at" as const,
  ...callbacks,
};

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  runtime.os = "android";
  for (const callback of Object.values(callbacks)) callback.mockReset();
});

describe("HomeHeader project collections", () => {
  it("renders styled collection scopes and a distinct add menu on Android", () => {
    act(() => {
      renderer = create(<HomeHeader {...props} />);
    });

    const workScope = renderer!.root.findByProps({ accessibilityLabel: "Show Work" });
    expect(workScope.findByType("project-collection-icon" as never).props.visual).toEqual(
      scopeOptions[1]!.collection!.visual,
    );
    act(() => workScope.props.onPress());
    expect(callbacks.onProjectCollectionScopeChange).toHaveBeenCalledWith(scopeOptions[1]!.scope);

    const menus = renderer!.root.findAllByType("control-pill-menu" as never);
    const addMenu = menus.find((menu) =>
      menu.props.actions.some((action: { id: string }) => action.id === "add:project"),
    )!;
    act(() => addMenu.props.onPressAction({ nativeEvent: { event: "add:project" } }));
    expect(callbacks.onStartNewProject).toHaveBeenCalledOnce();
    act(() => addMenu.props.onPressAction({ nativeEvent: { event: "add:manage" } }));
    expect(callbacks.onManageProjectCollections).toHaveBeenCalledOnce();

    const filterMenu = menus.find((menu) =>
      menu.props.actions.some((action: { id: string }) => action.id === "collection-scope"),
    )!;
    act(() =>
      filterMenu.props.onPressAction({
        nativeEvent: { event: `collection-scope:collection:${WORK_ID}` },
      }),
    );
    expect(callbacks.onProjectCollectionScopeChange).toHaveBeenCalledTimes(2);
  });

  it("does not mark All projects selected for an Android collection scope", () => {
    act(() => {
      renderer = create(
        <HomeHeader
          {...props}
          projectCollectionScope={{ kind: "collection", collectionId: WORK_ID }}
        />,
      );
    });

    const filterMenu = renderer!.root
      .findAllByType("control-pill-menu" as never)
      .find((menu) =>
        menu.props.actions.some((action: { id: string }) => action.id === "project"),
      )!;
    const projectMenu = filterMenu.props.actions.find(
      (action: { id: string }) => action.id === "project",
    );
    expect(
      projectMenu.subactions.find((action: { id: string }) => action.id === "project:all").state,
    ).toBeUndefined();
  });

  it("keeps the iOS New task action separate and hides mutations when collections are unavailable", () => {
    runtime.os = "ios";
    act(() => {
      renderer = create(
        <HomeHeader
          {...props}
          canManageProjectCollections={false}
          projectCollectionsAvailable={false}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ accessibilityLabel: "Show Work" })).toEqual([]);
    const addMenu = renderer!.root
      .findAllByType("control-pill-menu" as never)
      .find((menu) =>
        menu.props.actions.some((action: { id: string }) => action.id === "add:project"),
      )!;
    expect(addMenu.props.actions).toEqual([{ id: "add:project", title: "New project" }]);
    act(() => addMenu.props.onPressAction({ nativeEvent: { event: "add:project" } }));
    expect(callbacks.onStartNewProject).toHaveBeenCalledOnce();
    act(() => renderer!.root.findByProps({ accessibilityLabel: "New task" }).props.onPress());
    expect(callbacks.onStartNewTask).toHaveBeenCalledOnce();
  });

  it("keeps the iOS collection scope strip below the top safe area", () => {
    runtime.os = "ios";
    act(() => {
      renderer = create(<HomeHeader {...props} />);
    });

    const scopeStrip = renderer!.root.findByProps({ testID: "project-collection-scope-strip" });
    expect(scopeStrip.props.style).toEqual({ paddingTop: 64 });
  });

  it("does not mark All projects selected for a pre-Liquid-Glass iOS collection scope", () => {
    runtime.os = "ios";
    act(() => {
      renderer = create(
        <HomeHeader
          {...props}
          projectCollectionScope={{ kind: "collection", collectionId: WORK_ID }}
        />,
      );
    });

    const projectMenu = renderer!.root
      .findAllByType("native-header-menu" as never)
      .find((menu) => menu.props.title === "Project")!;
    expect(projectMenu.findAllByType("native-header-menu-action" as never)[0]!.props.isOn).toBe(
      false,
    );
  });
});
