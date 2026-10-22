import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  deriveProjectCollectionProjectKey,
  type ProjectCollectionIdentityInput,
  type ProjectCollectionScope,
} from "@t3tools/client-runtime/state/project-collections";
import type { ProjectCollectionsDocument } from "@t3tools/contracts/settings";
import { CheckIcon, FolderMinusIcon, MoveRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/menu";
import {
  planProjectCollectionMove,
  type ProjectCollectionMoveImpact,
  type ProjectCollectionMovePlan,
} from "./Sidebar.projectCollectionsDrag";

export interface ProjectCollectionMoveMenuProps<TProject extends EnvironmentProject> {
  readonly document: ProjectCollectionsDocument;
  readonly identity: ProjectCollectionIdentityInput<TProject>;
  readonly activeScope: ProjectCollectionScope;
  readonly projectLabel: string;
  readonly impact: ProjectCollectionMoveImpact;
  readonly onPlan: (plan: ProjectCollectionMovePlan) => void;
  readonly trigger?: ReactNode;
  readonly triggerSize?: "compact" | "icon-xs";
  readonly disabled?: boolean;
}

export function ProjectCollectionMoveMenu<TProject extends EnvironmentProject>({
  document,
  identity,
  activeScope,
  projectLabel,
  impact,
  onPlan,
  trigger,
  triggerSize = "compact",
  disabled = false,
}: ProjectCollectionMoveMenuProps<TProject>) {
  const [feedback, setFeedback] = useState("");
  const projectKey = deriveProjectCollectionProjectKey(identity);
  const currentCollectionId = document.assignments.find(
    (assignment) => assignment.projectKey === projectKey,
  )?.collectionId;

  const choose = (
    destination: Parameters<typeof planProjectCollectionMove<TProject>>[0]["destination"],
  ) => {
    const plan = planProjectCollectionMove({
      document,
      identity,
      activeScope,
      destination,
      impact,
    });
    setFeedback(plan.feedback);
    onPlan(plan);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Move ${projectLabel} to a collection`}
          render={<Button variant="ghost" size={triggerSize} />}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {trigger ?? (
            <>
              <MoveRightIcon aria-hidden className="size-4" />
              Move {projectLabel}
            </>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label={`Move ${projectLabel}`} className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to collection</DropdownMenuLabel>
            {document.collections.map((collection) => {
              const current = currentCollectionId?.toLowerCase() === collection.id.toLowerCase();
              return (
                <DropdownMenuItem
                  key={collection.id}
                  aria-current={current ? "true" : undefined}
                  data-collection-id={collection.id}
                  onClick={() => choose({ kind: "collection", collectionId: collection.id })}
                >
                  <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                  {current ? <CheckIcon aria-hidden className="size-3.5" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            aria-current={currentCollectionId === undefined ? "true" : undefined}
            onClick={() => choose({ kind: "unfiled" })}
          >
            <FolderMinusIcon aria-hidden className="size-4" />
            <span>Remove from collection</span>
            {currentCollectionId === undefined ? (
              <CheckIcon aria-hidden className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="sr-only" role="status" aria-live="polite">
        {feedback}
      </p>
    </>
  );
}
