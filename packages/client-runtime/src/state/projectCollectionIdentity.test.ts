import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentProject } from "./models.ts";
import { buildProjectGroups, type ProjectGroupingSettings } from "./projectGrouping.ts";
import { deriveProjectCollectionProjectKey } from "./projectCollectionIdentity.ts";

const repositoryIdentity = {
  canonicalKey: "github.com/acme/platform",
  locator: {
    source: "git-remote" as const,
    remoteName: "origin",
    remoteUrl: "https://github.com/acme/platform.git",
  },
  rootPath: "/work/platform",
  provider: "github",
  owner: "acme",
  name: "platform",
  displayName: "Platform",
};

function makeProject(input: {
  environmentId: string;
  id: string;
  workspaceRoot: string;
  repositoryIdentity?: EnvironmentProject["repositoryIdentity"];
}): EnvironmentProject {
  return {
    environmentId: EnvironmentId.make(input.environmentId),
    id: ProjectId.make(input.id),
    title: input.id,
    workspaceRoot: input.workspaceRoot,
    repositoryIdentity:
      input.repositoryIdentity === undefined ? repositoryIdentity : input.repositoryIdentity,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function groupingSettings(
  sidebarProjectGroupingMode: ProjectGroupingSettings["sidebarProjectGroupingMode"],
): ProjectGroupingSettings {
  return { sidebarProjectGroupingMode, sidebarProjectGroupingOverrides: {} };
}

function collectionKeysForGroups(
  projects: readonly EnvironmentProject[],
  mode: ProjectGroupingSettings["sidebarProjectGroupingMode"],
) {
  return buildProjectGroups({ projects, settings: groupingSettings(mode) }).map((group) =>
    deriveProjectCollectionProjectKey({ group, projects }),
  );
}

function collectionKeyForProject(project: EnvironmentProject) {
  const projects = [project];
  const [group] = buildProjectGroups({ projects, settings: groupingSettings("repository") });
  return deriveProjectCollectionProjectKey({ group: group!, projects });
}

describe("deriveProjectCollectionProjectKey", () => {
  it("keeps one repository family identity across repository, path, and separate presentations", () => {
    const projects = [
      makeProject({ environmentId: "mac", id: "root", workspaceRoot: "/work/platform" }),
      makeProject({
        environmentId: "mac",
        id: "web",
        workspaceRoot: "/work/platform/apps/web",
      }),
      makeProject({
        environmentId: "remote",
        id: "feature-worktree",
        workspaceRoot: "/srv/worktrees/platform-feature",
        repositoryIdentity: {
          ...repositoryIdentity,
          rootPath: "/srv/worktrees/platform-feature",
        },
      }),
    ];

    for (const mode of ["repository", "repository_path", "separate"] as const) {
      expect(new Set(collectionKeysForGroups(projects, mode))).toEqual(
        new Set(["repository:github.com/acme/platform"]),
      );
    }
  });

  it("treats paths within a monorepo as one collection project", () => {
    const projects = [
      makeProject({ environmentId: "mac", id: "root", workspaceRoot: "/work/platform" }),
      makeProject({
        environmentId: "mac",
        id: "api",
        workspaceRoot: "/work/platform/packages/api",
      }),
      makeProject({
        environmentId: "mac",
        id: "web",
        workspaceRoot: "/work/platform/apps/web",
      }),
    ];

    expect(collectionKeysForGroups(projects, "repository_path")).toEqual([
      "repository:github.com/acme/platform",
      "repository:github.com/acme/platform",
      "repository:github.com/acme/platform",
    ]);
  });

  it("uses immutable environment and normalized workspace root for non-repository projects", () => {
    const projects = [
      makeProject({
        environmentId: "mac",
        id: "notes",
        workspaceRoot: "/Users/dev/notes/",
        repositoryIdentity: null,
      }),
      makeProject({
        environmentId: "remote",
        id: "notes-copy",
        workspaceRoot: "/Users/dev/notes",
        repositoryIdentity: null,
      }),
      makeProject({
        environmentId: "windows",
        id: "windows-notes",
        workspaceRoot: "C:/Users/Dev/Notes/",
        repositoryIdentity: null,
      }),
    ];

    expect(collectionKeysForGroups(projects, "repository")).toEqual([
      'physical:["mac","/Users/dev/notes"]',
      'physical:["remote","/Users/dev/notes"]',
      'physical:["windows","c:\\\\users\\\\dev\\\\notes"]',
    ]);
  });

  it("recovers repository identity when a fresher duplicate registration lacks it", () => {
    const identified = makeProject({
      environmentId: "mac",
      id: "identified",
      workspaceRoot: "/work/platform",
    });
    const freshUnidentified = {
      ...makeProject({
        environmentId: "mac",
        id: "fresh",
        workspaceRoot: "/work/platform/",
        repositoryIdentity: null,
      }),
      updatedAt: "2026-09-02T00:00:00.000Z",
    };
    const sibling = makeProject({
      environmentId: "remote",
      id: "sibling",
      workspaceRoot: "/srv/platform",
      repositoryIdentity: { ...repositoryIdentity, rootPath: "/srv/platform" },
    });
    const projects = [identified, freshUnidentified, sibling];

    for (const mode of ["repository", "repository_path", "separate"] as const) {
      const groups = buildProjectGroups({ projects, settings: groupingSettings(mode) });
      expect(groups.some((group) => group.representative.id === "fresh")).toBe(true);
      expect(
        new Set(groups.map((group) => deriveProjectCollectionProjectKey({ group, projects }))),
      ).toEqual(new Set(["repository:github.com/acme/platform"]));
    }
  });

  it.each([
    {
      name: "newer valid updatedAt",
      firstId: "first",
      firstUpdatedAt: "2026-09-01T00:00:00.000Z",
      firstCreatedAt: "2026-08-01T00:00:00.000Z",
      secondId: "second",
      secondUpdatedAt: "2026-09-02T00:00:00.000Z",
      secondCreatedAt: "2026-08-02T00:00:00.000Z",
    },
    {
      name: "createdAt when updatedAt is invalid",
      firstId: "first",
      firstUpdatedAt: "invalid",
      firstCreatedAt: "2026-09-01T00:00:00.000Z",
      secondId: "second",
      secondUpdatedAt: "invalid",
      secondCreatedAt: "2026-09-02T00:00:00.000Z",
    },
    {
      name: "lexically greater ID when freshness is equal",
      firstId: "a-identity",
      firstUpdatedAt: "2026-09-01T00:00:00.000Z",
      firstCreatedAt: "2026-08-01T00:00:00.000Z",
      secondId: "z-identity",
      secondUpdatedAt: "2026-09-01T00:00:00.000Z",
      secondCreatedAt: "2026-08-01T00:00:00.000Z",
    },
  ])("matches grouping's identity winner for $name", (scenario) => {
    const chosenCanonicalKey = `github.com/acme/${scenario.name.replaceAll(" ", "-")}`;
    const first = {
      ...makeProject({
        environmentId: "mac",
        id: scenario.firstId,
        workspaceRoot: "/work/conflicting",
        repositoryIdentity: {
          ...repositoryIdentity,
          canonicalKey: "github.com/acme/not-selected",
        },
      }),
      createdAt: scenario.firstCreatedAt,
      updatedAt: scenario.firstUpdatedAt,
    };
    const second = {
      ...makeProject({
        environmentId: "mac",
        id: scenario.secondId,
        workspaceRoot: "/work/conflicting/",
        repositoryIdentity: { ...repositoryIdentity, canonicalKey: chosenCanonicalKey },
      }),
      createdAt: scenario.secondCreatedAt,
      updatedAt: scenario.secondUpdatedAt,
    };
    const visibleWinner = {
      ...makeProject({
        environmentId: "mac",
        id: "visible-winner",
        workspaceRoot: "/work/conflicting",
        repositoryIdentity: null,
      }),
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const sibling = makeProject({
      environmentId: "remote",
      id: "sibling",
      workspaceRoot: "/srv/conflicting",
      repositoryIdentity: {
        ...repositoryIdentity,
        canonicalKey: chosenCanonicalKey,
        rootPath: "/srv/conflicting",
      },
    });
    const projects = [first, second, visibleWinner, sibling];
    const groups = buildProjectGroups({ projects, settings: groupingSettings("repository") });
    const winnerGroup = groups.find((group) => group.representative.id === "visible-winner");

    expect(winnerGroup?.key).toBe(chosenCanonicalKey);
    expect(deriveProjectCollectionProjectKey({ group: winnerGroup!, projects })).toBe(
      `repository:${chosenCanonicalKey}`,
    );
  });

  it("namespaces repositories and encodes physical identity tuples without delimiter collisions", () => {
    const repository = makeProject({
      environmentId: "elsewhere",
      id: "repository",
      workspaceRoot: "/elsewhere",
      repositoryIdentity: {
        ...repositoryIdentity,
        canonicalKey: "machine:/work",
      },
    });
    const physical = makeProject({
      environmentId: "machine",
      id: "physical",
      workspaceRoot: "/work",
      repositoryIdentity: null,
    });
    const delimiterLeft = makeProject({
      environmentId: "a:b",
      id: "delimiter-left",
      workspaceRoot: "/c",
      repositoryIdentity: null,
    });
    const delimiterRight = makeProject({
      environmentId: "a",
      id: "delimiter-right",
      workspaceRoot: "b:/c",
      repositoryIdentity: null,
    });

    expect(collectionKeyForProject(repository)).toBe("repository:machine:/work");
    expect(collectionKeyForProject(physical)).toBe('physical:["machine","/work"]');
    expect(collectionKeyForProject(repository)).not.toBe(collectionKeyForProject(physical));
    expect(
      buildProjectGroups({
        projects: [repository],
        settings: groupingSettings("repository"),
      })[0]?.key,
    ).toBe("machine:/work");
    expect(
      buildProjectGroups({
        projects: [physical],
        settings: groupingSettings("repository"),
      })[0]?.key,
    ).toBe("machine:/work");
    const collidingProjects = [repository, physical];
    const collidingGroups = buildProjectGroups({
      projects: collidingProjects,
      settings: groupingSettings("repository"),
    });
    expect(collidingGroups).toHaveLength(2);
    expect(new Set(collidingGroups.map((group) => group.key)).size).toBe(2);
    expect(
      new Set(
        collidingGroups.map((group) =>
          deriveProjectCollectionProjectKey({ group, projects: collidingProjects }),
        ),
      ),
    ).toEqual(new Set(['physical:["machine","/work"]', "repository:machine:/work"]));
    expect(
      collidingGroups.map((group) => group.memberProjectRefs.map(({ projectId }) => projectId)),
    ).toEqual([["repository"], ["physical"]]);
    expect(collectionKeyForProject(delimiterLeft)).not.toBe(
      collectionKeyForProject(delimiterRight),
    );
  });

  it("preserves candidates at and beyond the persisted key limit for domain validation", () => {
    const repositoryPrefix = "repository:";
    const atLimitCanonicalKey = "r".repeat(512 - repositoryPrefix.length);
    const overLimitCanonicalKey = `${atLimitCanonicalKey}r`;
    const atLimit = makeProject({
      environmentId: "environment",
      id: "at-limit",
      workspaceRoot: "/work/at-limit",
      repositoryIdentity: { ...repositoryIdentity, canonicalKey: atLimitCanonicalKey },
    });
    const overLimit = makeProject({
      environmentId: "environment",
      id: "over-limit",
      workspaceRoot: "/work/over-limit",
      repositoryIdentity: { ...repositoryIdentity, canonicalKey: overLimitCanonicalKey },
    });

    const atLimitKey = collectionKeyForProject(atLimit);
    expect(atLimitKey).toHaveLength(512);
    expect(atLimitKey).toBe(`${repositoryPrefix}${atLimitCanonicalKey}`);
    expect(() => collectionKeyForProject(overLimit)).not.toThrow();
    expect(collectionKeyForProject(overLimit)).toBe(`${repositoryPrefix}${overLimitCanonicalKey}`);
    expect(collectionKeyForProject(overLimit)).toHaveLength(513);
  });
});
