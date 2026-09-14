import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  deriveProjectCollectionProjectKey,
  moveCollectionProject,
  unfileCollectionProject,
  type ProjectCollectionIdentityInput,
  type ProjectCollectionMutationError,
  type ProjectCollectionProjectKeyCandidate,
  type ProjectCollectionScope,
} from "@t3tools/client-runtime/state/project-collections";
import type { ProjectCollectionId, ProjectCollectionsDocument } from "@t3tools/contracts/settings";

export interface ProjectCollectionMoveImpact {
  readonly checkoutCount: number;
  readonly threadCount: number;
}

export type ProjectCollectionMoveDestination =
  | { readonly kind: "collection"; readonly collectionId: ProjectCollectionId }
  | { readonly kind: "unfiled" };

interface ProjectCollectionMovePlanBase {
  readonly document: ProjectCollectionsDocument;
  readonly projectKey: ProjectCollectionProjectKeyCandidate;
  readonly activeScope: ProjectCollectionScope;
  readonly destination: ProjectCollectionMoveDestination;
  readonly feedback: string;
}

export type ProjectCollectionMovePlan =
  | (ProjectCollectionMovePlanBase & { readonly kind: "mutation" })
  | (ProjectCollectionMovePlanBase & {
      readonly kind: "noop";
      readonly reason: "already-in-destination" | "already-unfiled";
    })
  | (ProjectCollectionMovePlanBase & {
      readonly kind: "rejected";
      readonly reason: "stale-destination" | "invalid-mutation";
      readonly error?: ProjectCollectionMutationError;
    });

export interface ProjectCollectionMoveInput<TProject extends EnvironmentProject> {
  readonly document: ProjectCollectionsDocument;
  readonly identity: ProjectCollectionIdentityInput<TProject>;
  readonly activeScope: ProjectCollectionScope;
  readonly destination: ProjectCollectionMoveDestination;
  readonly impact: ProjectCollectionMoveImpact;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function moveFeedback(impact: ProjectCollectionMoveImpact, destinationLabel: string): string {
  return `Moved ${countLabel(impact.checkoutCount, "checkout", "checkouts")} and ${countLabel(impact.threadCount, "thread", "threads")} to ${destinationLabel}.`;
}

function currentAssignment(
  document: ProjectCollectionsDocument,
  projectKey: ProjectCollectionProjectKeyCandidate,
) {
  return document.assignments.find((assignment) => assignment.projectKey === projectKey);
}

/**
 * Plans the complete next collection document for both pointer and explicit
 * move paths. Identity is derived from the whole collection project so a
 * rendered row or thread identifier can never become persisted membership.
 */
export function planProjectCollectionMove<TProject extends EnvironmentProject>(
  input: ProjectCollectionMoveInput<TProject>,
): ProjectCollectionMovePlan {
  const projectKey = deriveProjectCollectionProjectKey(input.identity);
  const assignment = currentAssignment(input.document, projectKey);
  const destinationCollectionId =
    input.destination.kind === "collection" ? input.destination.collectionId : null;
  const destinationCollection =
    destinationCollectionId !== null
      ? input.document.collections.find(
          (collection) => collection.id.toLowerCase() === destinationCollectionId.toLowerCase(),
        )
      : null;

  if (destinationCollectionId !== null && destinationCollection === undefined) {
    return {
      kind: "rejected",
      reason: "stale-destination",
      document: input.document,
      projectKey,
      activeScope: input.activeScope,
      destination: input.destination,
      feedback: "That collection no longer exists. Refresh and choose another destination.",
    };
  }

  const destinationLabel = destinationCollection?.name ?? "Unfiled";
  if (
    destinationCollectionId !== null &&
    assignment?.collectionId.toLowerCase() === destinationCollectionId.toLowerCase()
  ) {
    return {
      kind: "noop",
      reason: "already-in-destination",
      document: input.document,
      projectKey,
      activeScope: input.activeScope,
      destination: input.destination,
      feedback: `Already in ${destinationLabel}. No changes made.`,
    };
  }
  if (input.destination.kind === "unfiled" && assignment === undefined) {
    return {
      kind: "noop",
      reason: "already-unfiled",
      document: input.document,
      projectKey,
      activeScope: input.activeScope,
      destination: input.destination,
      feedback: "Already Unfiled. No changes made.",
    };
  }

  const mutation =
    input.destination.kind === "collection"
      ? moveCollectionProject(input.document, projectKey, input.destination.collectionId)
      : unfileCollectionProject(input.document, projectKey);
  if (!mutation.ok) {
    return {
      kind: "rejected",
      reason:
        mutation.error.code === "dangling-collection" ? "stale-destination" : "invalid-mutation",
      error: mutation.error,
      document: input.document,
      projectKey,
      activeScope: input.activeScope,
      destination: input.destination,
      feedback:
        mutation.error.code === "dangling-collection"
          ? "That collection no longer exists. Refresh and choose another destination."
          : mutation.error.message,
    };
  }

  return {
    kind: "mutation",
    document: mutation.value,
    projectKey,
    activeScope: input.activeScope,
    destination: input.destination,
    feedback: moveFeedback(input.impact, destinationLabel),
  };
}

export function planSidebarProjectCollectionDrop<TProject extends EnvironmentProject>(
  input: ProjectCollectionMoveInput<TProject>,
): ProjectCollectionMovePlan {
  return planProjectCollectionMove(input);
}
