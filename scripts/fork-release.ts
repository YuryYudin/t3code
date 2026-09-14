#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  FAILURE_CLASSES,
  FORK_REPOSITORY,
  INCIDENT_MODES,
  allocateForkVersion,
  assertAbsoluteStateDirectory,
  assertFullSha,
  atomicWriteJson,
  collectReleaseEvidence,
  failureCommandId,
  incidentKey,
  incidentMarker,
  incidentThreadId,
  isIncidentRecoverable,
  normalizeStableVersion,
  outboxRecordId,
  publishedReleaseVersions,
  readJsonFile,
  recoveryCommandId,
  requiredReleaseAssets,
  sha256File,
  targetIdentity,
  validateBootstrap,
  verifyBootstrapPatch,
  type FailureClass,
  type ForkAction,
  type ForkReleaseBootstrap,
  type IncidentMode,
  type IncidentRecord,
} from "./lib/fork-release.ts";

interface ParsedArguments {
  readonly command: string;
  readonly positionals: ReadonlyArray<string>;
  readonly flags: ReadonlyMap<string, ReadonlyArray<string>>;
}

function parseArguments(argv: ReadonlyArray<string>): ParsedArguments {
  const [command = "", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const equal = value.indexOf("=");
    const key = value.slice(2, equal === -1 ? undefined : equal);
    const flagValue =
      equal === -1
        ? rest[index + 1]?.startsWith("--") === false
          ? rest[++index]!
          : "true"
        : value.slice(equal + 1);
    flags.set(key, [...(flags.get(key) ?? []), flagValue]);
  }
  return { command, positionals, flags };
}

function flag(args: ParsedArguments, name: string, fallback?: string): string {
  const value = args.flags.get(name)?.at(-1) ?? fallback;
  if (value === undefined || value.length === 0) throw new Error(`Missing --${name}.`);
  return value;
}

function optionalFlag(args: ParsedArguments, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

function booleanFlag(args: ParsedArguments, name: string): boolean {
  const value = optionalFlag(args, name) ?? "false";
  if (value !== "true" && value !== "false") throw new Error(`--${name} must be true or false.`);
  return value === "true";
}

function enumFlag<T extends string>(
  args: ParsedArguments,
  name: string,
  values: ReadonlyArray<T>,
  fallback?: T,
): T {
  const value = flag(args, name, fallback);
  if (!values.includes(value as T))
    throw new Error(`--${name} must be one of ${values.join(", ")}.`);
  return value as T;
}

function run(
  command: string,
  commandArgs: ReadonlyArray<string>,
  options: {
    readonly cwd?: string;
    readonly input?: string | Buffer;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): string {
  const result = NodeChildProcess.spawnSync(command, commandArgs, {
    cwd: options.cwd,
    input: options.input,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout}`.trim().slice(-8_000);
    throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout.trim();
}

function runBuffer(
  command: string,
  commandArgs: ReadonlyArray<string>,
  options: {
    readonly cwd?: string;
  } = {},
): Buffer {
  const result = NodeChildProcess.spawnSync(command, commandArgs, {
    cwd: options.cwd,
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = Buffer.concat([
      result.stderr ?? Buffer.alloc(0),
      result.stdout ?? Buffer.alloc(0),
    ])
      .toString("utf8")
      .trim()
      .slice(-8_000);
    throw new Error(`${command} failed${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout;
}

function git(args: ReadonlyArray<string>, cwd = process.cwd()): string {
  return run("git", args, { cwd });
}

function gitBuffer(args: ReadonlyArray<string>, cwd = process.cwd()): Buffer {
  return runBuffer("git", args, { cwd });
}

function gh(args: ReadonlyArray<string>): string {
  return run("gh", args);
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function resolveCommit(ref: string): string {
  return assertFullSha(git(["rev-parse", "--verify", `${ref}^{commit}`]), `Resolved ref '${ref}'`);
}

function assertLinearRange(range: string): ReadonlyArray<string> {
  const commits = git(["rev-list", "--reverse", range]).split("\n").filter(Boolean);
  for (const commit of commits) {
    const parents = git(["rev-list", "--parents", "-n", "1", commit]).split(" ");
    if (parents.length !== 2)
      throw new Error(`Canonical patch range contains merge commit ${commit}.`);
  }
  return commits;
}

function latestStableTag(): { tag: string; version: string; commit: string } {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").filter(Boolean);
  for (const tag of tags) {
    try {
      const version = normalizeStableVersion(tag);
      return { tag, version, commit: resolveCommit(tag) };
    } catch {
      // Prerelease or unrelated tag.
    }
  }
  throw new Error("No upstream stable tag is available locally.");
}

function githubReleaseVersions(): ReadonlyArray<string> {
  if (!process.env.GITHUB_TOKEN) return [];
  const releases = JSON.parse(
    gh([
      "release",
      "list",
      "--repo",
      FORK_REPOSITORY,
      "--limit",
      "100",
      "--json",
      "tagName,isDraft",
    ]),
  ) as Array<{ readonly tagName: string; readonly isDraft: boolean }>;
  return publishedReleaseVersions(releases);
}

function resolveCommand(args: ParsedArguments): void {
  const action = enumFlag(
    args,
    "action",
    ["auto", "validate-only", "out-of-cycle"] as const,
    "auto",
  ) as ForkAction;
  const mode = enumFlag(args, "mode", INCIDENT_MODES);
  const upstreamRef = optionalFlag(args, "upstream-ref");
  if (upstreamRef && action !== "validate-only") {
    throw new Error("--upstream-ref is accepted only with --action validate-only.");
  }
  const target =
    action === "validate-only" && upstreamRef
      ? { tag: null, version: null, commit: resolveCommit(upstreamRef) }
      : mode === "nightly-integration"
        ? { tag: null, version: null, commit: resolveCommit("upstream/main") }
        : latestStableTag();
  const observedMainSha = resolveCommit("origin/main");
  const bootstrap = readJsonFile<ForkReleaseBootstrap>(
    NodePath.resolve("scripts/fork-release-bootstrap.json"),
  );
  validateBootstrap(bootstrap);
  const firstRelease = !githubReleaseVersions().includes("v0.0.41-1");
  const boundary = firstRelease
    ? bootstrap.stableBase.commit
    : resolveCommit(git(["merge-base", "origin/main", "upstream/main"]));
  const candidateSourceSha = firstRelease
    ? assertFullSha(
        flag(args, "bootstrap-source-sha", process.env.BOOTSTRAP_SOURCE_SHA),
        "Bootstrap source",
      )
    : observedMainSha;
  const releaseVersion =
    mode === "nightly-integration" || target.version === null
      ? null
      : allocateForkVersion({
          upstreamVersion: target.version,
          existingVersions: githubReleaseVersions(),
        });
  const releaseRequired =
    mode === "nightly-integration" || action === "validate-only"
      ? false
      : action === "out-of-cycle" ||
        !githubReleaseVersions().some((value) =>
          value.startsWith(`v${releaseVersion?.replace(/-\d+$/, "-")}`),
        );
  output({
    action,
    mode,
    dryRun: booleanFlag(args, "dry-run"),
    target,
    targetIdentity: targetIdentity(
      mode,
      mode === "nightly-integration"
        ? target.commit
        : mode === "automatic-stable-release"
          ? target.version!
          : candidateSourceSha,
    ),
    observedMainSha,
    coverageBaseSha: target.commit,
    candidateSourceSha,
    firstRelease,
    boundary,
    releaseRequired,
    releaseVersion,
    releaseTag: releaseVersion ? `v${releaseVersion}` : null,
    intendedPatchPaths: bootstrap.paths.map(({ path }) => path),
  });
}

function deterministicCommit(input: {
  readonly tree: string;
  readonly parent: string;
  readonly bootstrap: ForkReleaseBootstrap;
}): string {
  const identity = input.bootstrap.commit;
  return run("git", ["commit-tree", input.tree, "-p", input.parent], {
    input: `${identity.message}\n`,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.authorName,
      GIT_AUTHOR_EMAIL: identity.authorEmail,
      GIT_AUTHOR_DATE: identity.timestamp,
      GIT_COMMITTER_NAME: identity.authorName,
      GIT_COMMITTER_EMAIL: identity.authorEmail,
      GIT_COMMITTER_DATE: identity.timestamp,
    },
  });
}

function replayCommit(
  sourceCommit: string,
  resolutions: ForkReleaseBootstrap["infrastructureReplayResolutions"] = [],
): string {
  const attempt = NodeChildProcess.spawnSync("git", ["cherry-pick", "--no-commit", sourceCommit], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (attempt.status !== 0) {
    const conflicts = git(["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .filter(Boolean)
      .sort();
    const expected = resolutions.map(({ path }) => path).sort();
    if (JSON.stringify(conflicts) !== JSON.stringify(expected)) {
      const detail = `${attempt.stderr || attempt.stdout}`.trim().slice(-8_000);
      throw new Error(
        `Infrastructure replay conflict set was not declared: ${conflicts.join(", ") || detail}`,
      );
    }
    for (const resolution of resolutions) {
      if (resolution.resolution !== "keep-target") {
        throw new Error(`Unsupported replay resolution for '${resolution.path}'.`);
      }
      git(["checkout", "--ours", "--", resolution.path]);
      git(["add", "--", resolution.path]);
    }
    const unresolved = git(["diff", "--name-only", "--diff-filter=U"]);
    if (unresolved) throw new Error(`Infrastructure replay still has conflicts: ${unresolved}.`);
  }

  const parent = resolveCommit("HEAD");
  const tree = git(["write-tree"]);
  const message = git(["show", "-s", "--format=%B", sourceCommit]);
  const replayed = run("git", ["commit-tree", tree, "-p", parent], {
    input: `${message}\n`,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: git(["show", "-s", "--format=%an", sourceCommit]),
      GIT_AUTHOR_EMAIL: git(["show", "-s", "--format=%ae", sourceCommit]),
      GIT_AUTHOR_DATE: git(["show", "-s", "--format=%aI", sourceCommit]),
      GIT_COMMITTER_NAME: git(["show", "-s", "--format=%cn", sourceCommit]),
      GIT_COMMITTER_EMAIL: git(["show", "-s", "--format=%ce", sourceCommit]),
      GIT_COMMITTER_DATE: git(["show", "-s", "--format=%cI", sourceCommit]),
    },
  });
  NodeChildProcess.spawnSync("git", ["cherry-pick", "--quit"]);
  git(["checkout", "--detach", "--force", replayed]);
  return replayed;
}

function prepareCommand(args: ParsedArguments): void {
  if (git(["status", "--porcelain"]))
    throw new Error("prepare requires a clean disposable workspace.");
  const target = resolveCommit(flag(args, "target"));
  const candidateRef = flag(args, "candidate-ref", "refs/heads/fork-release/candidate");
  const firstRelease = booleanFlag(args, "first-release");
  let head: string;
  if (firstRelease) {
    const bootstrapSha = assertFullSha(
      flag(args, "bootstrap-source-sha", process.env.BOOTSTRAP_SOURCE_SHA),
      "Bootstrap source SHA",
    );
    const bootstrapRef = flag(
      args,
      "bootstrap-source-ref",
      process.env.BOOTSTRAP_SOURCE_REF ?? "refs/remotes/origin/bootstrap/0.0.41-1-source",
    );
    if (resolveCommit(bootstrapRef) !== bootstrapSha)
      throw new Error("Protected bootstrap ref does not match its pinned SHA.");
    const configText = git(["show", `${bootstrapSha}:scripts/fork-release-bootstrap.json`]);
    const bootstrap = JSON.parse(configText) as ForkReleaseBootstrap;
    validateBootstrap(bootstrap);
    if (target !== bootstrap.stableBase.commit)
      throw new Error("First release must use the pinned v0.0.40 base.");
    const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-fork-release-"));
    try {
      const patchPath = NodePath.join(temporary, "collections.patch");
      NodeFS.writeFileSync(
        patchPath,
        gitBuffer(["show", `${bootstrapSha}:${bootstrap.patch.path}`]),
      );
      if (sha256File(patchPath) !== bootstrap.patch.sha256)
        throw new Error("Bootstrap patch checksum mismatch.");
      git(["checkout", "--detach", "--force", target]);
      git(["apply", "--index", "--whitespace=error", patchPath]);
      const tree = git(["write-tree"]);
      if (tree !== bootstrap.patch.resultTree)
        throw new Error(`Bootstrap result tree mismatch: ${tree}.`);
      head = deterministicCommit({ tree, parent: target, bootstrap });
      git(["checkout", "--detach", "--force", head]);
      const infrastructureCommits = assertLinearRange(
        `${bootstrap.sourceRange.headInclusive}..${bootstrapSha}`,
      );
      for (const commit of infrastructureCommits) {
        replayCommit(commit, bootstrap.infrastructureReplayResolutions);
      }
      head = resolveCommit("HEAD");
    } finally {
      NodeFS.rmSync(temporary, { recursive: true, force: true });
    }
  } else {
    const source = resolveCommit(flag(args, "source", "origin/main"));
    const boundary = resolveCommit(git(["merge-base", source, "upstream/main"]));
    const commits = assertLinearRange(`${boundary}..${source}`);
    git(["checkout", "--detach", "--force", target]);
    for (const commit of commits) replayCommit(commit);
    head = resolveCommit("HEAD");
  }
  git(["update-ref", candidateRef, head]);
  output({ status: "prepared", candidateSha: head, targetSha: target, candidateRef });
}

interface GitHubIssue {
  readonly number: number;
  readonly state: "OPEN" | "CLOSED";
  readonly body: string;
  readonly title: string;
  readonly url: string;
}

function listIncidentIssues(repository: string, marker: string): ReadonlyArray<GitHubIssue> {
  const issues = JSON.parse(
    gh([
      "issue",
      "list",
      "--repo",
      repository,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,state,body,title,url",
    ]),
  ) as GitHubIssue[];
  return issues.filter(({ body }) => body.includes(marker));
}

interface T3DispatchResult {
  readonly status: number;
  readonly body: string;
}

function dispatchT3(payload: unknown, baseUrl: string, token: string): T3DispatchResult {
  const temporary = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-incident-"));
  try {
    const payloadPath = NodePath.join(temporary, "payload.json");
    const responsePath = NodePath.join(temporary, "response.json");
    NodeFS.writeFileSync(payloadPath, JSON.stringify(payload), { mode: 0o600 });
    const config = [
      "silent",
      "show-error",
      'request = "POST"',
      'header = "Content-Type: application/json"',
      `header = "Authorization: Bearer ${token.replaceAll('"', '\\"')}"`,
      `data-binary = "@${payloadPath.replaceAll('"', '\\"')}"`,
      `output = "${responsePath.replaceAll('"', '\\"')}"`,
      'write-out = "%{http_code}"',
      `url = "${baseUrl.replace(/\/$/, "")}/api/orchestration/dispatch"`,
      "",
    ].join("\n");
    const status = Number(run("curl", ["--config", "-"], { input: config }));
    if (!Number.isInteger(status)) throw new Error("T3 returned an invalid HTTP status.");
    return {
      status,
      body: NodeFS.existsSync(responsePath) ? NodeFS.readFileSync(responsePath, "utf8") : "",
    };
  } finally {
    NodeFS.rmSync(temporary, { recursive: true, force: true });
  }
}

function t3Receipt(result: T3DispatchResult): number {
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`T3 dispatch failed with HTTP ${result.status}: ${result.body.slice(-8_000)}`);
  }
  const parsed = JSON.parse(result.body) as { readonly sequence?: unknown };
  if (!Number.isInteger(parsed.sequence) || (parsed.sequence as number) < 0)
    throw new Error("T3 returned an invalid incident receipt.");
  return parsed.sequence as number;
}

function legacyT3ModelSelection(): unknown {
  const value = process.env.T3CODE_JENKINS_MODEL_SELECTION;
  if (!value) throw new Error("T3 legacy incident model selection is not configured.");
  const parsed = JSON.parse(value) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("instanceId" in parsed) ||
    typeof parsed.instanceId !== "string" ||
    !("model" in parsed) ||
    typeof parsed.model !== "string"
  ) {
    throw new Error("T3 legacy incident model selection is invalid.");
  }
  return parsed;
}

function callT3(record: IncidentRecord, state: "failing" | "recovered", commandId: string): number {
  const baseUrl = process.env.T3CODE_JENKINS_BASE_URL;
  const token = process.env.T3CODE_JENKINS_TOKEN;
  const projectId = process.env.T3CODE_JENKINS_PROJECT_ID;
  if (!baseUrl || !token || !projectId || record.issueNumber === undefined) {
    throw new Error("T3 incident credentials/configuration are incomplete.");
  }
  const createdAt = new Date().toISOString();
  const payload = {
    type: "thread.external-alert.upsert",
    commandId,
    projectId,
    threadId: incidentThreadId(record.issueNumber),
    incidentKey: record.incidentKey,
    title: record.title,
    state,
    summary: state === "failing" ? record.summary : `Recovered: ${record.summary}`,
    ...(record.detail ? { detail: record.detail } : {}),
    url: record.evidenceUrl,
    createdAt,
  };
  const preferred = dispatchT3(payload, baseUrl, token);
  if (preferred.status !== 400) return t3Receipt(preferred);

  // v0.0.40 predates the atomic external-alert command and does not expose its
  // internal activity append over HTTP. Keep escalation passive by creating a
  // normal thread and reflecting incident state in its title.
  const legacyTitle =
    state === "failing"
      ? `${record.title} (#${record.issueNumber})`
      : `Recovered: ${record.title} (#${record.issueNumber})`;
  if (state === "failing") {
    const created = dispatchT3(
      {
        type: "thread.create",
        commandId: `${commandId}:legacy-create`,
        threadId: payload.threadId,
        projectId,
        title: legacyTitle,
        modelSelection: legacyT3ModelSelection(),
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdAt,
      },
      baseUrl,
      token,
    );
    // v0.0.40 does not deduplicate a repeated create command before running the
    // decider. A 500 here can therefore mean the deterministic thread already
    // exists; the title update below is the authoritative existence check.
    if (created.status !== 500) t3Receipt(created);
  }
  return t3Receipt(
    dispatchT3(
      {
        type: "thread.meta.update",
        commandId,
        threadId: payload.threadId,
        title: legacyTitle,
      },
      baseUrl,
      token,
    ),
  );
}

function incidentCommand(args: ParsedArguments): void {
  const operation = args.positionals[0];
  if (operation !== "open" && operation !== "recover" && operation !== "drain") {
    throw new Error("incident requires open, recover, or drain.");
  }
  const dryRun = booleanFlag(args, "dry-run");
  if (dryRun) return output({ status: "dry-run", operation });
  const stateDir = assertAbsoluteStateDirectory(
    flag(args, "state-dir", process.env.FORK_RELEASE_STATE_DIR),
  );
  const outbox = NodePath.join(stateDir, "incident-outbox");
  NodeFS.mkdirSync(outbox, { recursive: true, mode: 0o700 });
  if (operation === "open") {
    const mode = enumFlag(args, "mode", INCIDENT_MODES);
    const failureClass = enumFlag(args, "failure-class", FAILURE_CLASSES);
    const repository = flag(args, "repository", FORK_REPOSITORY);
    const jobFullName = flag(args, "job-full-name", process.env.JOB_NAME);
    const buildNumber = flag(args, "build-number", process.env.BUILD_NUMBER);
    const identity = flag(args, "target-identity");
    const detail = optionalFlag(args, "detail");
    const key = incidentKey({
      repository,
      jobFullName,
      mode,
      targetIdentity: identity,
      failureClass,
    });
    const recordId = outboxRecordId(key, buildNumber);
    const filePath = NodePath.join(outbox, `${recordId}.json`);
    if (!NodeFS.existsSync(filePath)) {
      atomicWriteJson(filePath, {
        schemaVersion: 1,
        recordId,
        repository,
        jobFullName,
        buildNumber,
        mode,
        targetIdentity: identity,
        failureClass,
        incidentKey: key,
        title: flag(args, "title"),
        summary: flag(args, "summary"),
        ...(detail !== undefined ? { detail } : {}),
        evidenceUrl: flag(args, "url", process.env.BUILD_URL),
        createdAt: new Date().toISOString(),
      } satisfies IncidentRecord);
    }
  }
  const records = NodeFS.readdirSync(outbox)
    .filter((name) => name.endsWith(".json"))
    .sort();
  for (const name of records) {
    const filePath = NodePath.join(outbox, name);
    let record = readJsonFile<IncidentRecord>(filePath);
    const marker = incidentMarker(record.incidentKey);
    if (record.issueNumber === undefined) {
      const open = listIncidentIssues(record.repository, marker).filter(
        ({ state }) => state === "OPEN",
      );
      if (open.length > 1)
        throw new Error(`Multiple open issues match incident ${record.recordId}.`);
      const issue =
        open[0] ??
        (() => {
          const url = gh([
            "issue",
            "create",
            "--repo",
            record.repository,
            "--title",
            record.title,
            "--body",
            `${record.summary}\n\n${record.evidenceUrl}\n\n${marker}`,
          ]);
          const issueNumber = Number(url.match(/\/(\d+)$/)?.[1]);
          if (!Number.isInteger(issueNumber))
            throw new Error("Could not resolve the created issue number.");
          return { number: issueNumber };
        })();
      record = { ...record, issueNumber: issue.number };
      atomicWriteJson(filePath, record);
    }
    if (record.failureReceiptSequence === undefined) {
      const commandId =
        record.failureCommandId ??
        failureCommandId({
          issueNumber: record.issueNumber!,
          jobFullName: record.jobFullName,
          buildNumber: record.buildNumber,
          failureClass: record.failureClass,
        });
      record = { ...record, failureCommandId: commandId };
      atomicWriteJson(filePath, record);
      const sequence = callT3(record, "failing", commandId);
      record = { ...record, failureReceiptSequence: sequence };
      atomicWriteJson(filePath, record);
    }
    if (operation === "recover" && !record.githubCompleted) {
      const successfulIdentity = flag(args, "target-identity");
      if (
        !isIncidentRecoverable({
          mode: record.mode,
          failedTargetIdentity: record.targetIdentity,
          successfulTargetIdentity: successfulIdentity,
          isAncestor: (failed, successful) =>
            NodeChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", failed, successful])
              .status === 0,
        })
      )
        continue;
      const commandId =
        record.recoveryCommandId ??
        recoveryCommandId({
          issueNumber: record.issueNumber!,
          targetIdentity: successfulIdentity,
          failureClass: record.failureClass,
        });
      record = { ...record, recoveryCommandId: commandId };
      atomicWriteJson(filePath, record);
      if (record.recoveryReceiptSequence === undefined) {
        record = { ...record, recoveryReceiptSequence: callT3(record, "recovered", commandId) };
        atomicWriteJson(filePath, record);
      }
      gh([
        "issue",
        "comment",
        String(record.issueNumber),
        "--repo",
        record.repository,
        "--body",
        `Recovered by ${record.evidenceUrl}.\n\n<!-- t3-fork-recovery-complete:${record.recordId} -->`,
      ]);
      gh([
        "issue",
        "close",
        String(record.issueNumber),
        "--repo",
        record.repository,
        "--reason",
        "completed",
      ]);
      record = { ...record, githubCompleted: true };
      atomicWriteJson(filePath, record);
    }
  }
  output({ status: "drained", operation, recordCount: records.length });
}

function releaseDraftCommand(args: ParsedArguments): void {
  const version = flag(args, "version");
  const tag = `v${version}`;
  const candidate = resolveCommit(flag(args, "candidate"));
  const assetDirectory = NodePath.resolve(flag(args, "assets"));
  const evidence = collectReleaseEvidence(assetDirectory, version);
  if (booleanFlag(args, "dry-run")) return output({ status: "dry-run", tag, candidate, evidence });
  const remoteTag = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (remoteTag) {
    const remoteSha = remoteTag.split(/\s+/)[0];
    if (remoteSha !== candidate)
      throw new Error(`Tag ${tag} already targets a different candidate.`);
  } else {
    git(["push", "origin", `${candidate}:refs/tags/${tag}`]);
  }
  const existing = NodeChildProcess.spawnSync(
    "gh",
    [
      "release",
      "view",
      tag,
      "--repo",
      FORK_REPOSITORY,
      "--json",
      "isDraft,targetCommitish,tagName",
    ],
    { encoding: "utf8" },
  );
  if (existing.status === 0) {
    const release = JSON.parse(existing.stdout) as { readonly isDraft: boolean };
    if (!release.isDraft)
      throw new Error(`Release ${tag} is already public; use promote reconciliation.`);
  } else {
    gh([
      "release",
      "create",
      tag,
      "--repo",
      FORK_REPOSITORY,
      "--verify-tag",
      "--draft",
      "--title",
      `T3 Code ${version}`,
      "--notes",
      `Fork release based on upstream stable with Project Collections.`,
    ]);
  }
  const assets = evidence.names.map((name) => NodePath.join(assetDirectory, name));
  gh(["release", "upload", tag, "--repo", FORK_REPOSITORY, "--clobber", ...assets]);
  output({ status: "draft-verified", tag, candidate, evidence });
}

function promoteCommand(args: ParsedArguments): void {
  const candidate = resolveCommit(flag(args, "candidate"));
  const branch = flag(args, "branch", "main");
  const observed = assertFullSha(flag(args, "observed-sha"), "Observed branch SHA");
  const tag = optionalFlag(args, "tag");
  if (booleanFlag(args, "dry-run")) return output({ status: "dry-run", candidate, branch, tag });
  if (tag) {
    const publicProbe = NodeChildProcess.spawnSync(
      "gh",
      ["release", "view", tag, "--repo", FORK_REPOSITORY, "--json", "isDraft,isPrerelease,assets"],
      { encoding: "utf8" },
    );
    if (publicProbe.status === 0) {
      const publicRelease = JSON.parse(publicProbe.stdout) as {
        readonly isDraft: boolean;
        readonly isPrerelease: boolean;
        readonly assets: ReadonlyArray<{ readonly name: string }>;
      };
      if (!publicRelease.isDraft) {
        const remoteMain = git(["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0];
        const remoteTag = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).split(
          /\s+/,
        )[0];
        const version = tag.replace(/^v/, "");
        if (remoteMain !== candidate || remoteTag !== candidate || publicRelease.isPrerelease) {
          throw new Error(
            `Public release ${tag} does not match the persisted candidate transaction.`,
          );
        }
        requiredReleaseAssets(
          publicRelease.assets.map(({ name }) => name),
          version,
        );
        const latest = JSON.parse(gh(["api", `repos/${FORK_REPOSITORY}/releases/latest`])) as {
          readonly tag_name: string;
        };
        if (latest.tag_name !== tag) throw new Error(`Public release ${tag} is not marked latest.`);
        return output({ status: "already-promoted", candidate, branch, tag });
      }
    }
  }
  git([
    "push",
    `--force-with-lease=refs/heads/${branch}:${observed}`,
    "origin",
    `${candidate}:refs/heads/${branch}`,
  ]);
  if (tag) {
    const release = JSON.parse(
      gh(["release", "view", tag, "--repo", FORK_REPOSITORY, "--json", "isDraft,isPrerelease"]),
    ) as { readonly isDraft: boolean; readonly isPrerelease: boolean };
    if (!release.isDraft || release.isPrerelease)
      throw new Error(`Draft ${tag} failed final reconciliation.`);
    gh([
      "release",
      "edit",
      tag,
      "--repo",
      FORK_REPOSITORY,
      "--draft=false",
      "--prerelease=false",
      "--latest",
    ]);
  }
  output({ status: "promoted", candidate, branch, tag: tag ?? null });
}

function verifyBootstrapCommand(args: ParsedArguments): void {
  const root = NodePath.resolve(flag(args, "root", process.cwd()));
  const document = readJsonFile<ForkReleaseBootstrap>(
    NodePath.join(root, "scripts/fork-release-bootstrap.json"),
  );
  verifyBootstrapPatch(root, document);
  output({
    status: "verified",
    pathCount: document.paths.length,
    patchSha256: document.patch.sha256,
  });
}

function main(): void {
  const args = parseArguments(process.argv.slice(2));
  switch (args.command) {
    case "resolve":
      return resolveCommand(args);
    case "prepare":
      return prepareCommand(args);
    case "incident":
      return incidentCommand(args);
    case "release-draft":
      return releaseDraftCommand(args);
    case "promote":
      return promoteCommand(args);
    case "verify-bootstrap":
      return verifyBootstrapCommand(args);
    default:
      throw new Error(
        "Usage: fork-release <resolve|prepare|incident|release-draft|promote|verify-bootstrap> [options]",
      );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
