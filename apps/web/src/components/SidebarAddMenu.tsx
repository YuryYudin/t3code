import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { FolderPlusIcon, FoldersIcon, PlusIcon } from "lucide-react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { SidebarMenuButton } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export interface SidebarAddMenuEnvironment {
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: {
        readonly projectCollections?:
          | ExecutionEnvironmentCapabilities["projectCollections"]
          | undefined;
      };
    };
  } | null;
}

export interface SidebarAddMenuProps {
  readonly environment: SidebarAddMenuEnvironment | null;
  readonly onNewProject: () => void;
  readonly onNewCollection: () => void;
  readonly newCollectionDisabled?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

export function SidebarAddMenu({
  environment,
  onNewProject,
  onNewCollection,
  newCollectionDisabled = false,
  open,
  onOpenChange,
}: SidebarAddMenuProps) {
  const supportsProjectCollections =
    environment?.serverConfig?.environment.capabilities.projectCollections === true;

  if (!supportsProjectCollections) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              size="icon"
              className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
              onClick={onNewProject}
              type="button"
              aria-label="New project"
            />
          }
        >
          <FolderPlusIcon />
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipPopup side="right">New project</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <SidebarMenuButton
                  size="icon"
                  className="relative shrink-0 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
                  type="button"
                  aria-label="Add project or collection"
                />
              }
            />
          }
        >
          <FolderPlusIcon />
          <span
            className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipPopup side="right">Add project or collection</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom">
        <MenuItem onClick={onNewProject}>
          <PlusIcon />
          New project
        </MenuItem>
        <MenuItem disabled={newCollectionDisabled} onClick={onNewCollection}>
          <FoldersIcon />
          New collection
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
