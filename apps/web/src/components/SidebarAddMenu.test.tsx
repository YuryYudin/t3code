import { act, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

import { Menu, MenuItem, MenuPopup } from "./ui/menu";
import { SidebarAddMenu, type SidebarAddMenuEnvironment } from "./SidebarAddMenu";

let renderer: ReactTestRenderer | undefined;

function environment(projectCollections?: boolean): SidebarAddMenuEnvironment {
  return {
    serverConfig: {
      environment: {
        capabilities: projectCollections === undefined ? {} : { projectCollections },
      },
    },
  };
}

function renderMenu(overrides: Partial<React.ComponentProps<typeof SidebarAddMenu>> = {}) {
  const props = {
    environment: environment(true),
    onNewCollection: vi.fn(),
    onNewProject: vi.fn(),
    open: true,
    ...overrides,
  } satisfies React.ComponentProps<typeof SidebarAddMenu>;

  act(() => {
    renderer = create(<SidebarAddMenu {...props} />);
  });

  return { props, root: renderer!.root };
}

beforeEach(() => {
  const document = {
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    addEventListener() {},
    document,
    removeEventListener() {},
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("SidebarAddMenu", () => {
  it("offers distinct New project and New collection actions on a capable environment", () => {
    const props = {
      environment: environment(true),
      onNewCollection: vi.fn(),
      onNewProject: vi.fn(),
      open: true,
    } satisfies React.ComponentProps<typeof SidebarAddMenu>;
    const menu = SidebarAddMenu(props) as ReactElement<{ readonly children: ReactNode }>;
    expect(menu.type).toBe(Menu);
    const popup = Children.toArray(menu.props.children).find(
      (child) => isValidElement(child) && child.type === MenuPopup,
    ) as ReactElement<{ readonly children: ReactNode }>;
    const items = Children.toArray(popup.props.children).filter(
      (child) => isValidElement(child) && child.type === MenuItem,
    ) as Array<ReactElement<{ readonly children: ReactNode; readonly onClick: () => void }>>;

    expect(items.map((item) => Children.toArray(item.props.children).at(-1))).toEqual([
      "New project",
      "New collection",
    ]);

    items[0]!.props.onClick();
    expect(props.onNewProject).toHaveBeenCalledOnce();
    expect(props.onNewCollection).not.toHaveBeenCalled();

    items[1]!.props.onClick();
    expect(props.onNewCollection).toHaveBeenCalledOnce();
  });

  it("can disable New collection without disabling New project", () => {
    const props = {
      environment: environment(true),
      onNewCollection: vi.fn(),
      onNewProject: vi.fn(),
      newCollectionDisabled: true,
      open: true,
    } satisfies React.ComponentProps<typeof SidebarAddMenu>;
    const menu = SidebarAddMenu(props) as ReactElement<{ readonly children: ReactNode }>;
    const popup = Children.toArray(menu.props.children).find(
      (child) => isValidElement(child) && child.type === MenuPopup,
    ) as ReactElement<{ readonly children: ReactNode }>;
    const items = Children.toArray(popup.props.children).filter(
      (child) => isValidElement(child) && child.type === MenuItem,
    ) as Array<ReactElement<React.ComponentProps<typeof MenuItem>>>;
    const newProject = items[0]!;
    const newCollection = items[1]!;

    expect(newProject.props.disabled).not.toBe(true);
    expect(newCollection.props.disabled).toBe(true);
    newProject.props.onClick?.({} as never);
    expect(props.onNewProject).toHaveBeenCalledOnce();
    expect(props.onNewCollection).not.toHaveBeenCalled();
  });

  it.each([
    ["unloaded", null],
    ["old server", environment()],
    ["incapable server", environment(false)],
  ])("keeps the direct New project action for an %s environment", (_label, target) => {
    const { props, root } = renderMenu({ environment: target });

    expect(root.findAllByType(MenuItem)).toHaveLength(0);
    const trigger = root.findByProps({ "aria-label": "New project" });
    act(() => trigger.props.onClick());

    expect(props.onNewProject).toHaveBeenCalledOnce();
    expect(props.onNewCollection).not.toHaveBeenCalled();
  });
});
