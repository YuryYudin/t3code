import {
  act,
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("../components/ui/sidebar", () => ({
  SidebarMenuButton: ({ children, ...props }: React.ComponentProps<"button">) =>
    createElement("button", props, children),
}));

vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children?: ReactNode }) => children,
  TooltipPopup: ({ children }: { readonly children?: ReactNode }) =>
    createElement("span", null, children),
  TooltipTrigger: ({
    children,
    render,
  }: {
    readonly children?: ReactNode;
    readonly render?: ReactNode;
  }) => createElement("div", null, render, children),
}));

import { MenuItem, MenuPopup } from "../components/ui/menu";
import { SidebarAddMenu } from "../components/SidebarAddMenu";

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

test("S2: New project retains its existing action while collection creation stays distinct", () => {
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
  const onNewProject = vi.fn();
  const onNewCollection = vi.fn();

  const menu = SidebarAddMenu({
    environment: {
      serverConfig: {
        environment: { capabilities: { projectCollections: true } },
      },
    },
    onNewCollection,
    onNewProject,
    open: true,
  }) as ReactElement<{ readonly children: ReactNode }>;
  const popup = Children.toArray(menu.props.children).find(
    (child) => isValidElement(child) && child.type === MenuPopup,
  ) as ReactElement<{ readonly children: ReactNode }>;
  const items = Children.toArray(popup.props.children).filter(
    (child) => isValidElement(child) && child.type === MenuItem,
  ) as Array<ReactElement<{ readonly onClick: () => void }>>;

  expect(items).toHaveLength(2);

  items[0]!.props.onClick();
  expect(onNewProject).toHaveBeenCalledOnce();
  expect(onNewCollection).not.toHaveBeenCalled();

  act(() => {
    renderer = create(
      createElement(SidebarAddMenu, {
        environment: {
          serverConfig: null,
        },
        onNewCollection,
        onNewProject,
      }),
    );
  });

  act(() => renderer!.root.findByProps({ "aria-label": "New project" }).props.onClick());
  expect(renderer!.root.findAllByType(MenuItem)).toHaveLength(0);
  expect(onNewProject).toHaveBeenCalledTimes(2);
  expect(onNewCollection).not.toHaveBeenCalled();
});
