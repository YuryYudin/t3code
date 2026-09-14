import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  ProjectCollectionId,
  ProjectCollectionProjectKey,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts/settings";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { buildProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import {
  act,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@base-ui/react/menu", async () => {
  const React = await import("react");
  interface MenuContextValue {
    readonly open: boolean;
    readonly focusTarget: "menu" | "trigger" | null;
    readonly openFromKeyboard: () => void;
    readonly toggleFromPointer: () => void;
    readonly closeToTrigger: () => void;
  }
  const MenuContext = React.createContext<MenuContextValue | null>(null);
  const MenuGroupContext = React.createContext(false);

  function useMenuContext(): MenuContextValue {
    const value = React.useContext(MenuContext);
    if (value === null) throw new Error("Menu primitive rendered outside its root");
    return value;
  }

  function Root({ children }: { readonly children?: ReactNode }) {
    const [open, setOpen] = React.useState(false);
    const [focusTarget, setFocusTarget] = React.useState<MenuContextValue["focusTarget"]>(null);
    const openFromKeyboard = React.useCallback(() => {
      setOpen(true);
      setFocusTarget("menu");
    }, [setFocusTarget, setOpen]);
    const toggleFromPointer = React.useCallback(() => {
      setOpen((current) => !current);
      setFocusTarget(null);
    }, [setFocusTarget, setOpen]);
    const closeToTrigger = React.useCallback(() => {
      setOpen(false);
      setFocusTarget("trigger");
    }, [setFocusTarget, setOpen]);
    const value = React.useMemo<MenuContextValue>(
      () => ({
        open,
        focusTarget,
        openFromKeyboard,
        toggleFromPointer,
        closeToTrigger,
      }),
      [closeToTrigger, focusTarget, open, openFromKeyboard, toggleFromPointer],
    );
    return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
  }

  function Trigger({ children, onClick, onKeyDown, ...props }: ComponentProps<"button">) {
    const menu = useMenuContext();
    return (
      <button
        {...props}
        aria-expanded={menu.open}
        data-focused={menu.focusTarget === "trigger" || undefined}
        onClick={(event) => {
          onClick?.(event);
          menu.toggleFromPointer();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
          event.preventDefault();
          menu.openFromKeyboard();
        }}
      >
        {children}
      </button>
    );
  }

  function Portal({ children }: { readonly children?: ReactNode }) {
    return <>{children}</>;
  }

  function Positioner({ children }: { readonly children?: ReactNode }) {
    return <div>{children}</div>;
  }

  function Popup({ children, ...props }: ComponentProps<"div">) {
    const menu = useMenuContext();
    if (!menu.open) return null;
    return (
      <div role="menu" data-focused={menu.focusTarget === "menu" || undefined} {...props}>
        {children}
      </div>
    );
  }

  function Item({ children, onClick, onKeyDown, ...props }: ComponentProps<"button">) {
    const menu = useMenuContext();
    const activate = (
      event: ReactKeyboardEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>,
    ) => {
      onClick?.(event as ReactMouseEvent<HTMLButtonElement>);
      menu.closeToTrigger();
    };
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        {...props}
        onClick={activate}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate(event);
        }}
      >
        {children}
      </button>
    );
  }

  function Group({ children, ...props }: ComponentProps<"div">) {
    return (
      <MenuGroupContext.Provider value>
        <div {...props}>{children}</div>
      </MenuGroupContext.Provider>
    );
  }

  function GroupLabel({ children, ...props }: ComponentProps<"div">) {
    if (!React.useContext(MenuGroupContext)) {
      throw new Error("MenuGroupContext is missing");
    }
    return (
      <div role="presentation" {...props}>
        {children}
      </div>
    );
  }

  function Separator(props: ComponentProps<"hr">) {
    return <hr role="separator" {...props} />;
  }

  const Indicator = ({ children }: { readonly children?: ReactNode }) => <>{children}</>;
  const CheckboxItem = Object.assign(Item, { Indicator });

  return {
    Menu: {
      createHandle: () => ({}),
      Root,
      Trigger,
      Portal,
      Positioner,
      Popup,
      Group,
      GroupLabel,
      Item,
      CheckboxItem,
      RadioGroup: Group,
      RadioItem: Item,
      RadioItemIndicator: Indicator,
      Separator,
      SubmenuRoot: Root,
      SubmenuTrigger: Item,
    },
  };
});

import { ProjectCollectionMoveMenu } from "./ProjectCollectionMoveMenu";

const WORK_ID = ProjectCollectionId.make("c65373e8-36f4-4eca-8b3a-5d8edf14c9cb");
const PERSONAL_ID = ProjectCollectionId.make("8d34b312-58d0-49da-aa2c-653d188a10de");
const repositoryKey = ProjectCollectionProjectKey.make("repository:github.com/acme/pockeor");

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
const identity = { group: group!, projects: [project] };

function document(): ProjectCollectionsDocument {
  return {
    schemaVersion: 1,
    collections: [
      {
        id: WORK_ID,
        name: "Work",
        visual: { kind: "lucide", name: "briefcase", color: "blue" },
      },
      {
        id: PERSONAL_ID,
        name: "Personal",
        visual: { kind: "lucide", name: "home", color: "green" },
      },
    ],
    assignments: [{ projectKey: repositoryKey, collectionId: WORK_ID }],
  };
}

let renderer: ReactTestRenderer | undefined;

function textContent(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(textContent).join("");
}

function button(label: string): ReactTestInstance {
  return renderer!.root.findAllByType("button").find((node) => textContent(node) === label)!;
}

function keyboardEvent(key: string) {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("ProjectCollectionMoveMenu", () => {
  it("opens from the keyboard and moves focus into every accessible destination", async () => {
    await act(() => {
      renderer = create(
        <ProjectCollectionMoveMenu
          document={document()}
          identity={identity}
          activeScope={{ kind: "all" }}
          projectLabel="PockeoR"
          impact={{ checkoutCount: 1, threadCount: 4 }}
          onPlan={() => {}}
        />,
      );
    });

    expect(renderer!.root.findAllByProps({ role: "menu" })).toHaveLength(0);
    await act(() => button("Move PockeoR").props.onKeyDown(keyboardEvent("ArrowDown")));

    expect(renderer!.root.findAllByProps({ role: "menu" })).toHaveLength(1);
    expect(button("Move PockeoR").props["aria-expanded"]).toBe(true);
    expect(renderer!.root.findByProps({ role: "menu" }).props["data-focused"]).toBe(true);
    expect(button("Work").props["aria-current"]).toBe("true");
    expect(button("Personal").props["aria-current"]).toBeUndefined();
    expect(button("Remove from collection")).toBeDefined();
  });

  it("keyboard-activates named and Unfiled moves, emits plans, and announces feedback", async () => {
    const plans: Array<{ readonly kind: string; readonly feedback: string }> = [];
    await act(() => {
      renderer = create(
        <ProjectCollectionMoveMenu
          document={document()}
          identity={identity}
          activeScope={{ kind: "collection", collectionId: WORK_ID }}
          projectLabel="PockeoR"
          impact={{ checkoutCount: 1, threadCount: 4 }}
          onPlan={(plan) => plans.push(plan)}
        />,
      );
    });

    await act(() => button("Move PockeoR").props.onKeyDown(keyboardEvent("Enter")));
    await act(() => button("Work").props.onKeyDown(keyboardEvent("Enter")));
    expect(plans.at(-1)).toMatchObject({
      kind: "noop",
      feedback: "Already in Work. No changes made.",
    });
    expect(renderer!.root.findByProps({ role: "status" }).children.join("")).toBe(
      "Already in Work. No changes made.",
    );
    expect(button("Move PockeoR").props["data-focused"]).toBe(true);

    await act(() => button("Move PockeoR").props.onKeyDown(keyboardEvent("Enter")));
    await act(() => button("Personal").props.onKeyDown(keyboardEvent("Enter")));
    expect(plans.at(-1)).toMatchObject({
      kind: "mutation",
      activeScope: { kind: "collection", collectionId: WORK_ID },
      feedback: "Moved 1 checkout and 4 threads to Personal.",
    });

    await act(() => button("Move PockeoR").props.onKeyDown(keyboardEvent("Enter")));
    await act(() => button("Remove from collection").props.onKeyDown(keyboardEvent(" ")));
    expect(plans.at(-1)).toMatchObject({
      kind: "mutation",
      activeScope: { kind: "collection", collectionId: WORK_ID },
      destination: { kind: "unfiled" },
      document: { assignments: [] },
    });
  });
});
