import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
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
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("lucide-react/dynamic", () => ({
  DynamicIcon: ({ name }: { readonly name: string }) => createElement("svg", { "data-icon": name }),
}));
vi.mock("../components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) =>
    createElement("button", props, children),
}));
vi.mock("../components/ui/dialog", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) =>
    createElement("div", props, children);
  return {
    Dialog: ({ children, open }: { readonly children?: ReactNode; readonly open: boolean }) =>
      open ? createElement("div", { role: "dialog" }, children) : null,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup: Container,
    DialogTitle: Container,
  };
});
vi.mock("../components/ui/alert-dialog", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) =>
    createElement("div", props, children);
  return {
    AlertDialog: ({ children, open }: { readonly children?: ReactNode; readonly open: boolean }) =>
      open ? createElement("div", { role: "alertdialog" }, children) : null,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogPopup: Container,
    AlertDialogTitle: Container,
  };
});
vi.mock("../components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => createElement("input", props),
}));
vi.mock("../components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { readonly children?: ReactNode }) =>
    createElement("div", null, children),
}));
vi.mock("../components/ui/toggle-group", () => ({
  Toggle: ({ children, value, ...props }: React.ComponentProps<"button"> & { value: string }) =>
    createElement("button", { ...props, "data-toggle-value": value }, children),
  ToggleGroup: ({
    children,
    onValueChange,
    value,
    ...props
  }: React.ComponentProps<"div"> & {
    readonly onValueChange: (value: string[]) => void;
    readonly value: readonly string[];
  }) =>
    createElement(
      "div",
      props,
      Children.map(children, (child) =>
        isValidElement<{ readonly value: string }>(child)
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              "aria-pressed": value.includes(child.props.value),
              onClick: () => onValueChange([child.props.value]),
            })
          : child,
      ),
    ),
}));
vi.mock("../components/ui/menu", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) =>
    createElement("div", props, children);
  const Item = ({ children, onClick, ...props }: React.ComponentProps<"button">) =>
    createElement(
      "button",
      {
        ...props,
        onClick,
        onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
          if (event.key === "Enter" || event.key === " ") onClick?.(event as never);
        },
      },
      children,
    );
  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuItem: Item,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => createElement("hr"),
    DropdownMenuTrigger: Item,
  };
});

import type { ProjectCollectionsView } from "../hooks/useProjectCollections";
import {
  ProjectCollectionsDialogView,
  type ProjectCollectionsDialogProject,
} from "../components/ProjectCollectionsDialog";

const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PERSONAL_ID = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");
const CLIENTS_ID = ProjectCollectionId.make("4a41b57e-ff30-42f2-bc72-02e638de0f2d");
const PROJECT_KEY = ProjectCollectionProjectKey.make("repository:github.com/acme/pockeor");
const project: EnvironmentProject = {
  environmentId: EnvironmentId.make("mac"),
  id: ProjectId.make("pockeor"),
  title: "PockeoR",
  workspaceRoot: "/work/pockeor",
  repositoryIdentity: {
    canonicalKey: "github.com/acme/pockeor",
    locator: {
      source: "git-remote",
      remoteName: "origin",
      remoteUrl: "https://github.com/acme/pockeor.git",
    },
    rootPath: "/work/pockeor",
    provider: "github",
    owner: "acme",
    name: "pockeor",
    displayName: "PockeoR",
  },
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const [group] = buildProjectGroups({
  projects: [project],
  settings: { sidebarProjectGroupingMode: "repository", sidebarProjectGroupingOverrides: {} },
});
const projects: ProjectCollectionsDialogProject[] = [
  {
    label: "PockeoR",
    identity: { group: group!, projects: [project] },
    impact: { checkoutCount: 3, threadCount: 6 },
  },
];

function source(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      { id: WORK_ID, name: "Work", visual: { kind: "lucide", name: "briefcase", color: "blue" } },
      { id: PERSONAL_ID, name: "Personal", visual: { kind: "emoji", emoji: "🏠" } },
    ],
    assignments: [{ projectKey: PROJECT_KEY, collectionId: WORK_ID }],
  };
}
function view(
  document = source(),
  overrides: Partial<ProjectCollectionsView> = {},
): ProjectCollectionsView {
  return {
    document,
    confirmedDocument: document,
    optimisticDocument: null,
    rejectedCandidate: null,
    phase: "idle",
    status: { phase: "idle", savedCount: 2, eligibleCount: 2, message: null },
    referenceEnvironmentId: EnvironmentId.make("mac"),
    referenceLabel: "MacBook Pro",
    eligibleEnvironmentIds: [EnvironmentId.make("mac"), EnvironmentId.make("studio")],
    mismatchEnvironmentIds: [],
    canMutate: true,
    save: vi.fn((next: ProjectCollectionsDocument) => ({ ok: true as const, value: next })),
    retry: vi.fn(),
    useThisLayoutEverywhere: vi.fn(),
    ...overrides,
  };
}

let renderer: ReactTestRenderer | undefined;
function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
function button(label: string) {
  return renderer!.root.findAllByType("button").find((node) => text(node).trim() === label)!;
}
function render(currentView: ProjectCollectionsView, extra: Record<string, unknown> = {}) {
  act(() => {
    renderer = create(
      createElement(ProjectCollectionsDialogView, {
        open: true,
        onOpenChange: vi.fn(),
        projects,
        view: currentView,
        createCollectionId: () => CLIENTS_ID,
        ...extra,
      }),
    );
  });
}
function changeName(value: string) {
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": "Collection name" })
      .props.onChange({ currentTarget: { value } }),
  );
}
function submitEditor() {
  act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("desktop collection organizer acceptance", () => {
  it("S1: creates a trimmed styled collection and selects it only after acknowledgement", () => {
    const current = view();
    const selected = vi.fn();
    render(current, { onCollectionCreated: selected });
    act(() => button("New collection").props.onClick());
    changeName("  Clients  ");
    submitEditor();
    const candidate = vi.mocked(current.save).mock.calls[0]![0];
    expect(candidate.collections.at(-1)).toEqual({
      id: CLIENTS_ID,
      name: "Clients",
      visual: { kind: "lucide", name: "briefcase", color: "blue" },
    });
    expect(selected).not.toHaveBeenCalled();

    act(() =>
      renderer!.update(
        createElement(ProjectCollectionsDialogView, {
          open: true,
          onOpenChange: vi.fn(),
          projects,
          view: view(candidate, {
            phase: "saved",
            status: {
              phase: "saved",
              savedCount: 2,
              eligibleCount: 2,
              message: "Saved on 2 of 2 environments",
            },
          }),
          createCollectionId: () => CLIENTS_ID,
          onCollectionCreated: selected,
        }),
      ),
    );
    expect(selected).toHaveBeenCalledWith(CLIENTS_ID);
    expect(renderer!.root.findAllByProps({ "aria-label": "Collection name" })).toHaveLength(0);
  });

  it("S6: pointer drop and keyboard Move submit the same whole-project assignment", () => {
    const pointer = view();
    render(pointer);
    const transfer = {
      value: "",
      setData(_type: string, value: string) {
        this.value = value;
      },
      getData() {
        return this.value;
      },
    };
    act(() =>
      renderer!.root
        .findByProps({ "aria-label": "Drag PockeoR" })
        .props.onDragStart({ dataTransfer: transfer }),
    );
    act(() =>
      renderer!.root
        .findByProps({ "data-drop-collection-id": PERSONAL_ID })
        .props.onDrop({ preventDefault: vi.fn(), dataTransfer: transfer }),
    );
    const pointerDocument = vi.mocked(pointer.save).mock.calls[0]![0];

    act(() => renderer?.unmount());
    const keyboard = view();
    render(keyboard);
    act(() => button("Personal").props.onKeyDown({ key: "Enter" }));
    expect(vi.mocked(keyboard.save).mock.calls[0]![0]).toEqual(pointerDocument);
    expect(pointerDocument.assignments).toEqual([
      { projectKey: PROJECT_KEY, collectionId: PERSONAL_ID },
    ]);
  });

  it("S7: edits a stable collection then confirms deletion that only unfiles its projects", () => {
    const editing = view();
    render(editing);
    act(() => renderer!.root.findByProps({ "aria-label": "Edit Work" }).props.onClick());
    changeName("Company");
    submitEditor();
    const edited = vi.mocked(editing.save).mock.calls[0]![0];
    expect(edited.collections[0]).toMatchObject({ id: WORK_ID, name: "Company" });
    expect(edited.assignments).toEqual(source().assignments);

    act(() => renderer?.unmount());
    const deleting = view(edited);
    render(deleting);
    act(() => renderer!.root.findByProps({ "aria-label": "Delete Company" }).props.onClick());
    expect(text(renderer!.root.findByProps({ role: "alertdialog" }))).toContain(
      "No projects or threads will be deleted",
    );
    act(() => button("Delete collection").props.onClick());
    const deleted = vi.mocked(deleting.save).mock.calls[0]![0];
    expect(deleted.collections.map(({ id }) => id)).toEqual([PERSONAL_ID]);
    expect(deleted.assignments).toEqual([]);
  });
});
