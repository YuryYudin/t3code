import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  ProjectId,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import {
  act,
  Children,
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("lucide-react/dynamic", () => ({
  DynamicIcon: ({ name }: { readonly name: string }) => <svg data-icon={name} />,
}));
vi.mock("./ui/sidebar", () => ({
  SidebarMenuButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("./ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children?: ReactNode }) => children,
  TooltipPopup: ({ children }: { readonly children?: ReactNode }) => <span>{children}</span>,
  TooltipTrigger: ({
    children,
    render,
  }: {
    readonly children?: ReactNode;
    readonly render?: ReactNode;
  }) => (
    <>
      {render}
      {children}
    </>
  ),
}));
vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("./ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("./ui/scroll-area", () => ({
  ScrollArea: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./ui/toggle-group", () => ({
  Toggle: ({ children, value, ...props }: React.ComponentProps<"button"> & { value: string }) => (
    <button {...props} data-toggle-value={value}>
      {children}
    </button>
  ),
  ToggleGroup: ({
    children,
    onValueChange,
    value,
    ...props
  }: React.ComponentProps<"div"> & {
    readonly onValueChange: (value: string[]) => void;
    readonly value: readonly string[];
  }) => (
    <div {...props}>
      {Children.map(children, (child) =>
        isValidElement<{ readonly value: string }>(child)
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              "aria-pressed": value.includes(child.props.value),
              onClick: () => onValueChange([child.props.value]),
            })
          : child,
      )}
    </div>
  ),
}));
// Base UI's popup requires a DOM. Keep the project's Combobox wrappers real
// and replace only that external primitive boundary with a behavioral harness.
vi.mock("@base-ui/react/combobox", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const Context = React.createContext<{
    readonly autoHighlight: boolean;
    readonly filteredItems: readonly unknown[];
    readonly onValueChange: (item: unknown) => void;
    readonly open: boolean;
    readonly setOpen: (open: boolean) => void;
  } | null>(null);
  const EMPTY_ITEMS: readonly unknown[] = [];
  const Container = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  const Root = ({
    autoHighlight = false,
    children,
    filteredItems = EMPTY_ITEMS,
    onOpenChange,
    onValueChange,
    open: controlledOpen,
  }: {
    readonly autoHighlight?: boolean;
    readonly children?: ReactNode;
    readonly filteredItems?: readonly unknown[];
    readonly onOpenChange?: (open: boolean) => void;
    readonly onValueChange?: (item: unknown) => void;
    readonly open?: boolean;
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
    const open = controlledOpen ?? uncontrolledOpen;
    const setOpen = React.useCallback(
      (nextOpen: boolean) => {
        if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
        onOpenChange?.(nextOpen);
      },
      [controlledOpen, onOpenChange, setUncontrolledOpen],
    );
    const selectItem = React.useCallback((item: unknown) => onValueChange?.(item), [onValueChange]);
    const contextValue = React.useMemo(
      () => ({ autoHighlight, filteredItems, onValueChange: selectItem, open, setOpen }),
      [autoHighlight, filteredItems, open, selectItem, setOpen],
    );
    return (
      <Context.Provider value={contextValue}>
        <div>{children}</div>
      </Context.Provider>
    );
  };
  const Trigger = ({
    children,
    render,
    ...props
  }: { readonly children?: ReactNode; readonly render?: ReactElement } & Record<
    string,
    unknown
  >) => {
    const context = React.use(Context)!;
    const triggerProps = {
      ...props,
      "aria-expanded": context.open,
      onClick: () => context.setOpen(!context.open),
    };
    return render ? (
      cloneElement(render, triggerProps, children)
    ) : (
      <button {...triggerProps}>{children}</button>
    );
  };
  const Input = ({
    render: _render,
    onKeyDown,
    ...props
  }: React.ComponentProps<"input"> & { readonly render?: ReactElement }) => {
    const context = React.use(Context)!;
    return (
      <input
        {...props}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            event.key === "Enter" &&
            context.autoHighlight &&
            context.filteredItems[0] !== undefined
          ) {
            context.onValueChange(context.filteredItems[0]);
            context.setOpen(false);
          }
        }}
      />
    );
  };
  const Item = ({
    children,
    value,
    onClick,
    ...props
  }: React.ComponentProps<"button"> & { readonly value: unknown }) => {
    const context = React.use(Context)!;
    return (
      <button
        {...props}
        onClick={(event) => {
          onClick?.(event);
          context.onValueChange(value);
          context.setOpen(false);
        }}
      >
        {children}
      </button>
    );
  };
  const Portal = ({ children }: { readonly children?: ReactNode }) =>
    React.use(Context)?.open ? children : null;
  return {
    Combobox: {
      Root,
      Trigger,
      Input,
      Item,
      Portal,
      Positioner: Container,
      Popup: Container,
      List: Container,
      Group: Container,
      GroupLabel: Container,
      Empty: Container,
      Separator: () => <hr />,
      Icon: Container,
      Clear: ({ children }: { readonly children?: ReactNode }) => <button>{children}</button>,
      Row: Container,
      Value: Container,
      Collection: Container,
      Chips: Container,
      useFilter: () => ({
        contains: <T,>(item: T, query: string, stringify: (candidate: T) => string) =>
          stringify(item).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      }),
    },
  };
});
vi.mock("./ui/menu", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  const Item = ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  );
  const Trigger = ({
    children,
    render,
    ...props
  }: { readonly children?: ReactNode; readonly render?: ReactElement } & Record<
    string,
    unknown
  >) => (render ? cloneElement(render, props, children) : <button {...props}>{children}</button>);
  return {
    Menu: Container,
    MenuItem: Item,
    MenuPopup: Container,
    MenuTrigger: Trigger,
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuItem: Item,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: Item,
  };
});
vi.mock("./ui/dialog", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  return {
    Dialog: ({ children, open }: { readonly children?: ReactNode; readonly open: boolean }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
  };
});
vi.mock("./ui/alert-dialog", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  return {
    AlertDialog: ({ children, open }: { readonly children?: ReactNode; readonly open: boolean }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogPopup: Container,
    AlertDialogTitle: Container,
  };
});

import type { ProjectCollectionsView } from "~/hooks/useProjectCollections";
import {
  deriveSidebarProjectCollections,
  type SidebarProjectCollectionGroup,
} from "./Sidebar.logic";
import {
  SidebarProjectCollectionDragHandle,
  SidebarProjectCollections,
} from "./SidebarProjectCollections";

const workId = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const personalId = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");
const environmentId = EnvironmentId.make("mac");

function project(id: string, key: string): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: {
      canonicalKey: key,
      locator: { source: "git-remote", remoteName: "origin", remoteUrl: `git:${key}` },
      rootPath: `/work/${id}`,
      provider: "github",
      owner: "acme",
      name: id,
      displayName: id,
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const work = project("PockeoR", "github.com/acme/pockeor");
const personal = project("HomeLab", "github.com/acme/homelab");
const loose = { ...project("scratch", "github.com/acme/scratch"), repositoryIdentity: null };
const projects = [work, personal, loose];
const groups: SidebarProjectCollectionGroup<EnvironmentProject>[] = projects.map((candidate) => ({
  displayName: candidate.title,
  memberProjects: [
    { ...candidate, physicalProjectKey: `${candidate.environmentId}:${candidate.id}` },
  ],
  memberProjectRefs: [{ environmentId: candidate.environmentId, projectId: candidate.id }],
}));
const workKey = ProjectCollectionProjectKey.make("repository:github.com/acme/pockeor");
const personalKey = ProjectCollectionProjectKey.make("repository:github.com/acme/homelab");

function document(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      { id: workId, name: "Work", visual: { kind: "lucide", name: "briefcase", color: "blue" } },
      { id: personalId, name: "Personal", visual: { kind: "emoji", emoji: "🏠" } },
    ],
    assignments: [
      { projectKey: workKey, collectionId: workId },
      { projectKey: personalKey, collectionId: personalId },
    ],
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
    referenceEnvironmentId: environmentId,
    referenceLabel: "Mac",
    eligibleEnvironmentIds: [environmentId],
    mismatchEnvironmentIds: [],
    canMutate: true,
    save: vi.fn((next: ProjectCollectionsDocument) => ({ ok: true as const, value: next })),
    retry: vi.fn(),
    useThisLayoutEverywhere: vi.fn(),
    ...overrides,
  };
}

const threads = projects.map((candidate, index) => ({
  environmentId: candidate.environmentId,
  projectId: candidate.id,
  id: `thread-${index}`,
}));

let renderer: ReactTestRenderer | undefined;
function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
function button(label: string) {
  return renderer!.root.findAllByType("button").find((node) => text(node).trim() === label)!;
}
function buttonContaining(label: string) {
  return renderer!.root.findAllByType("button").find((node) => text(node).includes(label))!;
}
function statusText() {
  return renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ");
}
function openScopePicker() {
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Filter threads by collection or project" })
      .props.onClick(),
  );
}
function renderBoundary(
  overrides: Partial<React.ComponentProps<typeof SidebarProjectCollections>> = {},
) {
  const currentView = view();
  const model = deriveSidebarProjectCollections({
    document: currentView.document,
    groups,
    projects,
    threads,
    scope: { kind: "all" },
    sanitizeUnavailableProjects: true,
  });
  const props = {
    model,
    view: currentView,
    environment: { serverConfig: { environment: { capabilities: { projectCollections: true } } } },
    scopePickerOpen: false,
    onScopePickerOpenChange: vi.fn(),
    onScopeChange: vi.fn(),
    onNewProject: vi.fn(),
    onProjectSettings: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof SidebarProjectCollections>;
  function BoundaryHarness({ currentView }: { readonly currentView: ProjectCollectionsView }) {
    const [open, setOpen] = useState(false);
    return (
      <SidebarProjectCollections
        {...props}
        view={currentView}
        scopePickerOpen={open}
        onScopePickerOpenChange={setOpen}
      />
    );
  }
  act(() => {
    renderer = create(<BoundaryHarness currentView={props.view} />);
  });
  return {
    props,
    currentView,
    updateView(nextView: ProjectCollectionsView) {
      act(() => renderer!.update(<BoundaryHarness currentView={nextView} />));
    },
  };
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("SidebarProjectCollections", () => {
  it("opens collection targets from a visible row drag and moves its stable whole project", () => {
    const currentView = view();
    const model = deriveSidebarProjectCollections({
      document: currentView.document,
      groups,
      projects,
      threads,
      scope: { kind: "all" },
      sanitizeUnavailableProjects: true,
    });
    const onScopeChange = vi.fn();
    const draggedProject = model.projectByScopedProjectRef.get(`${work.environmentId}:${work.id}`)!;
    function DragHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <SidebarProjectCollectionDragHandle
            projectKey={draggedProject.projectKey}
            projectLabel={draggedProject.label}
            onOpenPicker={() => setOpen(true)}
            onDragEnd={() => setOpen(false)}
          />
          <SidebarProjectCollections
            model={model}
            view={currentView}
            environment={{
              serverConfig: { environment: { capabilities: { projectCollections: true } } },
            }}
            scopePickerOpen={open}
            onScopePickerOpenChange={setOpen}
            onScopeChange={onScopeChange}
            onNewProject={vi.fn()}
            onProjectSettings={vi.fn()}
          />
        </>
      );
    }
    act(() => {
      renderer = create(<DragHarness />);
    });
    const createTransfer = () => ({
      type: "",
      value: "",
      setData(type: string, value: string) {
        this.type = type;
        this.value = value;
      },
      getData() {
        return this.value;
      },
      effectAllowed: "",
    });

    const handle = renderer!.root.findByProps({
      "aria-label": "Drag PockeoR to a collection",
    });
    expect(handle.type).toBe("span");
    expect(handle.props.role).toBe("img");
    expect(handle.props.tabIndex).toBeUndefined();
    expect(handle.props.onKeyDown).toBeUndefined();
    const stopClickPropagation = vi.fn();
    const preventClickDefault = vi.fn();
    act(() =>
      handle.props.onClick({
        preventDefault: preventClickDefault,
        stopPropagation: stopClickPropagation,
      }),
    );
    expect(preventClickDefault).toHaveBeenCalledOnce();
    expect(stopClickPropagation).toHaveBeenCalledOnce();
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);
    const stopPointerPropagation = vi.fn();
    act(() => handle.props.onPointerDown({ stopPropagation: stopPointerPropagation }));
    expect(stopPointerPropagation).toHaveBeenCalledOnce();

    const cancelledTransfer = createTransfer();
    const stopPropagation = vi.fn();
    act(() => handle.props.onDragStart({ dataTransfer: cancelledTransfer, stopPropagation }));

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(cancelledTransfer.type).toBe("application/x-t3-sidebar-project-collection");
    expect(cancelledTransfer.value).toBe(workKey);
    expect(cancelledTransfer.value).not.toBe(threads[0]!.id);
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(true);
    const stopCancelledDragEndPropagation = vi.fn();
    act(() => handle.props.onDragEnd({ stopPropagation: stopCancelledDragEndPropagation }));
    expect(stopCancelledDragEndPropagation).toHaveBeenCalledOnce();
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);

    const transfer = createTransfer();
    act(() => handle.props.onDragStart({ dataTransfer: transfer, stopPropagation: vi.fn() }));
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(true);
    act(() =>
      buttonContaining("Personal1").props.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: transfer,
      }),
    );
    expect(currentView.save).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: expect.arrayContaining([{ projectKey: workKey, collectionId: personalId }]),
      }),
    );
    expect(onScopeChange).not.toHaveBeenCalled();
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);
    expect(
      text(
        renderer!.root.findByProps({
          "aria-label": "Filter threads by collection or project",
        }),
      ).trim(),
    ).toBe("All projects");
  });

  it("exposes counted collection and individual project scopes and changes the device-local scope", () => {
    const { props } = renderBoundary();
    openScopePicker();
    expect(button("All projects3")).toBeDefined();
    expect(button("Work1")).toBeDefined();
    expect(buttonContaining("Personal1")).toBeDefined();
    expect(button("Unfiled1")).toBeDefined();
    expect(buttonContaining("PockeoR")).toBeDefined();

    act(() => button("Work1").props.onClick());
    expect(props.onScopeChange).toHaveBeenCalledTimes(1);
    expect(props.onScopeChange).toHaveBeenCalledWith({ kind: "collection", collectionId: workId });
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);

    vi.mocked(props.onScopeChange).mockClear();
    openScopePicker();
    act(() => buttonContaining("PockeoR").props.onClick());
    expect(props.onScopeChange).toHaveBeenCalledTimes(1);
    expect(props.onScopeChange).toHaveBeenCalledWith({ kind: "project", projectKey: workKey });
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);

    const selectedModel = deriveSidebarProjectCollections({
      document: document(),
      groups,
      projects,
      threads,
      scope: { kind: "collection", collectionId: workId },
      sanitizeUnavailableProjects: true,
    });
    act(() => renderer?.unmount());
    renderBoundary({ model: selectedModel });
    expect(
      text(
        renderer!.root.findByProps({
          "aria-label": "Filter threads by collection or project",
        }),
      ).trim(),
    ).toBe("Work");
  });

  it("keeps New project available and opens create or organizer flows separately", () => {
    const { props } = renderBoundary();
    act(() => button("New project").props.onClick());
    expect(props.onNewProject).toHaveBeenCalledOnce();

    openScopePicker();
    act(() =>
      renderer!.root
        .findAllByType("input")
        .find((node) => node.props["aria-label"] === "Search collections and projects")!
        .props.onChange({ currentTarget: { value: "Work" } }),
    );
    act(() => button("New collection").props.onClick());
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);
    expect(
      renderer!.root
        .findAllByType("input")
        .filter((node) => node.props["aria-label"] === "Search collections and projects"),
    ).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ role: "dialog" })).not.toHaveLength(0);
    expect(
      renderer!.root
        .findAllByType("input")
        .filter((node) => node.props["aria-label"] === "Collection name"),
    ).toHaveLength(1);

    act(() => renderer?.unmount());
    renderBoundary();
    openScopePicker();
    act(() => button("Manage collections…").props.onClick());
    expect(
      renderer!.root.findAll((node) => text(node).trim() === "Manage collections"),
    ).not.toHaveLength(0);
  });

  it("closes and resets the scope picker before opening Manage collections", () => {
    renderBoundary();
    openScopePicker();
    act(() =>
      renderer!.root
        .findAllByType("input")
        .find((node) => node.props["aria-label"] === "Search collections and projects")!
        .props.onChange({ currentTarget: { value: "Work" } }),
    );

    act(() => button("Manage collections…").props.onClick());

    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);
    expect(
      renderer!.root
        .findAllByType("input")
        .filter((node) => node.props["aria-label"] === "Search collections and projects"),
    ).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ role: "dialog" })).not.toHaveLength(0);

    openScopePicker();
    expect(
      renderer!.root.findByProps({ "aria-label": "Search collections and projects" }).props.value,
    ).toBe("");
  });

  it("uses the same complete-document save path for explicit Move and pointer drop", () => {
    const explicit = renderBoundary();
    openScopePicker();
    expect(
      renderer!.root
        .findAllByType("button")
        .filter((node) => node.props["aria-label"] === "Move PockeoR to a collection"),
    ).toHaveLength(1);
    act(() => button("Personal").props.onClick());
    expect(explicit.currentView.save).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: expect.arrayContaining([{ projectKey: workKey, collectionId: personalId }]),
      }),
    );

    act(() => renderer?.unmount());
    const pointer = renderBoundary();
    openScopePicker();
    const transfer = {
      value: "",
      setData(_type: string, value: string) {
        this.value = value;
      },
      getData() {
        return this.value;
      },
      effectAllowed: "",
    };
    act(() =>
      renderer!.root
        .findByProps({ "aria-label": "Drag PockeoR" })
        .props.onDragStart({ dataTransfer: transfer }),
    );
    act(() =>
      buttonContaining("Personal1").props.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: transfer,
      }),
    );
    expect(pointer.currentView.save).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: expect.arrayContaining([{ projectKey: workKey, collectionId: personalId }]),
      }),
    );
  });

  it.each(["explicit Move", "row drop"] as const)(
    "waits for acknowledgement and keeps a rejected %s retryable after rollback",
    (path) => {
      const retry = vi.fn();
      const initialView = view({ retry });
      const boundary = renderBoundary({ view: initialView });
      openScopePicker();

      if (path === "explicit Move") {
        act(() => button("Personal").props.onClick());
      } else {
        const transfer = {
          value: "",
          setData(_type: string, value: string) {
            this.value = value;
          },
          getData() {
            return this.value;
          },
          effectAllowed: "",
        };
        act(() =>
          renderer!.root
            .findByProps({ "aria-label": "Drag PockeoR" })
            .props.onDragStart({ dataTransfer: transfer }),
        );
        act(() =>
          buttonContaining("Personal1").props.onDrop({
            preventDefault: vi.fn(),
            dataTransfer: transfer,
          }),
        );
      }

      const candidate = vi.mocked(initialView.save).mock.calls[0]![0];
      expect(statusText()).toContain("Saving collections");
      expect(statusText()).not.toContain("Moved 1 checkout and 1 thread to Personal.");
      const pickerTrigger = renderer!.root.findByProps({
        "aria-label": "Filter threads by collection or project",
      });
      if (!pickerTrigger.props["aria-expanded"]) openScopePicker();
      expect(
        renderer!.root.findByProps({ "aria-label": "Move PockeoR to a collection" }).props.disabled,
      ).toBe(true);
      expect(renderer!.root.findByProps({ "aria-label": "Drag PockeoR" }).props.draggable).toBe(
        false,
      );

      boundary.updateView(
        view({
          document: candidate,
          optimisticDocument: candidate,
          phase: "saving-reference",
          status: {
            phase: "saving-reference",
            savedCount: 0,
            eligibleCount: 1,
            message: null,
          },
          canMutate: false,
          retry,
        }),
      );
      expect(statusText()).toContain("Saving to Mac");
      expect(statusText()).not.toContain("Moved 1 checkout and 1 thread to Personal.");

      boundary.updateView(
        view({
          document: document(),
          rejectedCandidate: candidate,
          phase: "not-saved",
          status: {
            phase: "not-saved",
            savedCount: 0,
            eligibleCount: 1,
            message: "The reference environment rejected this layout.",
          },
          canMutate: false,
          retry,
        }),
      );
      expect(statusText()).toContain("The reference environment rejected this layout.");
      expect(statusText()).not.toContain("Moved 1 checkout and 1 thread to Personal.");
      act(() => button("Retry").props.onClick());
      expect(retry).toHaveBeenCalledOnce();

      boundary.updateView(
        view({
          document: candidate,
          confirmedDocument: candidate,
          phase: "saved",
          status: {
            phase: "saved",
            savedCount: 1,
            eligibleCount: 1,
            message: "Saved on 1 of 1 environments",
          },
          retry,
        }),
      );
      expect(statusText()).toContain("Moved 1 checkout and 1 thread to Personal.");
    },
  );

  it("keeps a secondary partial failure pending and retryable without claiming success", () => {
    const retry = vi.fn();
    const initialView = view({ retry });
    const boundary = renderBoundary({ view: initialView });
    openScopePicker();
    act(() => button("Personal").props.onClick());
    const candidate = vi.mocked(initialView.save).mock.calls[0]![0];

    boundary.updateView(
      view({
        document: candidate,
        confirmedDocument: candidate,
        phase: "partial",
        status: {
          phase: "partial",
          savedCount: 1,
          eligibleCount: 2,
          message: "Saved on 1 of 2 environments",
        },
        mismatchEnvironmentIds: [EnvironmentId.make("studio")],
        retry,
      }),
    );

    expect(statusText()).toContain("Saved on 1 of 2 environments");
    expect(statusText()).not.toContain("Moved 1 checkout and 1 thread to Personal.");
    act(() => button("Retry").props.onClick());
    expect(retry).toHaveBeenCalledOnce();
  });

  it("releases a pending move when a different saved document supersedes it", () => {
    const initialView = view();
    const boundary = renderBoundary({ view: initialView });
    openScopePicker();
    act(() => button("Personal").props.onClick());

    boundary.updateView(
      view({
        phase: "saved",
        status: {
          phase: "saved",
          savedCount: 1,
          eligibleCount: 1,
          message: "Saved on 1 of 1 environments",
        },
      }),
    );

    expect(statusText()).toContain("superseded");
    expect(statusText()).not.toContain("Moved 1 checkout and 1 thread to Personal.");
    expect(
      renderer!.root.findByProps({ "aria-label": "Move PockeoR to a collection" }).props.disabled,
    ).not.toBe(true);
  });

  it("blocks collection organizers during a pending move while keeping New project available", () => {
    const onNewProject = vi.fn();
    renderBoundary({ onNewProject });
    openScopePicker();
    act(() => button("Personal").props.onClick());

    const manage = button("Manage collections…");
    const newCollection = button("New collection");
    expect(manage.props.disabled).toBe(true);
    expect(newCollection.props.disabled).toBe(true);
    act(() => manage.props.onClick());
    act(() => newCollection.props.onClick());
    expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);

    const newProject = button("New project");
    expect(newProject.props.disabled).not.toBe(true);
    act(() => newProject.props.onClick());
    expect(onNewProject).toHaveBeenCalledOnce();
  });

  it("hides collection mutation controls on an old-only environment without hiding New project", () => {
    const currentView = view({
      document: null,
      confirmedDocument: null,
      canMutate: false,
      referenceEnvironmentId: null,
    });
    const model = deriveSidebarProjectCollections({
      document: null,
      groups,
      projects,
      threads,
      scope: { kind: "all" },
      sanitizeUnavailableProjects: true,
    });
    const onNewProject = vi.fn();
    renderBoundary({ model, view: currentView, environment: null, onNewProject });

    const newProject = renderer!.root.findByProps({ "aria-label": "New project" });
    expect(newProject).toBeDefined();
    expect(
      renderer!.root.findAllByType("button").some((node) => text(node).includes("New collection")),
    ).toBe(false);
    expect(
      renderer!.root
        .findAllByType("button")
        .filter((node) => String(node.props["aria-label"] ?? "").startsWith("Move ")),
    ).toHaveLength(0);
    act(() => newProject.props.onClick());
    expect(onNewProject).toHaveBeenCalledOnce();
  });

  it("selects the auto-highlighted search result with Enter and resets search after reopening", () => {
    const { props } = renderBoundary();
    openScopePicker();
    const search = renderer!.root.findByProps({
      "aria-label": "Search collections and projects",
    });

    act(() => search.props.onChange({ currentTarget: { value: "Personal" } }));
    act(() =>
      renderer!.root
        .findAllByType("input")
        .find((node) => node.props["aria-label"] === "Search collections and projects")!
        .props.onKeyDown({ defaultPrevented: false, key: "Enter" }),
    );

    expect(props.onScopeChange).toHaveBeenCalledWith({
      kind: "collection",
      collectionId: personalId,
    });
    expect(props.onScopeChange).toHaveBeenCalledTimes(1);
    expect(
      renderer!.root.findByProps({ "aria-label": "Filter threads by collection or project" }).props[
        "aria-expanded"
      ],
    ).toBe(false);

    openScopePicker();
    expect(
      renderer!.root.findByProps({ "aria-label": "Search collections and projects" }).props.value,
    ).toBe("");
  });
});
