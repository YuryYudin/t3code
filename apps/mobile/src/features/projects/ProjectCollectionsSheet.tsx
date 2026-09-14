import {
  createProjectCollection,
  deleteProjectCollection,
  getProjectCollectionDeletionImpact,
  moveCollectionProject,
  renameProjectCollection,
  styleProjectCollection,
  unfileCollectionProject,
  type ProjectCollectionMutationResult,
} from "@t3tools/client-runtime/state/project-collections";
import { ProjectIconColor, type EnvironmentId } from "@t3tools/contracts";
import {
  PROJECT_COLLECTION_ICON_NAMES,
  type ProjectCollection,
  type ProjectCollectionIconName,
  type ProjectCollectionId,
  type ProjectCollectionProjectKey,
  type ProjectCollectionsDocument,
  type ProjectCollectionVisual,
} from "@t3tools/contracts/settings";
import type {
  ProjectCollectionsSyncPhase,
  ProjectCollectionsSyncStatus,
} from "@t3tools/client-runtime/state/project-collections-sync";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ProjectCollectionIcon } from "../../components/ProjectCollectionIcon";
import { uuidv4 } from "../../lib/uuid";

export interface ProjectCollectionsSheetSync {
  readonly document: ProjectCollectionsDocument | null;
  readonly rejectedCandidate: ProjectCollectionsDocument | null;
  readonly phase: ProjectCollectionsSyncPhase;
  readonly status: ProjectCollectionsSyncStatus;
  readonly mismatchEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly canMutate: boolean;
  readonly save: (
    document: ProjectCollectionsDocument,
  ) => ProjectCollectionMutationResult<ProjectCollectionsDocument>;
  readonly retry: () => void;
  readonly useThisLayoutEverywhere: () => void;
}

export interface ProjectCollectionsSheetProject {
  /** Stable A4 collection-project identity, derived before rendering this sheet. */
  readonly projectKey: ProjectCollectionProjectKey;
  readonly label: string;
  /** Number of visible workspaces/checkouts represented by this stable project. */
  readonly workspaceCount: number;
}

export interface ProjectCollectionsSheetProps {
  /** Structurally accepts the dedicated acknowledged mobile collections hook result. */
  readonly sync: ProjectCollectionsSheetSync;
  readonly projects: ReadonlyArray<ProjectCollectionsSheetProject>;
  readonly onClose: () => void;
  /** Injectable for deterministic native interaction tests. */
  readonly createCollectionId?: () => ProjectCollectionId;
}

export type ProjectCollectionEditor =
  | {
      readonly kind: "create";
      readonly name: string;
      readonly visual: ProjectCollectionVisual;
    }
  | {
      readonly kind: "edit";
      readonly collectionId: ProjectCollectionId;
      readonly name: string;
      readonly visual: ProjectCollectionVisual;
    };

const DEFAULT_COLLECTION_VISUAL = {
  kind: "lucide",
  name: "briefcase",
  color: "blue",
} as const satisfies ProjectCollectionVisual;

export interface ProjectCollectionsSheetLocalState {
  readonly editor: ProjectCollectionEditor | null;
  readonly movingProjectKey: ProjectCollectionProjectKey | null;
  readonly deletingCollectionId: ProjectCollectionId | null;
  readonly error: string | null;
}

export function createProjectCollectionsSheetLocalState(): ProjectCollectionsSheetLocalState {
  return {
    editor: null,
    movingProjectKey: null,
    deletingCollectionId: null,
    error: null,
  };
}

export function reconcileProjectCollectionsSheetLocalState(
  state: ProjectCollectionsSheetLocalState,
  document: ProjectCollectionsDocument | null,
  projects: ReadonlyArray<ProjectCollectionsSheetProject>,
): ProjectCollectionsSheetLocalState {
  const movingProjectKey =
    document !== null &&
    state.movingProjectKey !== null &&
    projects.some((project) => project.projectKey === state.movingProjectKey)
      ? state.movingProjectKey
      : null;
  const deletingCollectionId =
    state.deletingCollectionId !== null &&
    document?.collections.some((collection) => collection.id === state.deletingCollectionId)
      ? state.deletingCollectionId
      : null;
  const editedCollectionId = state.editor?.kind === "edit" ? state.editor.collectionId : null;
  const editor =
    document === null ||
    (editedCollectionId !== null &&
      !document.collections.some((collection) => collection.id === editedCollectionId))
      ? null
      : state.editor;
  if (
    movingProjectKey === state.movingProjectKey &&
    deletingCollectionId === state.deletingCollectionId &&
    editor === state.editor
  ) {
    return state;
  }
  return {
    ...state,
    editor,
    movingProjectKey,
    deletingCollectionId,
    error: null,
  };
}

function Action(props: {
  readonly label: string;
  readonly testID: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      className={
        props.danger
          ? "min-h-[48px] items-center justify-center rounded-2xl border border-danger-border bg-danger px-4 py-3 disabled:opacity-[0.45]"
          : "min-h-[48px] items-center justify-center rounded-2xl border border-secondary-border bg-secondary px-4 py-3 disabled:opacity-[0.45]"
      }
      disabled={props.disabled}
      onPress={props.onPress}
      testID={props.testID}
    >
      <Text
        className={
          props.danger
            ? "text-sm font-t3-bold text-danger-foreground"
            : "text-sm font-t3-bold text-secondary-foreground"
        }
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function statusDescription(sync: ProjectCollectionsSheetSync): string | null {
  if (sync.phase === "saving-reference") return "Saving to the reference environment…";
  if (sync.phase === "saving-secondaries") return "Updating the remaining environments…";
  if (sync.phase === "not-saved" && sync.rejectedCandidate !== null) {
    return "Your attempted layout is ready to retry.";
  }
  if (sync.phase === "partial") return "The reference saved, but some environments need retrying.";
  return null;
}

function CollectionSyncStatus(props: { readonly sync: ProjectCollectionsSheetSync }) {
  const description = statusDescription(props.sync);
  const message = props.sync.status.message;
  const showRetry =
    (props.sync.phase === "not-saved" && props.sync.rejectedCandidate !== null) ||
    props.sync.phase === "partial";
  const showReconcile = props.sync.mismatchEnvironmentIds.length > 0;
  if (message === null && description === null && !showReconcile) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={props.sync.phase === "not-saved" ? "alert" : undefined}
      className="gap-2 rounded-[18px] border border-border bg-card px-4 py-3"
      testID="collection-sync-status"
    >
      {message ? <Text className="text-sm font-t3-bold text-foreground">{message}</Text> : null}
      {description ? (
        <Text className="text-sm leading-normal text-foreground-muted">{description}</Text>
      ) : null}
      {showRetry ? (
        <Action
          label={props.sync.phase === "partial" ? "Retry failed saves" : "Retry save"}
          testID="retry-collection-save"
          onPress={props.sync.retry}
        />
      ) : null}
      {showReconcile ? (
        <Action
          label="Use this layout everywhere"
          testID="use-layout-everywhere"
          onPress={props.sync.useThisLayoutEverywhere}
        />
      ) : null}
    </View>
  );
}

function Selection(props: {
  readonly label: string;
  readonly testID: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly children?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.checked, disabled: props.disabled }}
      className={
        props.checked
          ? "min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-primary bg-primary/10 px-3 py-2"
          : "min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-border bg-card px-3 py-2"
      }
      disabled={props.disabled}
      onPress={props.onPress}
      testID={props.testID}
    >
      {props.children ?? <Text className="text-sm text-foreground">{props.label}</Text>}
    </Pressable>
  );
}

function CollectionEditorForm(props: {
  readonly editor: ProjectCollectionEditor;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onChange: (editor: ProjectCollectionEditor) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}) {
  const visual = props.editor.visual;
  const lucideVisual = visual.kind === "lucide" ? visual : DEFAULT_COLLECTION_VISUAL;
  return (
    <View
      className="gap-4 rounded-[24px] border border-border bg-card p-4"
      testID="collection-editor"
    >
      <Text className="text-lg font-t3-bold text-foreground">
        {props.editor.kind === "create" ? "New collection" : "Edit collection"}
      </Text>
      <TextInput
        accessibilityLabel="Collection name"
        editable={!props.disabled}
        onChangeText={(name) => props.onChange({ ...props.editor, name })}
        placeholder="Collection name"
        testID="collection-name"
        value={props.editor.name}
      />

      <View className="gap-2">
        <Text className="text-sm font-t3-medium text-foreground-muted">Style</Text>
        <View className="flex-row gap-2">
          <Selection
            checked={visual.kind === "lucide"}
            disabled={props.disabled}
            label="Icon and color"
            onPress={() => props.onChange({ ...props.editor, visual: lucideVisual })}
            testID="collection-style-lucide"
          />
          <Selection
            checked={visual.kind === "emoji"}
            disabled={props.disabled}
            label="Emoji"
            onPress={() =>
              props.onChange({
                ...props.editor,
                visual: visual.kind === "emoji" ? visual : { kind: "emoji", emoji: "📁" },
              })
            }
            testID="collection-style-emoji"
          />
        </View>
      </View>

      {visual.kind === "emoji" ? (
        <TextInput
          accessibilityLabel="Collection emoji"
          editable={!props.disabled}
          onChangeText={(emoji) =>
            props.onChange({
              ...props.editor,
              visual: { kind: "emoji", emoji } as ProjectCollectionVisual,
            })
          }
          placeholder="One emoji"
          testID="collection-emoji"
          value={visual.emoji}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            accessibilityLabel="Collection icons"
            contentContainerClassName="gap-2"
            showsHorizontalScrollIndicator={false}
          >
            {PROJECT_COLLECTION_ICON_NAMES.map((name) => (
              <Selection
                key={name}
                checked={visual.name === name}
                disabled={props.disabled}
                label={`${name} icon`}
                onPress={() =>
                  props.onChange({
                    ...props.editor,
                    visual: { ...visual, name: name as ProjectCollectionIconName },
                  })
                }
                testID={`collection-icon-${name}`}
              >
                <ProjectCollectionIcon
                  accessibilityLabel={`${name} icon`}
                  size={20}
                  visual={{ ...visual, name }}
                />
              </Selection>
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            accessibilityLabel="Collection colors"
            contentContainerClassName="gap-2"
            showsHorizontalScrollIndicator={false}
          >
            {ProjectIconColor.literals.map((color) => (
              <Selection
                key={color}
                checked={visual.color === color}
                disabled={props.disabled}
                label={`${color} color`}
                onPress={() => props.onChange({ ...props.editor, visual: { ...visual, color } })}
                testID={`collection-color-${color}`}
              >
                <ProjectCollectionIcon
                  accessibilityLabel={`${color} color`}
                  size={20}
                  visual={{ ...visual, color }}
                />
              </Selection>
            ))}
          </ScrollView>
        </>
      )}

      {props.error ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          className="text-sm text-danger-foreground"
          testID="collection-error"
        >
          {props.error}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Action label="Cancel" testID="cancel-collection-edit" onPress={props.onCancel} />
        </View>
        <View className="flex-1">
          <Action
            disabled={props.disabled}
            label="Save"
            testID="save-collection"
            onPress={props.onSave}
          />
        </View>
      </View>
    </View>
  );
}

function workspaceImpact(count: number): string {
  if (count === 1) return "This workspace or checkout moves as one project.";
  return `${count} workspaces and checkouts move together.`;
}

export interface ProjectCollectionsSheetViewProps extends ProjectCollectionsSheetProps {
  readonly localState: ProjectCollectionsSheetLocalState;
  readonly onLocalStateChange: Dispatch<SetStateAction<ProjectCollectionsSheetLocalState>>;
}

export function ProjectCollectionsSheetView(props: ProjectCollectionsSheetViewProps) {
  const insets = useSafeAreaInsets();
  const { editor, movingProjectKey, deletingCollectionId, error } = props.localState;
  const updateLocalState = (patch: Partial<ProjectCollectionsSheetLocalState>) => {
    props.onLocalStateChange((current) => ({ ...current, ...patch }));
  };
  const setEditor = (value: ProjectCollectionEditor | null) => updateLocalState({ editor: value });
  const setMovingProjectKey = (value: ProjectCollectionProjectKey | null) =>
    updateLocalState({ movingProjectKey: value });
  const setDeletingCollectionId = (value: ProjectCollectionId | null) =>
    updateLocalState({ deletingCollectionId: value });
  const setError = (value: string | null) => updateLocalState({ error: value });
  const document = props.sync.document;
  const movingProject =
    document === null
      ? undefined
      : props.projects.find((project) => project.projectKey === movingProjectKey);
  const deletingCollection = document?.collections.find(
    (collection) => collection.id === deletingCollectionId,
  );
  const busy = props.sync.phase === "saving-reference" || props.sync.phase === "saving-secondaries";
  const editable = props.sync.canMutate && !busy && props.sync.phase !== "not-saved";
  const modalOpen = movingProject !== undefined || deletingCollection !== undefined;
  const backgroundEditable = editable && !modalOpen;

  const persist = (
    result: ProjectCollectionMutationResult<ProjectCollectionsDocument>,
    onAccepted: () => void,
  ) => {
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const saveResult = props.sync.save(result.value);
    if (!saveResult.ok) {
      setError(saveResult.error.message);
      return;
    }
    setError(null);
    onAccepted();
  };

  const saveEditor = () => {
    if (document === null || editor === null) return;
    if (editor.kind === "create") {
      const id = props.createCollectionId?.() ?? (uuidv4() as ProjectCollectionId);
      persist(
        createProjectCollection(document, {
          id,
          name: editor.name,
          visual: editor.visual,
        } as ProjectCollection),
        () => setEditor(null),
      );
      return;
    }
    const renamed = renameProjectCollection(document, editor.collectionId, editor.name);
    if (!renamed.ok) {
      setError(renamed.error.message);
      return;
    }
    persist(styleProjectCollection(renamed.value, editor.collectionId, editor.visual), () =>
      setEditor(null),
    );
  };

  const deletionImpact =
    document !== null && deletingCollectionId !== null
      ? getProjectCollectionDeletionImpact(document, deletingCollectionId)
      : null;

  return (
    <View collapsable={false} className="flex-1 bg-sheet" testID="project-collections-sheet">
      <View
        accessibilityElementsHidden={modalOpen && Platform.OS === "ios"}
        className="flex-1"
        importantForAccessibility={
          modalOpen && Platform.OS === "android" ? "no-hide-descendants" : "auto"
        }
        testID="collections-background"
      >
        <View className="flex-row items-center justify-between border-b border-border px-5 py-3">
          <Text accessibilityRole="header" className="text-xl font-t3-bold text-foreground">
            Collections
          </Text>
          <Action label="Done" testID="close-collections" onPress={props.onClose} />
        </View>
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-4 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
          showsVerticalScrollIndicator={false}
        >
          <CollectionSyncStatus sync={props.sync} />

          {document === null ? (
            <View className="gap-2 rounded-[18px] border border-border bg-card px-4 py-4">
              <Text className="text-base font-t3-bold text-foreground">
                Collections unavailable
              </Text>
              <Text className="text-sm leading-normal text-foreground-muted">
                Connect to a collection-capable environment to view or edit this layout.
              </Text>
            </View>
          ) : (
            <>
              {editor ? (
                <CollectionEditorForm
                  disabled={!backgroundEditable}
                  editor={editor}
                  error={error}
                  onCancel={() => {
                    setEditor(null);
                    setError(null);
                  }}
                  onChange={(next) => {
                    setEditor(next);
                    setError(null);
                  }}
                  onSave={saveEditor}
                />
              ) : (
                <Action
                  disabled={!backgroundEditable}
                  label="Create collection"
                  testID="create-collection"
                  onPress={() => {
                    setEditor({ kind: "create", name: "", visual: DEFAULT_COLLECTION_VISUAL });
                    setError(null);
                  }}
                />
              )}

              <View className="gap-2">
                <Text className="px-1 text-sm font-t3-medium text-foreground-muted">
                  Named collections
                </Text>
                {document.collections.length === 0 ? (
                  <Text className="rounded-[18px] border border-border bg-card px-4 py-4 text-sm text-foreground-muted">
                    No collections yet. Projects currently appear in Unfiled.
                  </Text>
                ) : null}
                {document.collections.map((collection) => {
                  const projectCount = document.assignments.filter(
                    (assignment) => assignment.collectionId === collection.id,
                  ).length;
                  return (
                    <View
                      key={collection.id}
                      className="gap-3 rounded-[18px] border border-border bg-card p-4"
                      testID={`collection-${collection.id}`}
                    >
                      <View className="flex-row items-center gap-3">
                        <ProjectCollectionIcon
                          accessibilityLabel={`${collection.name} collection`}
                          size={22}
                          testID={`collection-visual-${collection.id}`}
                          visual={collection.visual}
                        />
                        <View className="min-w-0 flex-1">
                          <Text className="text-base font-t3-bold text-foreground">
                            {collection.name}
                          </Text>
                          <Text className="text-xs text-foreground-muted">
                            {projectCount} {projectCount === 1 ? "project" : "projects"}
                          </Text>
                        </View>
                      </View>
                      <View className="flex-row gap-2">
                        <View className="flex-1">
                          <Action
                            disabled={!backgroundEditable}
                            label={`Edit ${collection.name}`}
                            testID={`edit-collection-${collection.id}`}
                            onPress={() => {
                              setEditor({
                                kind: "edit",
                                collectionId: collection.id,
                                name: collection.name,
                                visual: collection.visual,
                              });
                              setError(null);
                            }}
                          />
                        </View>
                        <View className="flex-1">
                          <Action
                            danger
                            disabled={!backgroundEditable}
                            label={`Delete ${collection.name}`}
                            testID={`delete-collection-${collection.id}`}
                            onPress={() => {
                              setDeletingCollectionId(collection.id);
                              setError(null);
                            }}
                          />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View className="gap-2">
                <Text className="px-1 text-sm font-t3-medium text-foreground-muted">Projects</Text>
                {props.projects.map((project) => {
                  const assignment = document.assignments.find(
                    (candidate) => candidate.projectKey === project.projectKey,
                  );
                  const collection = document.collections.find(
                    (candidate) => candidate.id === assignment?.collectionId,
                  );
                  return (
                    <View
                      key={project.projectKey}
                      className="gap-3 rounded-[18px] border border-border bg-card p-4"
                      testID={`project-${project.projectKey}`}
                    >
                      <View className="gap-0.5">
                        <Text className="text-base font-t3-bold text-foreground">
                          {project.label}
                        </Text>
                        <Text className="text-xs text-foreground-muted">
                          {collection?.name ?? "Unfiled"} ·{" "}
                          {workspaceImpact(project.workspaceCount)}
                        </Text>
                      </View>
                      <Action
                        disabled={!backgroundEditable}
                        label={`Move ${project.label}`}
                        testID={`move-project-${project.projectKey}`}
                        onPress={() => {
                          setMovingProjectKey(project.projectKey);
                          setError(null);
                        }}
                      />
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      </View>

      {document !== null && movingProject ? (
        <View
          accessibilityViewIsModal
          className="absolute inset-0 justify-end"
          testID="project-destination-modal"
        >
          <Pressable
            accessibilityLabel="Cancel move"
            accessibilityRole="button"
            className="absolute inset-0 bg-black/40"
            onPress={() => {
              setMovingProjectKey(null);
              setError(null);
            }}
            testID="project-destination-backdrop"
          />
          <View
            className="m-3 gap-3 rounded-[24px] border border-border bg-sheet p-4"
            testID="project-destination-sheet"
          >
            <Text accessibilityRole="header" className="text-lg font-t3-bold text-foreground">
              Move {movingProject.label}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {workspaceImpact(movingProject.workspaceCount)}
            </Text>
            {error ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                className="text-sm text-danger-foreground"
                testID="move-collection-error"
              >
                {error}
              </Text>
            ) : null}
            {document.collections.map((collection) => (
              <Action
                key={collection.id}
                disabled={!editable}
                label={collection.name}
                testID={`project-destination-${collection.id}`}
                onPress={() => {
                  const result = moveCollectionProject(
                    document,
                    movingProject.projectKey,
                    collection.id,
                  );
                  if (result.ok && result.value === document) {
                    setMovingProjectKey(null);
                    return;
                  }
                  persist(result, () => setMovingProjectKey(null));
                }}
              />
            ))}
            <Action
              disabled={!editable}
              label="Unfiled"
              testID="project-destination-unfiled"
              onPress={() => {
                const result = unfileCollectionProject(document, movingProject.projectKey);
                if (result.ok && result.value === document) {
                  setMovingProjectKey(null);
                  return;
                }
                persist(result, () => setMovingProjectKey(null));
              }}
            />
            <Action
              label="Cancel move"
              testID="cancel-project-move"
              onPress={() => {
                setMovingProjectKey(null);
                setError(null);
              }}
            />
          </View>
        </View>
      ) : null}

      {document !== null && deletingCollection && deletionImpact ? (
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          className="absolute inset-0 justify-end"
          testID="delete-collection-modal"
        >
          <Pressable
            accessibilityLabel="Cancel deleting collection"
            accessibilityRole="button"
            className="absolute inset-0 bg-black/40"
            onPress={() => {
              setDeletingCollectionId(null);
              setError(null);
            }}
            testID="delete-collection-backdrop"
          />
          <View
            className="m-3 gap-3 rounded-[24px] border border-danger-border bg-sheet p-4"
            testID="delete-collection-confirmation"
          >
            <Text accessibilityRole="header" className="text-lg font-t3-bold text-foreground">
              Delete {deletingCollection.name}?
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              {`${deletionImpact.projectCount} ${deletionImpact.projectCount === 1 ? "project" : "projects"} will become Unfiled. No projects or threads are deleted.`}
            </Text>
            {error ? (
              <Text
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
                className="text-sm text-danger-foreground"
                testID="delete-collection-error"
              >
                {error}
              </Text>
            ) : null}
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Action
                  label="Cancel"
                  testID="cancel-delete-collection"
                  onPress={() => {
                    setDeletingCollectionId(null);
                    setError(null);
                  }}
                />
              </View>
              <View className="flex-1">
                <Action
                  danger
                  disabled={!editable}
                  label="Delete collection"
                  testID="confirm-delete-collection"
                  onPress={() =>
                    persist(deleteProjectCollection(document, deletingCollection.id), () =>
                      setDeletingCollectionId(null),
                    )
                  }
                />
              </View>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function ProjectCollectionsSheet(props: ProjectCollectionsSheetProps) {
  const [localState, setLocalState] = useState(createProjectCollectionsSheetLocalState);
  const reconciledLocalState = reconcileProjectCollectionsSheetLocalState(
    localState,
    props.sync.document,
    props.projects,
  );
  if (reconciledLocalState !== localState) setLocalState(reconciledLocalState);
  return (
    <ProjectCollectionsSheetView
      {...props}
      localState={reconciledLocalState}
      onLocalStateChange={setLocalState}
    />
  );
}
