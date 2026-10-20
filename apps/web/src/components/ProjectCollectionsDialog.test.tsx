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
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("lucide-react/dynamic", () => ({
  DynamicIcon: ({ name }: { readonly name: string }) => <svg data-icon={name} />,
}));

vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

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
    AlertDialogClose: ({ children, ...props }: React.ComponentProps<"button">) => (
      <button {...props}>{children}</button>
    ),
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogPopup: Container,
    AlertDialogTitle: Container,
  };
});

vi.mock("./ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("./ui/scroll-area", () => ({
  ScrollArea: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./ui/toggle-group", () => ({
  Toggle: ({ children, value, ...props }: React.ComponentProps<"button"> & { value: string }) => (
    <button data-toggle-value={value} {...props}>
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

vi.mock("./ui/menu", () => {
  const Container = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  const Item = ({ children, onClick, ...props }: React.ComponentProps<"button">) => (
    <button
      {...props}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick?.(event as never);
      }}
    >
      {children}
    </button>
  );
  return {
    DropdownMenu: Container,
    DropdownMenuContent: Container,
    DropdownMenuGroup: Container,
    DropdownMenuItem: Item,
    DropdownMenuLabel: Container,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuTrigger: Item,
  };
});

import type { ProjectCollectionsView } from "~/hooks/useProjectCollections";
import {
  ProjectCollectionsDialogView,
  type ProjectCollectionsDialogProject,
} from "./ProjectCollectionsDialog";

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
      remoteUrl: "git@github.com:acme/pockeor.git",
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

function document(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      { id: WORK_ID, name: "Work", visual: { kind: "lucide", name: "briefcase", color: "blue" } },
      { id: PERSONAL_ID, name: "Personal", visual: { kind: "emoji", emoji: "🏠" } },
    ],
    assignments: [{ projectKey: PROJECT_KEY, collectionId: WORK_ID }],
  };
}

function makeView(overrides: Partial<ProjectCollectionsView> = {}): ProjectCollectionsView {
  const source = document();
  return {
    document: source,
    confirmedDocument: source,
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
function render(view: ProjectCollectionsView, props: Record<string, unknown> = {}) {
  act(() => {
    renderer = create(
      <ProjectCollectionsDialogView
        open
        onOpenChange={vi.fn()}
        projects={projects}
        view={view}
        createCollectionId={() => CLIENTS_ID}
        {...props}
      />,
    );
  });
}
function update(view: ProjectCollectionsView, props: Record<string, unknown> = {}) {
  act(() => {
    renderer!.update(
      <ProjectCollectionsDialogView
        open
        onOpenChange={vi.fn()}
        projects={projects}
        view={view}
        createCollectionId={() => CLIENTS_ID}
        {...props}
      />,
    );
  });
}
function change(label: string, value: string) {
  act(() =>
    renderer!.root
      .findByProps({ "aria-label": label })
      .props.onChange({ currentTarget: { value } }),
  );
}
function submitForm() {
  act(() => renderer!.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("ProjectCollectionsDialogView", () => {
  it("validates create names, preserves cancel, and submits a styled complete document", () => {
    const view = makeView();
    const onCollectionCreated = vi.fn();
    render(view, { onCollectionCreated });

    act(() => button("New collection").props.onClick());
    act(() => button("Cancel").props.onClick());
    expect(view.save).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({ "aria-label": "Collection name" })).toHaveLength(0);

    act(() => button("New collection").props.onClick());
    submitForm();
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain("between 1");

    change("Collection name", " work ");
    submitForm();
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toBe(
      "Collection names must be unique.",
    );

    change("Collection name", "Unfiled");
    submitForm();
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toBe(
      "All projects and Unfiled are reserved names.",
    );

    change("Collection name", "Clients");
    act(() => button("Choose icon").props.onClick());
    act(() => button("Emoji").props.onClick());
    act(() => renderer!.root.findByProps({ "aria-label": "Sparkles" }).props.onClick());
    act(() => button("Save icon").props.onClick());
    submitForm();

    const candidate = vi.mocked(view.save).mock.calls[0]![0];
    expect(candidate).toEqual({
      ...document(),
      collections: [
        ...document().collections,
        { id: CLIENTS_ID, name: "Clients", visual: { kind: "emoji", emoji: "✨" } },
      ],
    });
    expect(button("Create collection")).toBeDefined();
    expect(onCollectionCreated).not.toHaveBeenCalled();
  });

  it("edits name and visual without changing identity or membership", () => {
    const view = makeView();
    render(view);
    act(() => renderer!.root.findByProps({ "aria-label": "Edit Work" }).props.onClick());
    change("Collection name", "Company");
    act(() => button("Choose icon").props.onClick());
    act(() => renderer!.root.findByProps({ "data-icon-name": "rocket" }).props.onClick());
    act(() => renderer!.root.findByProps({ "aria-label": "Rose" }).props.onClick());
    act(() => button("Save icon").props.onClick());
    submitForm();

    expect(vi.mocked(view.save).mock.calls[0]![0]).toMatchObject({
      collections: [
        { id: WORK_ID, name: "Company", visual: { kind: "lucide", name: "rocket", color: "rose" } },
        document().collections[1],
      ],
      assignments: document().assignments,
    });
  });

  it("supports pointer drop and the keyboard Move alternative through the same complete-document save", () => {
    const pointerView = makeView();
    render(pointerView);
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
    const pointerCandidate = vi.mocked(pointerView.save).mock.calls[0]![0];
    expect(pointerCandidate.assignments).toEqual([
      { projectKey: PROJECT_KEY, collectionId: PERSONAL_ID },
    ]);

    act(() => renderer?.unmount());
    const keyboardView = makeView();
    render(keyboardView);
    act(() => button("Personal").props.onKeyDown({ key: "Enter" }));
    expect(vi.mocked(keyboardView.save).mock.calls[0]![0]).toEqual(pointerCandidate);
  });

  it("announces a move only after acknowledgement and keeps rejection retryable", () => {
    const initial = makeView();
    const retry = vi.fn();
    render(initial);
    act(() => button("Personal").props.onKeyDown({ key: "Enter" }));
    const candidate = vi.mocked(initial.save).mock.calls[0]![0];

    expect(renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ")).not.toContain(
      "Moved 3 checkouts and 6 threads to Personal.",
    );

    update(
      makeView({
        document: candidate,
        optimisticDocument: candidate,
        phase: "saving-reference",
        status: {
          phase: "saving-reference",
          savedCount: 0,
          eligibleCount: 2,
          message: null,
        },
        canMutate: false,
        retry,
      }),
    );
    expect(renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ")).toContain(
      "Saving to MacBook Pro",
    );
    expect(renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ")).not.toContain(
      "Moved 3 checkouts and 6 threads to Personal.",
    );

    update(
      makeView({
        document: document(),
        rejectedCandidate: candidate,
        phase: "not-saved",
        status: { phase: "not-saved", savedCount: 0, eligibleCount: 2, message: "Not saved" },
        canMutate: false,
        retry,
      }),
    );
    const rejectedAnnouncements = renderer!.root
      .findAllByProps({ role: "status" })
      .map(text)
      .join(" ");
    expect(rejectedAnnouncements).toContain("Not saved");
    expect(rejectedAnnouncements).not.toContain("Moved 3 checkouts and 6 threads to Personal.");
    act(() => button("Retry").props.onClick());
    expect(retry).toHaveBeenCalledOnce();

    update(
      makeView({
        document: candidate,
        confirmedDocument: candidate,
        phase: "saved",
        status: {
          phase: "saved",
          savedCount: 2,
          eligibleCount: 2,
          message: "Saved on 2 of 2 environments",
        },
      }),
    );
    expect(renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ")).toContain(
      "Moved 3 checkouts and 6 threads to Personal.",
    );
  });

  it("shows deletion impact, keeps cancel reversible, and unfiles only after confirmation", () => {
    const view = makeView();
    render(view);
    act(() => renderer!.root.findByProps({ "aria-label": "Delete Work" }).props.onClick());
    expect(text(renderer!.root.findByProps({ role: "alertdialog" }))).toContain(
      "1 project will move to Unfiled",
    );
    expect(text(renderer!.root.findByProps({ role: "alertdialog" }))).toContain(
      "No projects or threads will be deleted",
    );
    act(() => button("Cancel deletion").props.onClick());
    expect(view.save).not.toHaveBeenCalled();

    act(() => renderer!.root.findByProps({ "aria-label": "Delete Work" }).props.onClick());
    act(() => button("Delete collection").props.onClick());
    expect(vi.mocked(view.save).mock.calls[0]![0]).toEqual({
      ...document(),
      collections: [document().collections[1]],
      assignments: [],
    });
    expect(renderer!.root.findAllByProps({ role: "alertdialog" })).toHaveLength(1);
  });

  it("retains deletion impact during optimistic saving and renders deletion domain errors", () => {
    const initial = makeView();
    render(initial);
    act(() => renderer!.root.findByProps({ "aria-label": "Delete Work" }).props.onClick());
    act(() => button("Delete collection").props.onClick());
    const candidate = vi.mocked(initial.save).mock.calls[0]![0];

    update(
      makeView({
        document: candidate,
        optimisticDocument: candidate,
        phase: "saving-reference",
        status: {
          phase: "saving-reference",
          savedCount: 0,
          eligibleCount: 2,
          message: null,
        },
        canMutate: false,
      }),
    );
    const optimisticConfirmation = text(renderer!.root.findByProps({ role: "alertdialog" }));
    expect(optimisticConfirmation).toContain("Delete “Work”?");
    expect(optimisticConfirmation).toContain("1 project will move to Unfiled");

    act(() => renderer?.unmount());
    const stale = makeView();
    render(stale);
    act(() => renderer!.root.findByProps({ "aria-label": "Delete Work" }).props.onClick());
    expect(candidate.collections.some(({ id }) => id === WORK_ID)).toBe(false);
    const staleView = makeView({ document: candidate, confirmedDocument: candidate });
    update(staleView);
    act(() => button("Delete collection").props.onClick());
    expect(staleView.save).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "does not exist",
    );
  });

  it("keeps failed and partial submissions open with truthful retry controls", () => {
    const initialView = makeView();
    const retry = vi.fn();
    const apply = vi.fn();
    render(initialView);
    act(() => button("New collection").props.onClick());
    change("Collection name", "Clients");
    submitForm();
    const rejected = vi.mocked(initialView.save).mock.calls[0]![0];

    act(() =>
      renderer!.update(
        <ProjectCollectionsDialogView
          open
          onOpenChange={vi.fn()}
          projects={projects}
          view={makeView({
            document: document(),
            rejectedCandidate: rejected,
            phase: "not-saved",
            status: { phase: "not-saved", savedCount: 0, eligibleCount: 2, message: "Not saved" },
            retry,
          })}
          createCollectionId={() => CLIENTS_ID}
        />,
      ),
    );
    expect(renderer!.root.findByProps({ "aria-label": "Collection name" }).props.value).toBe(
      "Clients",
    );
    expect(renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ")).toContain(
      "Not saved",
    );
    act(() => button("Retry").props.onClick());
    expect(retry).toHaveBeenCalledOnce();

    act(() =>
      renderer!.update(
        <ProjectCollectionsDialogView
          open
          onOpenChange={vi.fn()}
          projects={projects}
          view={makeView({
            phase: "partial",
            status: {
              phase: "partial",
              savedCount: 1,
              eligibleCount: 2,
              message: "Saved on 1 of 2 environments",
            },
            mismatchEnvironmentIds: [EnvironmentId.make("studio")],
            retry,
            useThisLayoutEverywhere: apply,
          })}
          createCollectionId={() => CLIENTS_ID}
        />,
      ),
    );
    expect(renderer!.root.findByProps({ "aria-label": "Collection name" }).props.value).toBe(
      "Clients",
    );
    expect(renderer!.root.findAllByProps({ role: "status" }).map(text).join(" ")).toContain(
      "Saved on 1 of 2 environments",
    );
    act(() => button("Retry").props.onClick());
    expect(retry).toHaveBeenCalledTimes(2);
    act(() => button("Use this layout everywhere").props.onClick());
    expect(apply).toHaveBeenCalledOnce();
  });
});
