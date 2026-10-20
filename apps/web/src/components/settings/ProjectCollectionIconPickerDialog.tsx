import type { ProjectIconColor } from "@t3tools/contracts";
import {
  PROJECT_COLLECTION_ICON_NAMES,
  type ProjectCollectionIconName,
  type ProjectCollectionVisual,
} from "@t3tools/contracts/settings";
import { DynamicIcon } from "lucide-react/dynamic";
import { useRef, useState, type KeyboardEvent } from "react";
import {
  firstEmoji,
  PROJECT_EMOJIS,
  PROJECT_ICON_COLORS,
  projectIconColorClassName,
} from "../../projectIconOptions";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

const DEFAULT_ICON: ProjectCollectionIconName = "briefcase";
const DEFAULT_COLOR: ProjectIconColor = "blue";

function iconLabel(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function nextOptionIndex(key: string, index: number, length: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % length;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

export type ProjectCollectionIconPickerDialogProps = {
  readonly current: ProjectCollectionVisual | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (visual: ProjectCollectionVisual) => void;
};

export function ProjectCollectionIconPickerDialog({
  current,
  open,
  onOpenChange,
  onSelect,
}: ProjectCollectionIconPickerDialogProps) {
  const [mode, setMode] = useState<"lucide" | "emoji">(
    current?.kind === "emoji" ? "emoji" : "lucide",
  );
  const [iconName, setIconName] = useState<ProjectCollectionIconName>(
    current?.kind === "lucide" ? current.name : DEFAULT_ICON,
  );
  const [color, setColor] = useState<ProjectIconColor>(
    current?.kind === "lucide" ? current.color : DEFAULT_COLOR,
  );
  const [emoji, setEmoji] = useState(current?.kind === "emoji" ? current.emoji : "💻");
  const [customEmoji, setCustomEmoji] = useState(current?.kind === "emoji" ? current.emoji : "");
  const [wasOpen, setWasOpen] = useState(open);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const customEmojiInputRef = useRef<HTMLInputElement>(null);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode(current?.kind === "emoji" ? "emoji" : "lucide");
      setIconName(current?.kind === "lucide" ? current.name : DEFAULT_ICON);
      setColor(current?.kind === "lucide" ? current.color : DEFAULT_COLOR);
      setEmoji(current?.kind === "emoji" ? current.emoji : "💻");
      setCustomEmoji(current?.kind === "emoji" ? current.emoji : "");
    }
  }

  const initialOptionKey =
    current?.kind === "emoji"
      ? `emoji:${current.emoji}`
      : `lucide:${current?.name ?? DEFAULT_ICON}`;
  const hasPresetEmoji = PROJECT_EMOJIS.some((option) => option.emoji === emoji);
  const selectIconFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextOptionIndex(event.key, index, PROJECT_COLLECTION_ICON_NAMES.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextName = PROJECT_COLLECTION_ICON_NAMES[nextIndex];
    if (!nextName) return;
    setIconName(nextName);
    optionRefs.current.get(`lucide:${nextName}`)?.focus();
  };
  const selectEmojiFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = nextOptionIndex(event.key, index, PROJECT_EMOJIS.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextEmoji = PROJECT_EMOJIS[nextIndex]?.emoji;
    if (!nextEmoji) return;
    setEmoji(nextEmoji);
    optionRefs.current.get(`emoji:${nextEmoji}`)?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        className="w-full sm:w-[32rem]"
        initialFocus={() =>
          optionRefs.current.get(initialOptionKey) ?? customEmojiInputRef.current ?? true
        }
      >
        <DialogHeader>
          <DialogTitle>Choose collection icon</DialogTitle>
          <DialogDescription>Pick an icon and color, or use an emoji.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col gap-4">
          <ToggleGroup
            aria-label="Icon type"
            variant="segmented"
            value={[mode]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "lucide" || value === "emoji") setMode(value);
            }}
          >
            <Toggle value="lucide">Icons</Toggle>
            <Toggle value="emoji">Emoji</Toggle>
          </ToggleGroup>

          {mode === "lucide" ? (
            <>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Color</div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icon color">
                  {PROJECT_ICON_COLORS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-label={option.label}
                      aria-pressed={color === option.value}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        color === option.value && "border-foreground/64",
                      )}
                      onClick={() => setColor(option.value)}
                    >
                      <span className={cn("size-4 rounded-full", option.swatchClassName)} />
                    </button>
                  ))}
                </div>
              </div>
              <ScrollArea scrollFade className="max-h-64">
                <div
                  className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10"
                  role="radiogroup"
                  aria-label="Collection icons"
                >
                  {PROJECT_COLLECTION_ICON_NAMES.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-label={iconLabel(name)}
                      aria-checked={iconName === name}
                      data-icon-name={name}
                      tabIndex={iconName === name ? 0 : -1}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        iconName === name && "border-border bg-accent",
                        projectIconColorClassName(color),
                      )}
                      onClick={() => setIconName(name)}
                      onKeyDown={(event) => selectIconFromKeyboard(event, index)}
                      ref={(element) => {
                        const key = `lucide:${name}`;
                        if (element) optionRefs.current.set(key, element);
                        else optionRefs.current.delete(key);
                      }}
                    >
                      <DynamicIcon name={name} className="size-5" />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </>
          ) : (
            <>
              <ScrollArea scrollFade className="max-h-64">
                <div
                  className="grid grid-cols-8 gap-1 p-0.5 sm:grid-cols-10"
                  role="radiogroup"
                  aria-label="Collection emojis"
                >
                  {PROJECT_EMOJIS.map((option, index) => (
                    <button
                      key={option.emoji}
                      type="button"
                      role="radio"
                      aria-label={option.label}
                      aria-checked={emoji === option.emoji}
                      tabIndex={emoji === option.emoji || (!hasPresetEmoji && index === 0) ? 0 : -1}
                      className={cn(
                        "flex aspect-square items-center justify-center rounded-md border border-transparent text-xl outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        emoji === option.emoji && "border-border bg-accent",
                      )}
                      onClick={() => setEmoji(option.emoji)}
                      onKeyDown={(event) => selectEmojiFromKeyboard(event, index)}
                      ref={(element) => {
                        const key = `emoji:${option.emoji}`;
                        if (element) optionRefs.current.set(key, element);
                        else optionRefs.current.delete(key);
                      }}
                    >
                      {option.emoji}
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Or paste any emoji
                </div>
                <Input
                  ref={customEmojiInputRef}
                  value={customEmoji}
                  aria-label="Custom emoji"
                  placeholder="Paste an emoji"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setCustomEmoji(value);
                    const nextEmoji = firstEmoji(value);
                    if (nextEmoji) setEmoji(nextEmoji);
                  }}
                />
              </div>
            </>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSelect(
                mode === "lucide"
                  ? { kind: "lucide", name: iconName, color }
                  : { kind: "emoji", emoji },
              );
              onOpenChange(false);
            }}
          >
            Save icon
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
