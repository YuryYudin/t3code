import {
  PROJECT_COLLECTION_ICON_NAMES,
  type ProjectCollectionVisual,
} from "@t3tools/contracts/settings";
import {
  act,
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PROJECT_ICON_COLORS } from "../../projectIconOptions";

vi.mock("lucide-react/dynamic", () => ({
  DynamicIcon: ({ name }: { readonly name: string }) => (
    <svg aria-hidden="true" data-dynamic-icon={name} />
  ),
}));

vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("../ui/dialog", async () => {
  const { useEffect } = await import("react");
  const Container = ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  );
  const Dialog = ({ children, open }: { readonly children?: ReactNode; readonly open: boolean }) =>
    open ? children : null;
  const DialogPopup = ({
    children,
    initialFocus,
    ...props
  }: React.ComponentProps<"div"> & {
    readonly initialFocus?: () => boolean | HTMLElement | null | undefined;
  }) => {
    useEffect(() => {
      const target = initialFocus?.();
      if (target && target !== true) target.focus();
    }, []);
    return <div {...props}>{children}</div>;
  };
  return {
    Dialog,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogPanel: Container,
    DialogPopup,
    DialogTitle: Container,
  };
});

vi.mock("../ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("../ui/scroll-area", () => ({
  ScrollArea: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../ui/toggle-group", () => ({
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
      {Children.map(children, (child) => {
        if (!isValidElement<{ readonly value: string }>(child)) return child;
        return cloneElement(child as ReactElement<Record<string, unknown>>, {
          "aria-pressed": value.includes(child.props.value),
          onClick: () => onValueChange([child.props.value]),
        });
      })}
    </div>
  ),
}));

import { ProjectCollectionIconPickerDialog } from "./ProjectCollectionIconPickerDialog";

const DEFAULT_VISUAL = {
  kind: "lucide",
  name: "briefcase",
  color: "blue",
} satisfies ProjectCollectionVisual;

let renderer: ReactTestRenderer | undefined;
let focusedLabels: Array<string | undefined>;

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof ProjectCollectionIconPickerDialog>> = {},
) {
  const props = {
    current: DEFAULT_VISUAL,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    open: true,
    ...overrides,
  } satisfies React.ComponentProps<typeof ProjectCollectionIconPickerDialog>;

  act(() => {
    renderer = create(<ProjectCollectionIconPickerDialog {...props} />, {
      createNodeMock: (element) => {
        const elementProps = element.props as Record<string, unknown>;
        return {
          focus: () => focusedLabels.push(elementProps["aria-label"] as string | undefined),
          label: elementProps["aria-label"],
        };
      },
    });
  });

  return { props, root: renderer!.root };
}

beforeEach(() => {
  focusedLabels = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("ProjectCollectionIconPickerDialog", () => {
  it("offers exactly the bounded collection icon inventory", () => {
    const { root } = renderPicker();
    const iconGroup = root.findByProps({ role: "radiogroup", "aria-label": "Collection icons" });
    const options = iconGroup.findAllByProps({ role: "radio" });

    expect(options.map((option) => option.props["data-icon-name"])).toEqual([
      ...PROJECT_COLLECTION_ICON_NAMES,
    ]);
    expect(options.map((option) => option.findByType("svg").props["data-dynamic-icon"])).toEqual([
      ...PROJECT_COLLECTION_ICON_NAMES,
    ]);
    expect(root.findAllByProps({ "data-icon-name": "git-branch" })).toHaveLength(0);
  });

  it("initially focuses the current visual", () => {
    renderPicker({ current: { kind: "lucide", name: "home", color: "violet" } });

    expect(focusedLabels).toEqual(["Home"]);
  });

  it("selects a bounded icon and palette color with pointer controls", () => {
    const { props, root } = renderPicker();
    const colorGroup = root.findByProps({ role: "group", "aria-label": "Icon color" });

    expect(colorGroup.findAllByType("button").map((button) => button.props["aria-label"])).toEqual(
      PROJECT_ICON_COLORS.map((option) => option.label),
    );

    act(() => colorGroup.findByProps({ "aria-label": "Rose" }).props.onClick());
    act(() => root.findByProps({ "data-icon-name": "rocket" }).props.onClick());

    expect(root.findByProps({ "data-icon-name": "rocket" }).props).toMatchObject({
      "aria-checked": true,
      className: expect.stringContaining("text-rose-600"),
    });

    act(() => root.findByProps({ children: "Save icon" }).props.onClick());

    expect(props.onSelect).toHaveBeenCalledWith({ kind: "lucide", name: "rocket", color: "rose" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("moves focus and selection through icon options with the keyboard", () => {
    const { props, root } = renderPicker();
    focusedLabels = [];
    const preventDefault = vi.fn();

    act(() =>
      root.findByProps({ "data-icon-name": "briefcase" }).props.onKeyDown({
        key: "ArrowRight",
        preventDefault,
      }),
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(root.findByProps({ "data-icon-name": "home" }).props["aria-checked"]).toBe(true);
    expect(focusedLabels).toEqual(["Home"]);

    act(() => root.findByProps({ children: "Save icon" }).props.onClick());
    expect(props.onSelect).toHaveBeenCalledWith({ kind: "lucide", name: "home", color: "blue" });
  });

  it("parses and emits the first custom emoji without palette color styling", () => {
    const { props, root } = renderPicker({
      current: { kind: "lucide", name: "star", color: "rose" },
    });

    act(() => root.findByProps({ "data-toggle-value": "emoji" }).props.onClick());

    expect(root.findAllByProps({ role: "group", "aria-label": "Icon color" })).toHaveLength(0);
    const emojiGroup = root.findByProps({
      role: "radiogroup",
      "aria-label": "Collection emojis",
    });
    const sparkles = emojiGroup.findByProps({ "aria-label": "Sparkles" });
    expect(sparkles.props.children).toBe("✨");
    expect(sparkles.props.className).not.toContain("text-rose-600");

    act(() =>
      root.findByProps({ "aria-label": "Custom emoji" }).props.onChange({
        currentTarget: { value: "  👩🏽‍💻 and text" },
      }),
    );
    act(() => root.findByProps({ children: "Save icon" }).props.onClick());

    expect(props.onSelect).toHaveBeenCalledWith({ kind: "emoji", emoji: "👩🏽‍💻" });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports roving keyboard selection for emoji options", () => {
    const { props, root } = renderPicker({ current: { kind: "emoji", emoji: "💻" } });
    expect(focusedLabels).toEqual(["Computer"]);
    focusedLabels = [];

    act(() =>
      root.findByProps({ "aria-label": "Computer" }).props.onKeyDown({
        key: "ArrowRight",
        preventDefault: vi.fn(),
      }),
    );

    expect(root.findByProps({ "aria-label": "Tools" }).props["aria-checked"]).toBe(true);
    expect(focusedLabels).toEqual(["Tools"]);
    act(() => root.findByProps({ children: "Save icon" }).props.onClick());
    expect(props.onSelect).toHaveBeenCalledWith({ kind: "emoji", emoji: "🛠️" });
  });

  it("cancels without emitting and resets from the next opening's visual", () => {
    const { props, root } = renderPicker();

    act(() => root.findByProps({ "data-toggle-value": "emoji" }).props.onClick());
    act(() =>
      root.findByProps({ "aria-label": "Custom emoji" }).props.onChange({
        currentTarget: { value: "✨" },
      }),
    );
    act(() => root.findByProps({ children: "Cancel" }).props.onClick());

    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);

    act(() =>
      renderer?.update(
        <ProjectCollectionIconPickerDialog
          {...props}
          current={{ kind: "lucide", name: "home", color: "violet" }}
          open={false}
        />,
      ),
    );
    focusedLabels = [];
    act(() =>
      renderer?.update(
        <ProjectCollectionIconPickerDialog
          {...props}
          current={{ kind: "lucide", name: "home", color: "violet" }}
          open
        />,
      ),
    );

    expect(
      renderer!.root.findByProps({ "data-toggle-value": "lucide" }).props["aria-pressed"],
    ).toBe(true);
    expect(renderer!.root.findByProps({ "data-icon-name": "home" }).props["aria-checked"]).toBe(
      true,
    );
    expect(renderer!.root.findByProps({ "aria-label": "Violet" }).props["aria-pressed"]).toBe(true);
    expect(focusedLabels).toEqual(["Home"]);
  });
});
