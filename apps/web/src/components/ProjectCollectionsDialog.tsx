import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  createProjectCollection,
  deleteProjectCollection,
  deriveProjectCollectionProjectKey,
  getProjectCollectionDeletionImpact,
  renameProjectCollection,
  styleProjectCollection,
  type ProjectCollectionDeletionImpact,
  type ProjectCollectionIdentityInput,
  type ProjectCollectionMutationError,
} from "@t3tools/client-runtime/state/project-collections";
import {
  ProjectCollectionId,
  type ProjectCollection,
  type ProjectCollectionVisual,
  type ProjectCollectionsDocument,
} from "@t3tools/contracts";
import { DynamicIcon } from "lucide-react/dynamic";
import { GripVerticalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";

import { useProjectCollections, type ProjectCollectionsView } from "~/hooks/useProjectCollections";
import { cn, randomUUID } from "~/lib/utils";
import { projectIconColorClassName } from "~/projectIconOptions";
import { ProjectCollectionMoveMenu } from "./ProjectCollectionMoveMenu";
import {
  planSidebarProjectCollectionDrop,
  type ProjectCollectionMoveImpact,
  type ProjectCollectionMovePlan,
} from "./Sidebar.projectCollectionsDrag";
import { ProjectCollectionIconPickerDialog } from "./settings/ProjectCollectionIconPickerDialog";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

const DEFAULT_COLLECTION_VISUAL: ProjectCollectionVisual = {
  kind: "lucide",
  name: "briefcase",
  color: "blue",
};
const DRAG_MIME = "application/x-t3-project-collection";

export interface ProjectCollectionsDialogProject<
  TProject extends EnvironmentProject = EnvironmentProject,
> {
  readonly label: string;
  readonly identity: ProjectCollectionIdentityInput<TProject>;
  readonly impact: ProjectCollectionMoveImpact;
}

export interface ProjectCollectionsDialogProps<
  TProject extends EnvironmentProject = EnvironmentProject,
> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: ReadonlyArray<ProjectCollectionsDialogProject<TProject>>;
  readonly startCreating?: boolean;
  readonly onCollectionCreated?: (collectionId: ProjectCollectionId) => void;
}

export interface ProjectCollectionsDialogViewProps<
  TProject extends EnvironmentProject = EnvironmentProject,
> extends ProjectCollectionsDialogProps<TProject> {
  readonly view: ProjectCollectionsView;
  /** Deterministic seam for tests; production uses the shared UUID helper. */
  readonly createCollectionId?: () => ProjectCollectionId;
}

type CollectionEditor =
  | { readonly kind: "create"; readonly name: string; readonly visual: ProjectCollectionVisual }
  | {
      readonly kind: "edit";
      readonly collectionId: ProjectCollectionId;
      readonly name: string;
      readonly visual: ProjectCollectionVisual;
    };

type PendingAction =
  | {
      readonly kind: "editor";
      readonly document: ProjectCollectionsDocument;
      readonly createdCollectionId: ProjectCollectionId | null;
    }
  | { readonly kind: "delete"; readonly document: ProjectCollectionsDocument }
  | {
      readonly kind: "move";
      readonly document: ProjectCollectionsDocument;
      readonly feedback: string;
    };

interface DeleteConfirmation {
  readonly collectionId: ProjectCollectionId;
  readonly collectionName: string;
  readonly impact: ProjectCollectionDeletionImpact;
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

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function phaseIsUnsettled(phase: ProjectCollectionsView["phase"]) {
  return (
    phase === "saving-reference" ||
    phase === "saving-secondaries" ||
    phase === "partial" ||
    phase === "not-saved"
  );
}

function projectKey<TProject extends EnvironmentProject>(
  project: ProjectCollectionsDialogProject<TProject>,
) {
  return deriveProjectCollectionProjectKey(project.identity);
}

function sameDocument(left: ProjectCollectionsDocument | null, right: ProjectCollectionsDocument) {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function createRandomProjectCollectionId() {
  return ProjectCollectionId.make(randomUUID());
}

export function ProjectCollectionsDialog<TProject extends EnvironmentProject>(
  props: ProjectCollectionsDialogProps<TProject>,
) {
  const view = useProjectCollections();
  return <ProjectCollectionsDialogView {...props} view={view} />;
}

export function ProjectCollectionsDialogView<TProject extends EnvironmentProject>({
  open,
  onOpenChange,
  projects,
  startCreating = false,
  onCollectionCreated,
  view,
  createCollectionId = createRandomProjectCollectionId,
}: ProjectCollectionsDialogViewProps<TProject>) {
  const [editor, setEditor] = useState<CollectionEditor | null>(() =>
    open && startCreating ? { kind: "create", name: "", visual: DEFAULT_COLLECTION_VISUAL } : null,
  );
  const [editorError, setEditorError] = useState<ProjectCollectionMutationError | null>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null);
  const [deleteError, setDeleteError] = useState<ProjectCollectionMutationError | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [moveFeedback, setMoveFeedback] = useState("");
  const [wasOpen, setWasOpen] = useState(open);

  if (wasOpen !== open) {
    setWasOpen(open);
    if (open && startCreating) {
      setEditor({ kind: "create", name: "", visual: DEFAULT_COLLECTION_VISUAL });
      setEditorError(null);
    }
    if (!open) {
      setEditor(null);
      setDeleteConfirmation(null);
      setDeleteError(null);
      setPendingAction(null);
      setMoveFeedback("");
    }
  }

  useEffect(() => {
    if (
      pendingAction === null ||
      view.phase !== "saved" ||
      !sameDocument(view.confirmedDocument, pendingAction.document)
    ) {
      return;
    }
    if (pendingAction.kind === "editor") {
      // The acknowledgement is external hook state; nested forms close only after it lands.
      // oxlint-disable-next-line react/set-state-in-effect
      setEditor(null);
      if (pendingAction.createdCollectionId !== null) {
        onCollectionCreated?.(pendingAction.createdCollectionId);
      }
    } else if (pendingAction.kind === "delete") {
      setDeleteConfirmation(null);
      setDeleteError(null);
    } else {
      setMoveFeedback(pendingAction.feedback);
    }
    setPendingAction(null);
  }, [onCollectionCreated, pendingAction, view.confirmedDocument, view.phase]);

  const document = view.document;
  const assignmentByProjectKey = useMemo(
    () =>
      new Map<string, ProjectCollectionId>(
        document?.assignments.map((assignment) => [assignment.projectKey, assignment.collectionId]),
      ),
    [document],
  );
  const projectsByKey = useMemo(
    () => new Map(projects.map((project) => [projectKey(project), project])),
    [projects],
  );
  const isUnsettled = phaseIsUnsettled(view.phase);
  const mutationDisabled = !view.canMutate || pendingAction !== null;

  const beginCreate = () => {
    setEditor({ kind: "create", name: "", visual: DEFAULT_COLLECTION_VISUAL });
    setEditorError(null);
    setPendingAction(null);
  };
  const beginEdit = (collection: ProjectCollection) => {
    setEditor({
      kind: "edit",
      collectionId: collection.id,
      name: collection.name,
      visual: collection.visual,
    });
    setEditorError(null);
    setPendingAction(null);
  };

  const submitDocument = (
    candidate: ProjectCollectionsDocument,
    pending: PendingAction,
    onError: (error: ProjectCollectionMutationError) => void,
  ) => {
    const saved = view.save(candidate);
    if (!saved.ok) {
      onError(saved.error);
      return false;
    }
    setPendingAction({ ...pending, document: saved.value });
    return true;
  };

  const submitEditor = (event?: FormEvent) => {
    event?.preventDefault();
    if (document === null || editor === null || !view.canMutate) return;
    const mutation =
      editor.kind === "create"
        ? createProjectCollection(document, {
            id: createCollectionId(),
            name: editor.name,
            visual: editor.visual,
          })
        : renameProjectCollection(document, editor.collectionId, editor.name);
    if (!mutation.ok) {
      setEditorError(mutation.error);
      return;
    }
    const styled =
      editor.kind === "create"
        ? mutation
        : styleProjectCollection(mutation.value, editor.collectionId, editor.visual);
    if (!styled.ok) {
      setEditorError(styled.error);
      return;
    }
    setEditorError(null);
    submitDocument(
      styled.value,
      {
        kind: "editor",
        document: styled.value,
        createdCollectionId: editor.kind === "create" ? styled.value.collections.at(-1)!.id : null,
      },
      setEditorError,
    );
  };

  const applyMovePlan = (plan: ProjectCollectionMovePlan) => {
    if (plan.kind !== "mutation") {
      setMoveFeedback(plan.feedback);
      return;
    }
    const saved = view.save(plan.document);
    if (!saved.ok) {
      setMoveFeedback(saved.error.message);
      return;
    }
    setMoveFeedback("");
    setPendingAction({ kind: "move", document: saved.value, feedback: plan.feedback });
  };

  const dropProject = (
    event: DragEvent<HTMLElement>,
    destination: Parameters<typeof planSidebarProjectCollectionDrop<TProject>>[0]["destination"],
  ) => {
    event.preventDefault();
    if (document === null || mutationDisabled) return;
    const draggedProject = projectsByKey.get(event.dataTransfer.getData(DRAG_MIME));
    if (draggedProject === undefined) {
      setMoveFeedback("That project is no longer available. Refresh and try again.");
      return;
    }
    applyMovePlan(
      planSidebarProjectCollectionDrop({
        document,
        identity: draggedProject.identity,
        activeScope: { kind: "all" },
        destination,
        impact: draggedProject.impact,
      }),
    );
  };

  const renderProject = (project: ProjectCollectionsDialogProject<TProject>) => {
    const key = projectKey(project);
    return (
      <div
        key={key}
        className="flex items-center gap-2 rounded-lg border bg-background p-2 shadow-xs"
        data-project-key={key}
      >
        <button
          type="button"
          draggable={!mutationDisabled}
          disabled={mutationDisabled}
          aria-label={`Drag ${project.label}`}
          className="cursor-grab rounded p-1 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(DRAG_MIME, key);
          }}
        >
          <GripVerticalIcon aria-hidden className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{project.label}</div>
          <div className="text-xs text-muted-foreground">
            {countLabel(project.impact.checkoutCount, "checkout", "checkouts")} ·{" "}
            {countLabel(project.impact.threadCount, "thread", "threads")}
          </div>
        </div>
        {document === null ? null : pendingAction === null ? (
          <ProjectCollectionMoveMenu
            document={document}
            identity={project.identity}
            activeScope={{ kind: "all" }}
            projectLabel={project.label}
            impact={project.impact}
            disabled={mutationDisabled}
            onPlan={applyMovePlan}
            trigger={<span>Move</span>}
          />
        ) : (
          <Button size="compact" variant="ghost-muted" disabled>
            Move
          </Button>
        )}
      </div>
    );
  };

  const statusMessage =
    view.phase === "saving-reference"
      ? `Saving to ${view.referenceLabel ?? "reference environment"}…`
      : view.phase === "saving-secondaries"
        ? (view.status.message ?? "Saving to connected environments…")
        : (view.status.message ??
          (view.mismatchEnvironmentIds.length > 0
            ? "Collections differ across environments."
            : null));

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && isUnsettled) return;
          onOpenChange(nextOpen);
        }}
      >
        <DialogPopup className="w-[min(72rem,calc(100vw-2rem))] max-w-none">
          <DialogHeader>
            <DialogTitle>Manage collections</DialogTitle>
            <DialogDescription>
              Move a project to include all its checkouts and threads.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex min-h-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Collections follow your project sort. Changes sync across devices.
              </p>
              <Button disabled={mutationDisabled} onClick={beginCreate}>
                <PlusIcon aria-hidden /> New collection
              </Button>
            </div>

            {document === null ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Collection settings are unavailable on the connected environments.
              </div>
            ) : (
              <div className="grid min-h-64 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {document.collections.map((collection) => {
                  const collectionProjects = projects.filter(
                    (project) => assignmentByProjectKey.get(projectKey(project)) === collection.id,
                  );
                  return (
                    <section
                      key={collection.id}
                      data-drop-collection-id={collection.id}
                      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/24 p-3"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) =>
                        dropProject(event, { kind: "collection", collectionId: collection.id })
                      }
                    >
                      <header className="flex items-center gap-2">
                        <CollectionVisual visual={collection.visual} />
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {collection.name}
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {countLabel(collectionProjects.length, "project", "projects")}
                        </span>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={`Edit ${collection.name}`}
                          disabled={mutationDisabled}
                          onClick={() => beginEdit(collection)}
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={`Delete ${collection.name}`}
                          disabled={mutationDisabled}
                          onClick={() => {
                            setDeleteConfirmation({
                              collectionId: collection.id,
                              collectionName: collection.name,
                              impact: getProjectCollectionDeletionImpact(document, collection.id),
                            });
                            setDeleteError(null);
                            setPendingAction(null);
                          }}
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </header>
                      <div className="flex flex-col gap-2">
                        {collectionProjects.map(renderProject)}
                      </div>
                      <p className="mt-auto pt-2 text-center text-xs text-muted-foreground">
                        Drop projects here
                      </p>
                    </section>
                  );
                })}
                <section
                  data-drop-kind="unfiled"
                  className="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/24 p-3"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropProject(event, { kind: "unfiled" })}
                >
                  <header className="flex items-center gap-2">
                    <h3 className="flex-1 text-sm font-semibold">Unfiled</h3>
                    <span className="text-xs text-muted-foreground">
                      {countLabel(
                        projects.filter(
                          (project) =>
                            assignmentByProjectKey.get(projectKey(project)) === undefined,
                        ).length,
                        "project",
                        "projects",
                      )}
                    </span>
                  </header>
                  <div className="flex flex-col gap-2">
                    {projects
                      .filter(
                        (project) => assignmentByProjectKey.get(projectKey(project)) === undefined,
                      )
                      .map(renderProject)}
                  </div>
                  <p className="mt-auto pt-2 text-center text-xs text-muted-foreground">
                    Projects without a collection appear here
                  </p>
                </section>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
              <span className={cn("text-sm", view.phase === "not-saved" && "text-destructive")}>
                {statusMessage}
              </span>
              {(view.phase === "not-saved" || view.phase === "partial") && (
                <Button size="compact" variant="outline" onClick={view.retry}>
                  Retry
                </Button>
              )}
              {(view.mismatchEnvironmentIds.length > 0 || view.phase === "partial") && (
                <Button size="compact" variant="outline" onClick={view.useThisLayoutEverywhere}>
                  Use this layout everywhere
                </Button>
              )}
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {pendingAction?.kind === "move" && isUnsettled ? statusMessage : moveFeedback}
            </p>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={editor !== null}
        onOpenChange={(next) => {
          if (!next && pendingAction?.kind !== "editor") setEditor(null);
        }}
      >
        <DialogPopup className="w-full sm:w-[28rem]">
          <form onSubmit={submitEditor}>
            <DialogHeader>
              <DialogTitle>
                {editor?.kind === "edit" ? "Edit collection" : "New collection"}
              </DialogTitle>
              <DialogDescription>
                Name and icon appear on all your connected devices.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Name
                <Input
                  aria-label="Collection name"
                  autoFocus
                  maxLength={80}
                  value={editor?.name ?? ""}
                  onChange={(event) => {
                    if (editor === null) return;
                    setEditor({ ...editor, name: event.currentTarget.value });
                    setEditorError(null);
                  }}
                />
              </label>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  {editor === null ? null : <CollectionVisual visual={editor.visual} />}
                  <span className="text-sm">Collection icon</span>
                </div>
                <Button variant="outline" onClick={() => setIconPickerOpen(true)}>
                  Choose icon
                </Button>
              </div>
              {editorError === null ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {editorError.message}
                </p>
              )}
              {pendingAction?.kind === "editor" && isUnsettled ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted-foreground">{statusMessage}</p>
                  {(view.phase === "not-saved" || view.phase === "partial") && (
                    <Button size="compact" variant="outline" onClick={view.retry}>
                      Retry
                    </Button>
                  )}
                  {view.phase === "partial" && (
                    <Button size="compact" variant="outline" onClick={view.useThisLayoutEverywhere}>
                      Use this layout everywhere
                    </Button>
                  )}
                </div>
              ) : null}
            </DialogPanel>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pendingAction?.kind === "editor"}
                onClick={() => setEditor(null)}
              >
                Cancel
              </Button>
              <Button disabled={!view.canMutate || pendingAction !== null} type="submit">
                {editor?.kind === "edit" ? "Save collection" : "Create collection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <ProjectCollectionIconPickerDialog
        current={editor?.visual ?? null}
        open={iconPickerOpen}
        onOpenChange={setIconPickerOpen}
        onSelect={(visual) => {
          setEditor((current) => (current === null ? null : { ...current, visual }));
          setEditorError(null);
        }}
      />

      <AlertDialog
        open={deleteConfirmation !== null}
        onOpenChange={(next) => {
          if (!next && pendingAction?.kind !== "delete") {
            setDeleteConfirmation(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteConfirmation?.collectionName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmation === null
                ? "Its projects will move to Unfiled."
                : `${countLabel(deleteConfirmation.impact.projectCount, "project", "projects")} will move to Unfiled. `}
              No projects or threads will be deleted.
            </AlertDialogDescription>
            {deleteError === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {deleteError.message}
              </p>
            )}
            {pendingAction?.kind === "delete" && isUnsettled ? (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span>{statusMessage}</span>
                {(view.phase === "not-saved" || view.phase === "partial") && (
                  <Button size="compact" variant="outline" onClick={view.retry}>
                    Retry
                  </Button>
                )}
                {view.phase === "partial" && (
                  <Button size="compact" variant="outline" onClick={view.useThisLayoutEverywhere}>
                    Use this layout everywhere
                  </Button>
                )}
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={pendingAction?.kind === "delete"}
              onClick={() => {
                setDeleteConfirmation(null);
                setDeleteError(null);
              }}
            >
              Cancel deletion
            </Button>
            <Button
              variant="destructive"
              disabled={!view.canMutate || pendingAction !== null}
              onClick={() => {
                if (document === null || deleteConfirmation === null) return;
                const result = deleteProjectCollection(document, deleteConfirmation.collectionId);
                if (!result.ok) {
                  setDeleteError(result.error);
                  return;
                }
                setDeleteError(null);
                submitDocument(
                  result.value,
                  { kind: "delete", document: result.value },
                  setDeleteError,
                );
              }}
            >
              Delete collection
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
