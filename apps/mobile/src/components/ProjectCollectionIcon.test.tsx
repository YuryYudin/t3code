import { ProjectIconColor } from "@t3tools/contracts";
import {
  PROJECT_COLLECTION_ICON_NAMES,
  type ProjectCollectionVisual,
} from "@t3tools/contracts/settings";
import {
  Children,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Text: "native-text" }));
vi.mock("uniwind", async () => {
  const React = await import("react");
  return {
    withUniwind:
      (Component: ComponentType<Record<string, unknown>>) =>
      ({ colorClassName, ...props }: Record<string, unknown>) =>
        React.createElement(Component, {
          ...props,
          color: typeof colorClassName === "string" ? `resolved:${colorClassName}` : colorClassName,
        }),
  };
});
vi.mock("lucide-react-native", async () => {
  const React = await import("react");
  const icon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("native-icon", { ...props, name });
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

import { ProjectCollectionIcon, type ProjectCollectionIconProps } from "./ProjectCollectionIcon";

type ObservableElement = {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: ReadonlyArray<ObservableElement | string>;
};

function renderObservable(node: ReactNode): ObservableElement | string | null {
  if (node === null || node === undefined || typeof node === "boolean") return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement(node)) throw new Error("Unsupported observable node");

  const element = node as ReactElement<Record<string, unknown>>;
  if (typeof element.type === "function") {
    const Component = element.type as (props: Record<string, unknown>) => ReactNode;
    return renderObservable(Component(element.props));
  }
  if (typeof element.type !== "string") throw new Error("Unsupported observable component");

  const renderedChildren = Children.toArray(element.props.children as ReactNode)
    .map(renderObservable)
    .filter((child): child is ObservableElement | string => child !== null);
  return { type: element.type, props: element.props, children: renderedChildren };
}

function renderIcon(props: ProjectCollectionIconProps): ObservableElement {
  const rendered = renderObservable(<ProjectCollectionIcon {...props} />);
  if (rendered === null || typeof rendered === "string") {
    throw new Error("Expected an observable native element");
  }
  return rendered;
}

function nativeExportName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

describe("ProjectCollectionIcon", () => {
  it("renders every contract icon through its distinct explicit native renderer", () => {
    const renderedNames = new Set<string>();

    for (const name of PROJECT_COLLECTION_ICON_NAMES) {
      const icon = renderIcon({ visual: { kind: "lucide", name, color: "blue" }, size: 20 });

      expect(icon.type).toBe("native-icon");
      expect(icon.props.name).toBe(nativeExportName(name));
      expect(icon.props.color).toBe("resolved:accent-blue-500");
      expect(icon.props.size).toBe(20);
      expect(icon.props.width).toBe(20);
      expect(icon.props.height).toBe(20);
      renderedNames.add(String(icon.props.name));
    }

    expect(renderedNames.size).toBe(PROJECT_COLLECTION_ICON_NAMES.length);
  });

  it("maps every contract palette value to an observable bounded Uniwind color", () => {
    for (const color of ProjectIconColor.literals) {
      const icon = renderIcon({ visual: { kind: "lucide", name: "briefcase", color } });
      expect(icon.props.color).toBe(`resolved:accent-${color}-500`);
    }
  });

  it("uses the default size and forwards native accessibility metadata", () => {
    const icon = renderIcon({
      visual: { kind: "lucide", name: "briefcase", color: "rose" },
      accessibilityLabel: "Work collection",
      testID: "collection-icon",
    });

    expect(icon.props.size).toBe(18);
    expect(icon.props.width).toBe(18);
    expect(icon.props.height).toBe(18);
    expect(icon.props.strokeWidth).toBe(2);
    expect(icon.props.accessibilityLabel).toBe("Work collection");
    expect(icon.props.testID).toBe("collection-icon");
  });

  it("renders emoji through the real uncolored AppText path", () => {
    const visual = { kind: "emoji", emoji: "👩🏽‍💻" } satisfies ProjectCollectionVisual;
    const text = renderIcon({
      visual,
      size: 22,
      accessibilityLabel: "Work collection",
      testID: "collection-emoji",
    });

    expect(text.type).toBe("native-text");
    expect(text.props.className).toBe("font-sans text-foreground");
    expect(text.props.style).toEqual({ fontSize: 22, lineHeight: 22 });
    expect(text.props).not.toHaveProperty("color");
    expect(text.props).not.toHaveProperty("colorClassName");
    expect(text.props.accessibilityLabel).toBe("Work collection");
    expect(text.props.testID).toBe("collection-emoji");
    expect(text.children).toEqual(["👩🏽‍💻"]);
  });
});
