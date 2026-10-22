import type {
  ProjectCollection,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectCollectionsDocument,
} from "@t3tools/contracts/settings";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const nativeRuntime = vi.hoisted(() => ({ os: "ios" }));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return nativeRuntime.os;
    },
  },
  Pressable: "native-pressable",
  ScrollView: "native-scroll-view",
  Text: "native-text",
  TextInput: "native-text-input",
  View: "native-view",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 12, left: 0 }),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => NEW_ID }));
vi.mock("uniwind", () => ({ withUniwind: (Component: unknown) => Component }));
vi.mock("lucide-react-native", async () => {
  const React = await import("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("native-collection-icon", { ...props, nativeName: name });
  return {
    BookOpen: icon("BookOpen"),
    Bot: icon("Bot"),
    Briefcase: icon("Briefcase"),
    CloudCog: icon("CloudCog"),
    Code2: icon("Code2"),
    Database: icon("Database"),
    FlaskConical: icon("FlaskConical"),
    FolderCode: icon("FolderCode"),
    Gamepad2: icon("Gamepad2"),
    Globe2: icon("Globe2"),
    Home: icon("Home"),
    Image: icon("Image"),
    Layers: icon("Layers"),
    Monitor: icon("Monitor"),
    Music: icon("Music"),
    Package: icon("Package"),
    Rocket: icon("Rocket"),
    Server: icon("Server"),
    ShieldCheck: icon("ShieldCheck"),
    ShoppingBag: icon("ShoppingBag"),
    Smartphone: icon("Smartphone"),
    Sparkles: icon("Sparkles"),
    Star: icon("Star"),
    Terminal: icon("Terminal"),
  };
});

import {
  ProjectCollectionsSheet,
  ProjectCollectionsSheetView,
  createProjectCollectionsSheetLocalState,
  reconcileProjectCollectionsSheetLocalState,
  type ProjectCollectionsSheetProps,
  type ProjectCollectionsSheetLocalState,
  type ProjectCollectionsSheetSync,
} from "./ProjectCollectionsSheet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WORK_ID = "c65373e8-36f4-4eca-8b3a-5d8edf14c9cb" as ProjectCollectionId;
const PERSONAL_ID = "8d34b312-58d0-49da-aa2c-653d188a10de" as ProjectCollectionId;
const NEW_ID = "9ca527c9-9717-46fc-bdb9-d93cdde97fe0" as ProjectCollectionId;
const APP_KEY = "repository:acme/app" as ProjectCollectionProjectKey;
const API_KEY = "repository:acme/api" as ProjectCollectionProjectKey;

function collection(
  id: ProjectCollectionId,
  name: string,
  visual: ProjectCollection["visual"] = { kind: "lucide", name: "briefcase", color: "blue" },
): ProjectCollection {
  return { id, name, visual } as ProjectCollection;
}

function document(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [collection(WORK_ID, "Work"), collection(PERSONAL_ID, "Personal")],
    assignments: [{ projectKey: APP_KEY, collectionId: WORK_ID }],
  };
}

function sync(overrides: Partial<ProjectCollectionsSheetSync> = {}): ProjectCollectionsSheetSync {
  return {
    document: document(),
    rejectedCandidate: null,
    phase: "idle",
    status: { phase: "idle", savedCount: 0, eligibleCount: 2, message: null },
    mismatchEnvironmentIds: [],
    canMutate: true,
    save: vi.fn(
      (candidate: ProjectCollectionsDocument) => ({ ok: true, value: candidate }) as const,
    ),
    retry: vi.fn(),
    useThisLayoutEverywhere: vi.fn(),
    ...overrides,
  };
}

const PROJECTS: ProjectCollectionsSheetProps["projects"] = [
  { projectKey: APP_KEY, label: "Acme app", workspaceCount: 3 },
  { projectKey: API_KEY, label: "Acme API", workspaceCount: 1 },
];

type ObservableNode = {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: ReadonlyArray<ObservableNode | string>;
};

function renderObservable(node: ReactNode): ObservableNode | string | null {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement(node)) throw new Error("Unsupported observable node");

  const element = node as ReactElement<Record<string, unknown>>;
  if (element.type === Fragment) {
    return {
      type: "fragment",
      props: element.props,
      children: Children.toArray(element.props.children as ReactNode)
        .map(renderObservable)
        .filter((child): child is ObservableNode | string => child !== null),
    };
  }
  if (typeof element.type === "function") {
    const Component = element.type as (props: Record<string, unknown>) => ReactNode;
    return renderObservable(Component(element.props));
  }
  if (typeof element.type !== "string") throw new Error("Unsupported observable component");
  return {
    type: element.type,
    props: element.props,
    children: Children.toArray(element.props.children as ReactNode)
      .map(renderObservable)
      .filter((child): child is ObservableNode | string => child !== null),
  };
}

function findAll(
  node: ObservableNode | string,
  predicate: (node: ObservableNode) => boolean,
): ObservableNode[] {
  if (typeof node === "string") return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...node.children.flatMap((child) => findAll(child, predicate)),
  ];
}

class SheetRenderer {
  props: ProjectCollectionsSheetProps;
  localState: ProjectCollectionsSheetLocalState;
  root!: ObservableNode;

  constructor(
    syncState: ProjectCollectionsSheetSync,
    overrides: Partial<ProjectCollectionsSheetProps>,
  ) {
    this.props = {
      sync: syncState,
      projects: PROJECTS,
      onClose: vi.fn(),
      createCollectionId: () => NEW_ID,
      ...overrides,
    };
    this.localState = createProjectCollectionsSheetLocalState();
    this.render();
  }

  render() {
    const rendered = renderObservable(
      <ProjectCollectionsSheetView
        {...this.props}
        localState={this.localState}
        onLocalStateChange={(next) => {
          this.localState = typeof next === "function" ? next(this.localState) : next;
        }}
      />,
    );
    if (rendered === null || typeof rendered === "string") throw new Error("Expected sheet root");
    this.root = rendered;
  }

  update(
    syncState: ProjectCollectionsSheetSync,
    projects: ProjectCollectionsSheetProps["projects"] = this.props.projects,
  ) {
    this.props = { ...this.props, sync: syncState, projects };
    this.localState = reconcileProjectCollectionsSheetLocalState(
      this.localState,
      syncState.document,
      projects,
    );
    this.render();
  }
}

function renderSheet(
  syncState: ProjectCollectionsSheetSync,
  overrides: Partial<ProjectCollectionsSheetProps> = {},
) {
  return new SheetRenderer(syncState, overrides);
}

function byTestId(renderer: SheetRenderer, testID: string): ObservableNode {
  const node = findAll(renderer.root, (candidate) => candidate.props.testID === testID)[0];
  if (!node) throw new Error(`Missing testID ${testID}`);
  return node;
}

function press(renderer: SheetRenderer, testID: string) {
  const onPress = byTestId(renderer, testID).props.onPress as (() => void) | undefined;
  if (!onPress) throw new Error(`${testID} is not pressable`);
  onPress();
  renderer.render();
}

function type(renderer: SheetRenderer, testID: string, value: string) {
  const onChangeText = byTestId(renderer, testID).props.onChangeText as
    | ((next: string) => void)
    | undefined;
  if (!onChangeText) throw new Error(`${testID} is not an input`);
  onChangeText(value);
  renderer.render();
}

function textContent(renderer: SheetRenderer): string {
  return findAll(renderer.root, (node) => node.type === "native-text")
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join(" ");
}

function publicSheetElement(
  syncState: ProjectCollectionsSheetSync,
  projects: ProjectCollectionsSheetProps["projects"],
) {
  return (
    <ProjectCollectionsSheet
      sync={syncState}
      projects={projects}
      onClose={vi.fn()}
      createCollectionId={() => NEW_ID}
    />
  );
}

async function renderPublicSheet(
  syncState: ProjectCollectionsSheetSync,
  projects: ProjectCollectionsSheetProps["projects"] = PROJECTS,
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(publicSheetElement(syncState, projects));
  });
  return renderer;
}

async function pressPublic(root: ReactTestInstance, testID: string) {
  await act(async () => {
    root.findByProps({ testID }).props.onPress();
  });
}

function consoleText(spy: ReturnType<typeof vi.spyOn>): ReadonlyArray<string> {
  return spy.mock.calls.map((call: unknown[]) => call.map(String).join(" "));
}

describe("ProjectCollectionsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntime.os = "ios";
  });

  it("creates a collection through a cancelable touch form and emits the complete document", async () => {
    const state = sync({ document: { schemaVersion: 1, collections: [], assignments: [] } });
    const onClose = vi.fn();
    const renderer = renderSheet(state, { onClose });

    expect(byTestId(renderer, "close-collections").props.accessibilityRole).toBe("button");
    expect(String(byTestId(renderer, "create-collection").props.className)).toContain(
      "min-h-[48px]",
    );
    press(renderer, "create-collection");
    type(renderer, "collection-name", "  Company  ");
    press(renderer, "save-collection");

    expect(state.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      collections: [collection(NEW_ID, "Company")],
      assignments: [],
    });
    expect(onClose).not.toHaveBeenCalled();

    press(renderer, "create-collection");
    type(renderer, "collection-name", "Discard me");
    press(renderer, "cancel-collection-edit");
    expect(state.save).toHaveBeenCalledTimes(1);
  });

  it("shows the shared unique-name error and keeps the editor open", async () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `edit-collection-${PERSONAL_ID}`);
    type(renderer, "collection-name", "  wORK ");
    press(renderer, "save-collection");

    expect(state.save).not.toHaveBeenCalled();
    expect(textContent(renderer)).toContain("Collection names must be unique.");
    expect(byTestId(renderer, "collection-error").props.accessibilityRole).toBe("alert");
  });

  it("edits icon and color with semantic selected states", async () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `edit-collection-${WORK_ID}`);
    press(renderer, "collection-icon-terminal");
    press(renderer, "collection-color-rose");

    expect(byTestId(renderer, "collection-icon-terminal").props.accessibilityRole).toBe("radio");
    expect(byTestId(renderer, "collection-icon-terminal").props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    press(renderer, "save-collection");

    expect(state.save).toHaveBeenCalledWith({
      ...document(),
      collections: [
        collection(WORK_ID, "Work", { kind: "lucide", name: "terminal", color: "rose" }),
        collection(PERSONAL_ID, "Personal"),
      ],
    });
  });

  it("moves and unfiles whole project families without touch drag-and-drop", async () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `move-project-${APP_KEY}`);
    expect(textContent(renderer)).toContain("3 workspaces and checkouts move together");
    press(renderer, `project-destination-${PERSONAL_ID}`);
    expect(state.save).toHaveBeenLastCalledWith({
      ...document(),
      assignments: [{ projectKey: APP_KEY, collectionId: PERSONAL_ID }],
    });
    expect(
      findAll(renderer.root, (node) => node.props.testID === "project-destination-modal"),
    ).toHaveLength(0);
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(false);
    press(renderer, "create-collection");
    expect(byTestId(renderer, "collection-editor")).toBeDefined();
    press(renderer, "cancel-collection-edit");

    const moved = {
      ...document(),
      assignments: [{ projectKey: APP_KEY, collectionId: PERSONAL_ID }],
    };
    renderer.update({ ...state, document: moved });
    press(renderer, `move-project-${APP_KEY}`);
    press(renderer, "project-destination-unfiled");
    expect(state.save).toHaveBeenLastCalledWith({ ...moved, assignments: [] });
  });

  it("blocks background controls while the move modal is open and restores them after cancel", () => {
    const renderer = renderSheet(sync());

    press(renderer, `move-project-${APP_KEY}`);
    expect(String(byTestId(renderer, "project-destination-modal").props.className)).toContain(
      "absolute inset-0",
    );
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(true);
    expect(byTestId(renderer, `edit-collection-${WORK_ID}`).props.disabled).toBe(true);
    expect(byTestId(renderer, `move-project-${API_KEY}`).props.disabled).toBe(true);

    expect(
      findAll(renderer.root, (node) => node.props.testID === "collection-editor"),
    ).toHaveLength(0);
    expect(textContent(renderer)).toContain("Move Acme app");

    press(renderer, "project-destination-backdrop");
    expect(
      findAll(renderer.root, (node) => node.props.testID === "project-destination-modal"),
    ).toHaveLength(0);
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(false);
    press(renderer, "create-collection");
    expect(byTestId(renderer, "collection-editor")).toBeDefined();
  });

  it("confirms deletion with its impact and supports cancel", async () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `delete-collection-${WORK_ID}`);
    expect(textContent(renderer)).toContain("1 project will become Unfiled");
    press(renderer, "cancel-delete-collection");
    expect(state.save).not.toHaveBeenCalled();

    press(renderer, `delete-collection-${WORK_ID}`);
    press(renderer, "confirm-delete-collection");
    expect(state.save).toHaveBeenCalledWith({
      schemaVersion: 1,
      collections: [collection(PERSONAL_ID, "Personal")],
      assignments: [],
    });
  });

  it("blocks background controls during delete confirmation and restores them after completion", () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `delete-collection-${WORK_ID}`);
    expect(String(byTestId(renderer, "delete-collection-modal").props.className)).toContain(
      "absolute inset-0",
    );
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(true);
    expect(byTestId(renderer, `edit-collection-${PERSONAL_ID}`).props.disabled).toBe(true);
    expect(byTestId(renderer, `move-project-${APP_KEY}`).props.disabled).toBe(true);
    expect(byTestId(renderer, "delete-collection-confirmation")).toBeDefined();
    expect(
      findAll(renderer.root, (node) => node.props.testID === "collection-editor"),
    ).toHaveLength(0);

    press(renderer, "confirm-delete-collection");
    expect(state.save).toHaveBeenCalledOnce();
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(false);
  });

  it("dismisses delete confirmation through its full-screen backdrop", () => {
    const renderer = renderSheet(sync());

    press(renderer, `delete-collection-${WORK_ID}`);
    press(renderer, "delete-collection-backdrop");

    expect(
      findAll(renderer.root, (node) => node.props.testID === "delete-collection-modal"),
    ).toHaveLength(0);
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(false);
  });

  it("contains modal accessibility on iOS and Android", () => {
    const iosRenderer = renderSheet(sync());
    press(iosRenderer, `move-project-${APP_KEY}`);
    expect(byTestId(iosRenderer, "collections-background").props).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: "auto",
    });

    nativeRuntime.os = "android";
    const androidRenderer = renderSheet(sync());
    press(androidRenderer, `delete-collection-${WORK_ID}`);
    expect(byTestId(androidRenderer, "collections-background").props).toMatchObject({
      accessibilityElementsHidden: false,
      importantForAccessibility: "no-hide-descendants",
    });
  });

  it("clears a move target removed by a projects prop update without later resurrection", () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `move-project-${APP_KEY}`);
    renderer.update(state, []);

    expect(
      findAll(renderer.root, (node) => node.props.testID === "project-destination-modal"),
    ).toHaveLength(0);
    expect(byTestId(renderer, "collections-background").props).toMatchObject({
      accessibilityElementsHidden: false,
      importantForAccessibility: "auto",
    });
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(false);
    press(renderer, "create-collection");
    expect(byTestId(renderer, "collection-editor")).toBeDefined();
    press(renderer, "cancel-collection-edit");

    renderer.update(state, PROJECTS);
    expect(
      findAll(renderer.root, (node) => node.props.testID === "project-destination-modal"),
    ).toHaveLength(0);
  });

  it("clears a delete target removed by a document prop update and restores controls", () => {
    const state = sync();
    const renderer = renderSheet(state);

    press(renderer, `delete-collection-${WORK_ID}`);
    const withoutWork = {
      schemaVersion: 1,
      collections: [collection(PERSONAL_ID, "Personal")],
      assignments: [],
    } satisfies ProjectCollectionsDocument;
    renderer.update({ ...state, document: withoutWork });

    expect(
      findAll(renderer.root, (node) => node.props.testID === "delete-collection-modal"),
    ).toHaveLength(0);
    expect(byTestId(renderer, "collections-background").props).toMatchObject({
      accessibilityElementsHidden: false,
      importantForAccessibility: "auto",
    });
    expect(byTestId(renderer, "create-collection").props.disabled).toBe(false);
    press(renderer, "create-collection");
    expect(byTestId(renderer, "collection-editor")).toBeDefined();

    renderer.update(state);
    expect(
      findAll(renderer.root, (node) => node.props.testID === "delete-collection-modal"),
    ).toHaveLength(0);
  });

  it("reconciles a removed move target through the public stateful sheet without warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = sync();
    try {
      const renderer = await renderPublicSheet(state);
      await pressPublic(renderer.root, `move-project-${APP_KEY}`);
      expect(renderer.root.findAllByProps({ testID: "project-destination-modal" })).toHaveLength(1);

      await act(async () => {
        renderer.update(publicSheetElement(state, []));
      });
      expect(renderer.root.findAllByProps({ testID: "project-destination-modal" })).toHaveLength(0);
      expect(renderer.root.findByProps({ testID: "collections-background" }).props).toMatchObject({
        accessibilityElementsHidden: false,
        importantForAccessibility: "auto",
      });
      await pressPublic(renderer.root, "create-collection");
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(1);
      await pressPublic(renderer.root, "cancel-collection-edit");

      await act(async () => {
        renderer.update(publicSheetElement(state, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "project-destination-modal" })).toHaveLength(0);

      const unexpectedErrors = consoleText(consoleError).filter(
        (message) => !message.includes("react-test-renderer is deprecated"),
      );
      expect(unexpectedErrors).toEqual([]);
      expect(consoleText(consoleWarn)).toEqual([]);
      await act(async () => renderer.unmount());
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("reconciles a remotely deleted collection through the public stateful sheet", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = sync();
    const withoutWork = {
      schemaVersion: 1,
      collections: [collection(PERSONAL_ID, "Personal")],
      assignments: [],
    } satisfies ProjectCollectionsDocument;
    try {
      const renderer = await renderPublicSheet(state);
      await pressPublic(renderer.root, `delete-collection-${WORK_ID}`);
      expect(renderer.root.findAllByProps({ testID: "delete-collection-modal" })).toHaveLength(1);

      await act(async () => {
        renderer.update(publicSheetElement({ ...state, document: withoutWork }, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "delete-collection-modal" })).toHaveLength(0);
      expect(renderer.root.findByProps({ testID: "collections-background" }).props).toMatchObject({
        accessibilityElementsHidden: false,
        importantForAccessibility: "auto",
      });
      await pressPublic(renderer.root, "create-collection");
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(1);
      await pressPublic(renderer.root, "cancel-collection-edit");

      await act(async () => {
        renderer.update(publicSheetElement(state, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "delete-collection-modal" })).toHaveLength(0);

      const unexpectedErrors = consoleText(consoleError).filter(
        (message) => !message.includes("react-test-renderer is deprecated"),
      );
      expect(unexpectedErrors).toEqual([]);
      expect(consoleText(consoleWarn)).toEqual([]);
      await act(async () => renderer.unmount());
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("closes a stale public edit form without resurrection or React warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = sync();
    const withoutWork = {
      schemaVersion: 1,
      collections: [collection(PERSONAL_ID, "Personal")],
      assignments: [],
    } satisfies ProjectCollectionsDocument;
    try {
      const renderer = await renderPublicSheet(state);
      await pressPublic(renderer.root, `edit-collection-${WORK_ID}`);
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(1);
      await act(async () => {
        renderer.root.findByProps({ testID: "collection-name" }).props.onChangeText("Personal");
      });
      await pressPublic(renderer.root, "save-collection");
      expect(renderer.root.findAllByProps({ testID: "collection-error" }).length).toBeGreaterThan(
        0,
      );

      await act(async () => {
        renderer.update(publicSheetElement({ ...state, document: withoutWork }, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ testID: "collection-error" })).toHaveLength(0);
      expect(renderer.root.findByProps({ testID: "collections-background" }).props).toMatchObject({
        accessibilityElementsHidden: false,
        importantForAccessibility: "auto",
      });

      await act(async () => {
        renderer.update(publicSheetElement(state, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(0);

      const unexpectedErrors = consoleText(consoleError).filter(
        (message) => !message.includes("react-test-renderer is deprecated"),
      );
      expect(unexpectedErrors).toEqual([]);
      expect(consoleText(consoleWarn)).toEqual([]);
      await act(async () => renderer.unmount());
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("clears local edit and modal targets across document loss without resurrection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = sync();
    try {
      const renderer = await renderPublicSheet(state);
      await pressPublic(renderer.root, `edit-collection-${PERSONAL_ID}`);
      await act(async () => {
        renderer.update(publicSheetElement({ ...state, document: null }, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ testID: "project-destination-modal" })).toHaveLength(0);

      await act(async () => {
        renderer.update(publicSheetElement(state, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(0);

      await pressPublic(renderer.root, `move-project-${APP_KEY}`);
      await act(async () => {
        renderer.update(publicSheetElement({ ...state, document: null }, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "project-destination-modal" })).toHaveLength(0);
      expect(renderer.root.findByProps({ testID: "collections-background" }).props).toMatchObject({
        accessibilityElementsHidden: false,
        importantForAccessibility: "auto",
      });
      await act(async () => {
        renderer.update(publicSheetElement(state, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "project-destination-modal" })).toHaveLength(0);

      const unexpectedErrors = consoleText(consoleError).filter(
        (message) => !message.includes("react-test-renderer is deprecated"),
      );
      expect(unexpectedErrors).toEqual([]);
      expect(consoleText(consoleWarn)).toEqual([]);
      await act(async () => renderer.unmount());
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("keeps a create draft across non-null refresh but clears it when the document is lost", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = sync();
    try {
      const renderer = await renderPublicSheet(state);

      await pressPublic(renderer.root, "create-collection");
      const refreshed = {
        ...document(),
        assignments: [{ projectKey: API_KEY, collectionId: PERSONAL_ID }],
      } satisfies ProjectCollectionsDocument;
      await act(async () => {
        renderer.update(publicSheetElement({ ...state, document: refreshed }, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(1);

      await act(async () => {
        renderer.update(publicSheetElement({ ...state, document: null }, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(0);
      await act(async () => {
        renderer.update(publicSheetElement(state, PROJECTS));
      });
      expect(renderer.root.findAllByProps({ testID: "collection-editor" })).toHaveLength(0);
      const unexpectedErrors = consoleText(consoleError).filter(
        (message) => !message.includes("react-test-renderer is deprecated"),
      );
      expect(unexpectedErrors).toEqual([]);
      expect(consoleText(consoleWarn)).toEqual([]);
      await act(async () => renderer.unmount());
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("announces a move domain failure inside the move modal", () => {
    const overlongKey = "x".repeat(513) as ProjectCollectionProjectKey;
    const renderer = renderSheet(sync(), {
      projects: [{ projectKey: overlongKey, label: "Invalid", workspaceCount: 1 }],
    });

    press(renderer, `move-project-${overlongKey}`);
    press(renderer, `project-destination-${WORK_ID}`);

    expect(textContent(renderer)).toContain("Collection project keys must be between 1 and 512");
    expect(byTestId(renderer, "move-collection-error").props).toMatchObject({
      accessibilityLiveRegion: "assertive",
      accessibilityRole: "alert",
    });
    expect(byTestId(renderer, "project-destination-modal")).toBeDefined();
  });

  it("announces a rejected delete save inside the confirmation modal", () => {
    const state = sync({
      save: vi.fn(
        () =>
          ({
            ok: false,
            error: {
              code: "document-byte-limit",
              field: "document",
              message: "The layout could not be saved.",
            },
          }) as const,
      ),
    });
    const renderer = renderSheet(state);

    press(renderer, `delete-collection-${WORK_ID}`);
    press(renderer, "confirm-delete-collection");

    expect(textContent(renderer)).toContain("The layout could not be saved.");
    expect(byTestId(renderer, "delete-collection-error").props).toMatchObject({
      accessibilityLiveRegion: "assertive",
      accessibilityRole: "alert",
    });
    expect(byTestId(renderer, "delete-collection-modal")).toBeDefined();
  });

  it("presents reference rollback and retries the retained candidate", async () => {
    const rejectedCandidate = {
      ...document(),
      collections: [...document().collections, collection(NEW_ID, "Failed")],
    };
    const state = sync({
      document: document(),
      rejectedCandidate,
      phase: "not-saved",
      status: { phase: "not-saved", savedCount: 0, eligibleCount: 2, message: "Not saved" },
    });
    const renderer = renderSheet(state);

    expect(textContent(renderer)).toContain("Not saved");
    expect(textContent(renderer)).toContain("Your attempted layout is ready to retry");
    expect(
      findAll(renderer.root, (node) => node.props.testID === `collection-${NEW_ID}`),
    ).toHaveLength(0);
    press(renderer, "retry-collection-save");
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it("presents partial-save counts, targeted retry, and reconciliation", async () => {
    const state = sync({
      phase: "partial",
      status: {
        phase: "partial",
        savedCount: 2,
        eligibleCount: 3,
        message: "Saved on 2 of 3 environments",
      },
      mismatchEnvironmentIds: ["environment-c" as never],
    });
    const renderer = renderSheet(state);

    expect(textContent(renderer)).toContain("Saved on 2 of 3 environments");
    press(renderer, "retry-collection-save");
    expect(state.retry).toHaveBeenCalledOnce();
    press(renderer, "use-layout-everywhere");
    expect(state.useThisLayoutEverywhere).toHaveBeenCalledOnce();
  });

  it("keeps an unavailable older-only layout read-only while preserving close", () => {
    const onClose = vi.fn();
    const renderer = renderSheet(sync({ document: null, canMutate: false }), { onClose });

    expect(textContent(renderer)).toContain("Collections unavailable");
    expect(
      findAll(renderer.root, (node) => node.props.testID === "create-collection"),
    ).toHaveLength(0);
    press(renderer, "close-collections");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
