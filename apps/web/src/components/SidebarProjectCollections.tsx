import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { ProjectCollectionScope } from "@t3tools/client-runtime/state/project-collections";
import type {
  ProjectCollection,
  ProjectCollectionsDocument,
  ProjectCollectionVisual,
} from "@t3tools/contracts";
import { DynamicIcon } from "lucide-react/dynamic";
import {
  ChevronDownIcon,
  FolderIcon,
  FolderMinusIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";

import type { ProjectCollectionsView } from "~/hooks/useProjectCollections";
import { cn } from "~/lib/utils";
import { projectIconColorClassName } from "~/projectIconOptions";
import { ProjectCollectionMoveMenu } from "./ProjectCollectionMoveMenu";
import { ProjectCollectionsDialogView } from "./ProjectCollectionsDialog";
import { SidebarAddMenu, type SidebarAddMenuEnvironment } from "./SidebarAddMenu";
import {
  beginSidebarProjectCollectionDrag,
  SIDEBAR_PROJECT_COLLECTION_DRAG_MIME,
  type SidebarProjectCollectionProject,
  type SidebarProjectCollectionsModel,
} from "./Sidebar.logic";
import {
  planSidebarProjectCollectionDrop,
  type ProjectCollectionMovePlan,
} from "./Sidebar.projectCollectionsDrag";
import { ProjectFavicon } from "./ProjectFavicon";
import { Button } from "./ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxSeparator,
  ComboboxTrigger,
  useComboboxFilter,
} from "./ui/combobox";
import { SidebarMenuButton } from "./ui/sidebar";
import {
  canOpenWindowForScope,
  encodeProjectCollectionScope,
  openWindowForScope,
} from "~/windowScope";

export function sidebarProjectCollectionScopeValue(scope: ProjectCollectionScope): string {
  return encodeProjectCollectionScope(scope);
}

export function SidebarProjectCollectionDragHandle(props: {
  readonly projectKey: string;
  readonly projectLabel: string;
  readonly onOpenPicker: () => void;
  readonly onDragEnd: () => void;
}) {
  return (
    <span
      role="img"
      draggable
      aria-label={`Drag ${props.projectLabel} to a collection`}
      className="inline-flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 active:cursor-grabbing"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        beginSidebarProjectCollectionDrag({
          dataTransfer: event.dataTransfer,
          projectKey: props.projectKey,
          openPicker: props.onOpenPicker,
        });
      }}
      onDragEnd={(event) => {
        event.stopPropagation();
        props.onDragEnd();
      }}
    >
      <GripVerticalIcon aria-hidden className="size-3.5" />
    </span>
  );
}

interface ScopeItem<TProject extends EnvironmentProject> {
  readonly value: string;
  readonly scope: ProjectCollectionScope;
  readonly label: string;
  readonly count: number | null;
  readonly collection: ProjectCollection | null;
  readonly project: SidebarProjectCollectionProject<TProject> | null;
}

interface PendingMove {
  readonly document: ProjectCollectionsDocument;
  readonly feedback: string;
}

function sameDocument(left: ProjectCollectionsDocument | null, right: ProjectCollectionsDocument) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function CollectionVisual({ visual }: { readonly visual: ProjectCollectionVisual }) {
  if (visual.kind === "emoji") {
    return (
      <span aria-hidden className="text-base leading-none">
        {visual.emoji}
      </span>
    );
  }
  return (
    <DynamicIcon
      aria-hidden
      name={visual.name}
      className={cn("size-4", projectIconColorClassName(visual.color))}
    />
  );
}

function ScopeIcon<TProject extends EnvironmentProject>({
  item,
}: {
  readonly item: ScopeItem<TProject>;
}) {
  if (item.collection !== null) return <CollectionVisual visual={item.collection.visual} />;
  if (item.project !== null) {
    return (
      <ProjectFavicon
        project={item.project.identity.group.members[0]!.project}
        className="size-4 shrink-0"
      />
    );
  }
  return item.scope.kind === "unfiled" ? (
    <FolderMinusIcon className="size-4 shrink-0" />
  ) : (
    <FolderIcon className="size-4 shrink-0" />
  );
}

export interface SidebarProjectCollectionsProps<
  TProject extends EnvironmentProject = EnvironmentProject,
  TItem extends { readonly environmentId: string; readonly projectId: string } = {
    readonly environmentId: string;
    readonly projectId: string;
  },
> {
  readonly model: SidebarProjectCollectionsModel<TProject, TItem>;
  readonly view: ProjectCollectionsView;
  readonly environment: SidebarAddMenuEnvironment | null;
  readonly scopePickerOpen: boolean;
  readonly onScopePickerOpenChange: (open: boolean) => void;
  readonly onScopeChange: (scope: ProjectCollectionScope) => void;
  readonly onNewProject: () => void;
  readonly onProjectSettings: (project: SidebarProjectCollectionProject<TProject>) => void;
}

export function SidebarProjectCollections<
  TProject extends EnvironmentProject,
  TItem extends { readonly environmentId: string; readonly projectId: string },
>({
  model,
  view,
  environment,
  scopePickerOpen,
  onScopePickerOpenChange,
  onScopeChange,
  onNewProject,
  onProjectSettings,
}: SidebarProjectCollectionsProps<TProject, TItem>) {
  const [query, setQuery] = useState("");
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [startCreating, setStartCreating] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [feedback, setFeedback] = useState("");
  const filter = useComboboxFilter();
  // Desktop-only: older shells (and the browser) have no window management.
  const canOpenNewWindow = canOpenWindowForScope();
  const items = useMemo<ReadonlyArray<ScopeItem<TProject>>>(
    () => [
      ...model.scopeOptions.map((option) => ({
        value: sidebarProjectCollectionScopeValue(option.scope),
        scope: option.scope,
        label: option.label,
        count: option.count,
        collection: option.collection,
        project: null,
      })),
      ...model.projects.map((project) => ({
        value: sidebarProjectCollectionScopeValue({
          kind: "project",
          projectKey: project.projectKey,
        }),
        scope: { kind: "project" as const, projectKey: project.projectKey },
        label: project.label,
        count: null,
        collection: null,
        project,
      })),
    ],
    [model.projects, model.scopeOptions],
  );
  const selected =
    items.find((item) => item.value === sidebarProjectCollectionScopeValue(model.scope)) ??
    items[0]!;
  const filteredItems = useMemo(
    () =>
      query.trim().length === 0
        ? items
        : items.filter((item) => filter.contains(item, query, (candidate) => candidate.label)),
    [filter, items, query],
  );
  const canMove = view.document !== null && view.canMutate && pendingMove === null;

  useEffect(() => {
    if (pendingMove === null || view.phase !== "saved") return;
    // A saved phase is terminal for this attempt. Only the exact candidate is
    // success; another saved layout superseded it and must also release the UI.
    // oxlint-disable-next-line react/set-state-in-effect
    setFeedback(
      sameDocument(view.confirmedDocument, pendingMove.document)
        ? pendingMove.feedback
        : "Collection move was superseded by a different saved layout.",
    );
    setPendingMove(null);
  }, [pendingMove, view.confirmedDocument, view.phase]);

  const pendingStatus =
    pendingMove === null
      ? null
      : view.phase === "saving-reference"
        ? `Saving to ${view.referenceLabel ?? "reference environment"}…`
        : view.phase === "saving-secondaries"
          ? (view.status.message ?? "Saving to connected environments…")
          : view.phase === "not-saved"
            ? (view.status.message ?? "Not saved")
            : view.phase === "partial"
              ? (view.status.message ?? "Saved on some environments")
              : "Saving collections…";

  const openOrganizer = (creating: boolean) => {
    if (pendingMove !== null) return;
    onScopePickerOpenChange(false);
    setQuery("");
    setStartCreating(creating);
    setOrganizerOpen(true);
  };

  const applyMovePlan = (plan: ProjectCollectionMovePlan) => {
    if (plan.kind !== "mutation") {
      setFeedback(plan.feedback);
      return;
    }
    const saved = view.save(plan.document);
    if (!saved.ok) {
      setFeedback(saved.error.message);
      return;
    }
    setFeedback("");
    setPendingMove({ document: saved.value, feedback: plan.feedback });
  };

  const dropProject = (
    event: DragEvent<HTMLElement>,
    destination: Parameters<typeof planSidebarProjectCollectionDrop<TProject>>[0]["destination"],
  ) => {
    event.preventDefault();
    if (!canMove || view.document === null) return;
    const projectKey = event.dataTransfer.getData(SIDEBAR_PROJECT_COLLECTION_DRAG_MIME);
    const project = model.projects.find((candidate) => candidate.projectKey === projectKey);
    if (project === undefined) {
      setFeedback("That project is no longer available. Refresh and try again.");
      return;
    }
    applyMovePlan(
      planSidebarProjectCollectionDrop({
        document: view.document,
        identity: project.identity,
        activeScope: model.scope,
        destination,
        impact: project.impact,
      }),
    );
    onScopePickerOpenChange(false);
    setQuery("");
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <Combobox
          autoHighlight
          items={items}
          filteredItems={filteredItems}
          itemToStringLabel={(item) => item.label}
          isItemEqualToValue={(left, right) => left.value === right.value}
          open={scopePickerOpen}
          onOpenChange={(open) => {
            onScopePickerOpenChange(open);
            setQuery("");
          }}
          value={selected}
          onValueChange={(item) => {
            if (item !== null) onScopeChange(item.scope);
          }}
        >
          <ComboboxTrigger
            render={
              <SidebarMenuButton
                aria-label="Filter threads by collection or project"
                className="min-w-0 flex-1 ps-[calc(var(--sidebar-row-content-inset)-1px)] focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
              />
            }
          >
            <ScopeIcon item={selected} />
            <span className="min-w-0 flex-1 truncate">{selected.label}</span>
            <ChevronDownIcon className="-mr-px size-4 shrink-0" />
          </ComboboxTrigger>
          <ComboboxPopup align="start" className="w-(--anchor-width) min-w-64 overflow-hidden">
            <ComboboxSearchInput
              aria-label="Search collections and projects"
              placeholder="Search collections and projects..."
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <ComboboxEmpty>No matching collections or projects.</ComboboxEmpty>
            <ComboboxList>
              <ComboboxGroup>
                <ComboboxGroupLabel>Collections</ComboboxGroupLabel>
                {filteredItems
                  .filter((item) => item.project === null)
                  .map((item) => {
                    const destination =
                      item.scope.kind === "collection"
                        ? ({ kind: "collection", collectionId: item.scope.collectionId } as const)
                        : item.scope.kind === "unfiled"
                          ? ({ kind: "unfiled" } as const)
                          : null;
                    return (
                      <ComboboxItem
                        key={item.value}
                        hideIndicator
                        value={item}
                        aria-current={item.value === selected.value ? "true" : undefined}
                        onDragOver={
                          destination === null || !canMove
                            ? undefined
                            : (event) => event.preventDefault()
                        }
                        onDrop={
                          destination === null
                            ? undefined
                            : (event) => dropProject(event, destination)
                        }
                        className="h-8 min-h-8 py-0 font-medium"
                        contentClassName="flex min-w-0 items-center gap-2"
                      >
                        <ScopeIcon item={item} />
                        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                        {canOpenNewWindow ? (
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Open ${item.label} in a new window`}
                            className="size-6 p-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              openWindowForScope(item.scope);
                              onScopePickerOpenChange(false);
                            }}
                          >
                            <SquareArrowOutUpRightIcon aria-hidden className="size-3.5" />
                          </Button>
                        ) : null}
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {item.count}
                        </span>
                      </ComboboxItem>
                    );
                  })}
              </ComboboxGroup>
              {model.projects.length > 0 ? (
                <>
                  <ComboboxSeparator />
                  <ComboboxGroup>
                    <ComboboxGroupLabel>Projects</ComboboxGroupLabel>
                    {filteredItems
                      .filter(
                        (
                          item,
                        ): item is ScopeItem<TProject> & {
                          project: SidebarProjectCollectionProject<TProject>;
                        } => item.project !== null,
                      )
                      .map((item) => (
                        <ComboboxItem
                          key={item.value}
                          hideIndicator
                          value={item}
                          aria-current={item.value === selected.value ? "true" : undefined}
                          className="h-8 min-h-8 py-0 font-medium"
                          contentClassName="flex min-w-0 items-center gap-2"
                        >
                          <span
                            draggable={canMove}
                            aria-label={`Drag ${item.project.label}`}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-2",
                              canMove && "cursor-grab",
                            )}
                            onDragStart={(event) => {
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData(
                                SIDEBAR_PROJECT_COLLECTION_DRAG_MIME,
                                item.project.projectKey,
                              );
                            }}
                          >
                            {canMove ? <GripVerticalIcon aria-hidden className="size-3.5" /> : null}
                            <ScopeIcon item={item} />
                            <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
                          </span>
                          {view.document === null ? null : pendingMove === null ? (
                            <ProjectCollectionMoveMenu
                              document={view.document}
                              identity={item.project.identity}
                              activeScope={model.scope}
                              projectLabel={item.project.label}
                              impact={item.project.impact}
                              onPlan={applyMovePlan}
                              disabled={!canMove}
                              trigger={<MoreHorizontalIcon aria-hidden className="size-3.5" />}
                              triggerClassName="size-6 p-0"
                            />
                          ) : (
                            <Button
                              size="icon-xs"
                              variant="ghost-muted"
                              aria-label={`Move ${item.project.label} to a collection`}
                              className="size-6 p-0"
                              disabled
                            >
                              <MoreHorizontalIcon aria-hidden className="size-3.5" />
                            </Button>
                          )}
                          <Button
                            size="icon-xs"
                            variant="ghost-muted"
                            aria-label={`Project settings for ${item.project.label}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onProjectSettings(item.project);
                            }}
                          >
                            <SettingsIcon aria-hidden className="size-3.5" />
                          </Button>
                        </ComboboxItem>
                      ))}
                  </ComboboxGroup>
                </>
              ) : null}
            </ComboboxList>
            {view.document === null ? null : (
              <div className="border-t p-1">
                <Button
                  variant="ghost-muted"
                  className="w-full justify-start"
                  disabled={pendingMove !== null}
                  onClick={() => openOrganizer(false)}
                >
                  <SettingsIcon aria-hidden /> Manage collections…
                </Button>
              </div>
            )}
          </ComboboxPopup>
        </Combobox>
        <SidebarAddMenu
          environment={environment}
          onNewProject={onNewProject}
          newCollectionDisabled={pendingMove !== null}
          onNewCollection={() => openOrganizer(true)}
        />
      </div>

      <div
        className={cn(
          pendingMove === null
            ? "sr-only"
            : "flex min-w-0 items-center gap-2 px-2 py-1 text-xs text-muted-foreground",
          pendingMove !== null && view.phase === "not-saved" && "text-destructive",
        )}
        role="status"
        aria-live="polite"
      >
        <span className="min-w-0 flex-1 truncate">{pendingStatus ?? feedback}</span>
        {pendingMove !== null && (view.phase === "not-saved" || view.phase === "partial") ? (
          <Button size="compact" variant="outline" onClick={view.retry}>
            Retry
          </Button>
        ) : null}
      </div>
      {view.document === null ? null : (
        <ProjectCollectionsDialogView
          open={organizerOpen}
          onOpenChange={setOrganizerOpen}
          projects={model.projects.map((project) => ({
            label: project.label,
            identity: project.identity,
            impact: project.impact,
          }))}
          startCreating={startCreating}
          onCollectionCreated={(collectionId) =>
            onScopeChange({ kind: "collection", collectionId })
          }
          view={view}
        />
      )}
    </>
  );
}
