import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  buildProjectGroups,
  type ProjectGroup,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { expect, test } from "vite-plus/test";

const repositoryIdentity = {
  canonicalKey: "github.com/acme/pockeor",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/acme/pockeor.git",
  },
  rootPath: "/work/pockeor",
  displayName: "PockeoR",
};

function project(
  id: string,
  workspaceRoot: string,
  repository: EnvironmentProject["repositoryIdentity"] = repositoryIdentity,
): EnvironmentProject {
  return {
    environmentId: EnvironmentId.make("environment-a"),
    id: ProjectId.make(id),
    title: id,
    workspaceRoot,
    repositoryIdentity: repository,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function settings(
  sidebarProjectGroupingMode: ProjectGroupingSettings["sidebarProjectGroupingMode"],
): ProjectGroupingSettings {
  return { sidebarProjectGroupingMode, sidebarProjectGroupingOverrides: {} };
}

test("S15: repository-family membership stays stable across grouping modes", async () => {
  // A4 keeps the identity helper internal; A7 owns its package export once
  // the complete collection domain exists.
  const identityModuleUrl = new URL(
    "../../../../packages/client-runtime/src/state/projectCollectionIdentity.ts",
    import.meta.url,
  ).href;
  const identityModule = (await import(identityModuleUrl)) as {
    deriveProjectCollectionProjectKey: (input: {
      group: ProjectGroup;
      projects: readonly EnvironmentProject[];
    }) => string;
  };
  const { deriveProjectCollectionProjectKey } = identityModule;
  const projects = [
    project("stale-pockeor", "/work/pockeor"),
    {
      ...project("pockeor", "/work/pockeor/", null),
      updatedAt: "2026-09-02T00:00:00.000Z",
    },
    project("pockeor-web", "/work/pockeor/apps/web"),
    project("pockeor-worktree", "/worktrees/pockeor-personal", {
      ...repositoryIdentity,
      rootPath: "/worktrees/pockeor-personal",
    }),
    project("scratch", "/work/scratch", null),
  ];

  for (const mode of ["repository", "repository_path", "separate"] as const) {
    const rows = buildProjectGroups({ projects, settings: settings(mode) });
    const movedProjectKey = deriveProjectCollectionProjectKey({ group: rows[0]!, projects });
    expect(movedProjectKey).toBe("repository:github.com/acme/pockeor");
    const personalRows = rows.filter(
      (group) => deriveProjectCollectionProjectKey({ group, projects }) === movedProjectKey,
    );

    expect(
      new Set(
        personalRows.flatMap((group) =>
          group.members.map(({ project: rowProject }) => rowProject.id),
        ),
      ),
    ).toEqual(new Set(["pockeor", "pockeor-web", "pockeor-worktree"]));
    expect(
      personalRows.some((group) =>
        group.members.some(({ project: rowProject }) => rowProject.id === "scratch"),
      ),
    ).toBe(false);
    expect(
      rows.some((group) =>
        group.members.some(({ project: rowProject }) => rowProject.id === "stale-pockeor"),
      ),
    ).toBe(false);
  }
});
