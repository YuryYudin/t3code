import type { EnvironmentProject } from "./models.ts";
import { derivePhysicalProjectKey, type ProjectGroup } from "./projectGrouping.ts";
import { normalizeProjectPathForComparison } from "./projects.ts";

export interface ProjectCollectionIdentityInput<TProject extends EnvironmentProject> {
  readonly group: Pick<ProjectGroup<TProject>, "members" | "memberProjectRefs">;
  readonly projects: ReadonlyArray<TProject>;
}

export type ProjectCollectionProjectKeyCandidate = string;

function projectFreshnessTime(project: EnvironmentProject): number {
  const updatedAtTime = Date.parse(project.updatedAt);
  if (Number.isFinite(updatedAtTime)) {
    return updatedAtTime;
  }
  const createdAtTime = Date.parse(project.createdAt);
  return Number.isFinite(createdAtTime) ? createdAtTime : 0;
}

function findRepositoryIdentitySource<TProject extends EnvironmentProject>(
  input: ProjectCollectionIdentityInput<TProject>,
  physicalProjectKey: string,
): TProject | null {
  const memberProjectRefs = new Set(
    input.group.memberProjectRefs.map(({ environmentId, projectId }) =>
      JSON.stringify([environmentId, projectId]),
    ),
  );
  let freshestIdentifiedProject: TProject | null = null;
  for (const project of input.projects) {
    if (
      project.repositoryIdentity === null ||
      !memberProjectRefs.has(JSON.stringify([project.environmentId, project.id])) ||
      derivePhysicalProjectKey(project) !== physicalProjectKey
    ) {
      continue;
    }
    if (
      freshestIdentifiedProject === null ||
      projectFreshnessTime(project) > projectFreshnessTime(freshestIdentifiedProject) ||
      (projectFreshnessTime(project) === projectFreshnessTime(freshestIdentifiedProject) &&
        project.id > freshestIdentifiedProject.id)
    ) {
      freshestIdentifiedProject = project;
    }
  }
  return freshestIdentifiedProject;
}

/**
 * Collection membership follows repository identity, never the current
 * sidebar grouping key. Physical environment and path identity is reserved
 * for workspaces that do not belong to a repository. Pass the original
 * project records used to build the group so identity-bearing duplicate
 * registrations remain available when the visible winner lacks identity.
 */
export function deriveProjectCollectionProjectKey<TProject extends EnvironmentProject>(
  input: ProjectCollectionIdentityInput<TProject>,
): ProjectCollectionProjectKeyCandidate {
  const member = input.group.members[0]!;
  const project =
    member.project.repositoryIdentity === null
      ? (findRepositoryIdentitySource(input, member.physicalProjectKey) ?? member.project)
      : member.project;
  const repositoryKey = project.repositoryIdentity?.canonicalKey;
  return repositoryKey === undefined
    ? `physical:${JSON.stringify([
        project.environmentId,
        normalizeProjectPathForComparison(project.workspaceRoot),
      ])}`
    : `repository:${repositoryKey}`;
}
