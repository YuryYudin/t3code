import type { ProjectIconColor } from "@t3tools/contracts";
import {
  PROJECT_COLLECTION_ICON_NAMES,
  type ProjectCollectionIconName,
  type ProjectCollectionVisual,
} from "@t3tools/contracts/settings";
import {
  BookOpen,
  Bot,
  Briefcase,
  CloudCog,
  Code2,
  Database,
  FlaskConical,
  FolderCode,
  Gamepad2,
  Globe2,
  Home,
  Image,
  Layers,
  Monitor,
  Music,
  Package,
  Rocket,
  Server,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Terminal,
  type LucideIcon,
  type LucideProps,
} from "lucide-react-native";
import { withUniwind } from "uniwind";
import { AppText } from "./AppText";

const PROJECT_COLLECTION_ICON_BY_NAME: {
  readonly [Name in (typeof PROJECT_COLLECTION_ICON_NAMES)[number]]: LucideIcon;
} = {
  briefcase: Briefcase,
  home: Home,
  "folder-code": FolderCode,
  "code-2": Code2,
  terminal: Terminal,
  "globe-2": Globe2,
  server: Server,
  database: Database,
  bot: Bot,
  sparkles: Sparkles,
  smartphone: Smartphone,
  monitor: Monitor,
  "cloud-cog": CloudCog,
  package: Package,
  "book-open": BookOpen,
  "flask-conical": FlaskConical,
  "shield-check": ShieldCheck,
  rocket: Rocket,
  "gamepad-2": Gamepad2,
  music: Music,
  image: Image,
  "shopping-bag": ShoppingBag,
  layers: Layers,
  star: Star,
};

const PROJECT_COLLECTION_ICON_COLOR_CLASS: Record<ProjectIconColor, string> = {
  gray: "accent-gray-500",
  red: "accent-red-500",
  orange: "accent-orange-500",
  amber: "accent-amber-500",
  yellow: "accent-yellow-500",
  lime: "accent-lime-500",
  green: "accent-green-500",
  emerald: "accent-emerald-500",
  teal: "accent-teal-500",
  cyan: "accent-cyan-500",
  sky: "accent-sky-500",
  blue: "accent-blue-500",
  indigo: "accent-indigo-500",
  violet: "accent-violet-500",
  purple: "accent-purple-500",
  fuchsia: "accent-fuchsia-500",
  pink: "accent-pink-500",
  rose: "accent-rose-500",
};

function projectCollectionIcon(name: ProjectCollectionIconName): LucideIcon {
  return PROJECT_COLLECTION_ICON_BY_NAME[name];
}

function NativeCollectionIcon({
  icon: Icon,
  ...props
}: LucideProps & { readonly icon: LucideIcon }) {
  return <Icon {...props} />;
}

const ThemedCollectionIcon = withUniwind(NativeCollectionIcon);

export type ProjectCollectionIconProps = {
  readonly visual: ProjectCollectionVisual;
  readonly size?: number;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

export function ProjectCollectionIcon(props: ProjectCollectionIconProps) {
  const size = props.size ?? 18;

  if (props.visual.kind === "emoji") {
    return (
      <AppText
        accessibilityLabel={props.accessibilityLabel}
        testID={props.testID}
        style={{ fontSize: size, lineHeight: size }}
      >
        {props.visual.emoji}
      </AppText>
    );
  }

  const Icon = projectCollectionIcon(props.visual.name);
  return (
    <ThemedCollectionIcon
      accessibilityLabel={props.accessibilityLabel}
      colorClassName={PROJECT_COLLECTION_ICON_COLOR_CLASS[props.visual.color]}
      height={size}
      icon={Icon}
      size={size}
      strokeWidth={2}
      testID={props.testID}
      width={size}
    />
  );
}
