// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export const FORK_REPOSITORY = "YuryYudin/t3code";
export const UPSTREAM_REPOSITORY = "pingdotgg/t3code";
export const FORK_UPDATE_REPOSITORY = FORK_REPOSITORY;

export const INCIDENT_MODES = [
  "nightly-integration",
  "automatic-stable-release",
  "out-of-cycle-release",
] as const;
export type IncidentMode = (typeof INCIDENT_MODES)[number];

export const FAILURE_CLASSES = [
  "patch-replay",
  "validation",
  "mac-signing",
  "packaging",
  "manifest-verification",
  "branch-promotion",
  "release-publication",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export type ForkAction = "auto" | "validate-only" | "out-of-cycle";

export interface BootstrapPath {
  readonly disposition: "clean" | "adapt";
  readonly status: "A" | "M";
  readonly path: string;
  readonly invariant?: string;
  readonly sourceBlob?: string;
  readonly sourcePatchId?: string;
  readonly resolvedBlob: string;
}

export interface ForkReleaseBootstrap {
  readonly schemaVersion: 1;
  readonly sourceRange: { readonly baseExclusive: string; readonly headInclusive: string };
  readonly stableBase: { readonly tag: string; readonly commit: string; readonly tree: string };
  readonly patch: { readonly path: string; readonly sha256: string; readonly resultTree: string };
  readonly commit: {
    readonly message: string;
    readonly authorName: string;
    readonly authorEmail: string;
    readonly timestamp: string;
  };
  readonly infrastructureReplayResolutions: ReadonlyArray<{
    readonly path: string;
    readonly resolution: "keep-target";
    readonly invariant: string;
  }>;
  readonly paths: ReadonlyArray<BootstrapPath>;
  readonly acceptanceCommand: string;
}

export interface ReleaseAssetEvidence {
  readonly names: ReadonlyArray<string>;
  readonly sha256: Readonly<Record<string, string>>;
}

export interface IncidentRecord {
  readonly schemaVersion: 1;
  readonly recordId: string;
  readonly repository: string;
  readonly jobFullName: string;
  readonly buildNumber: string;
  readonly mode: IncidentMode;
  readonly targetIdentity: string;
  readonly failureClass: FailureClass;
  readonly incidentKey: string;
  readonly title: string;
  readonly summary: string;
  readonly detail?: string;
  readonly evidenceUrl: string;
  readonly createdAt: string;
  readonly issueNumber?: number;
  readonly failureCommandId?: string;
  readonly failureReceiptSequence?: number;
  readonly recoveryCommandId?: string;
  readonly recoveryReceiptSequence?: number;
  readonly githubCompleted?: boolean;
}

const SEMVER = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FORK_VERSION = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([1-9]\d*)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

export function normalizeStableVersion(value: string): string {
  const match = SEMVER.exec(value.trim());
  if (!match) throw new Error(`Expected a stable semantic version, received '${value}'.`);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function firstForkVersion(upstreamVersion: string): string {
  const normalized = normalizeStableVersion(upstreamVersion);
  const [major, minor, patch] = normalized.split(".").map(Number);
  return `${major}.${minor}.${patch! + 1}-1`;
}

export function allocateForkVersion(input: {
  readonly upstreamVersion: string;
  readonly existingVersions: ReadonlyArray<string>;
}): string {
  const first = firstForkVersion(input.upstreamVersion);
  const prefix = first.slice(0, first.lastIndexOf("-") + 1);
  let maximum = 0;
  for (const candidate of input.existingVersions) {
    const match = FORK_VERSION.exec(candidate.trim());
    if (match && `${match[1]}.${match[2]}.${match[3]}-` === prefix) {
      maximum = Math.max(maximum, Number(match[4]));
    }
  }
  return `${prefix}${maximum + 1}`;
}

export function assertFullSha(value: string, label: string): string {
  if (!FULL_SHA.test(value)) throw new Error(`${label} must be a full lowercase commit SHA.`);
  return value;
}

export function targetIdentity(mode: IncidentMode, target: string): string {
  switch (mode) {
    case "nightly-integration":
      return `commit:${assertFullSha(target, "Nightly target")}`;
    case "automatic-stable-release":
      return `stable:${normalizeStableVersion(target)}`;
    case "out-of-cycle-release":
      return `candidate:${assertFullSha(target, "Out-of-cycle candidate")}`;
  }
}

export function incidentKey(input: {
  readonly repository: string;
  readonly jobFullName: string;
  readonly mode: IncidentMode;
  readonly targetIdentity: string;
  readonly failureClass: FailureClass;
}): string {
  return `jenkins:${input.repository}:${input.jobFullName}:${input.mode}:${input.targetIdentity}:${input.failureClass}`;
}

export function incidentMarker(key: string): string {
  return `<!-- t3-fork-incident:${NodeCrypto.createHash("sha256").update(key).digest("hex")} -->`;
}

export function failureCommandId(input: {
  readonly issueNumber: number;
  readonly jobFullName: string;
  readonly buildNumber: string;
  readonly failureClass: FailureClass;
}): string {
  return `jenkins:issue:${input.issueNumber}:failure:job:${encodeURIComponent(input.jobFullName)}:build:${input.buildNumber}:class:${input.failureClass}`;
}

export function recoveryCommandId(input: {
  readonly issueNumber: number;
  readonly targetIdentity: string;
  readonly failureClass: FailureClass;
}): string {
  const targetHash = NodeCrypto.createHash("sha256").update(input.targetIdentity).digest("hex");
  return `jenkins:issue:${input.issueNumber}:recovery:target:${targetHash}:class:${input.failureClass}`;
}

function compareStableVersions(left: string, right: string): number {
  const a = normalizeStableVersion(left).split(".").map(Number);
  const b = normalizeStableVersion(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!;
  }
  return 0;
}

export function isIncidentRecoverable(input: {
  readonly mode: IncidentMode;
  readonly failedTargetIdentity: string;
  readonly successfulTargetIdentity: string;
  readonly isAncestor: (failedCommit: string, successfulCommit: string) => boolean;
}): boolean {
  if (input.mode === "out-of-cycle-release") {
    return input.failedTargetIdentity === input.successfulTargetIdentity;
  }
  if (input.mode === "automatic-stable-release") {
    const failed = input.failedTargetIdentity.match(/^stable:(.+)$/)?.[1];
    const successful = input.successfulTargetIdentity.match(/^stable:(.+)$/)?.[1];
    return (
      failed !== undefined &&
      successful !== undefined &&
      compareStableVersions(failed, successful) <= 0
    );
  }
  const failed = input.failedTargetIdentity.match(/^commit:([0-9a-f]{40})$/)?.[1];
  const successful = input.successfulTargetIdentity.match(/^commit:([0-9a-f]{40})$/)?.[1];
  return failed !== undefined && successful !== undefined && input.isAncestor(failed, successful);
}

export function incidentThreadId(issueNumber: number): string {
  return `t3-fork-incident-${issueNumber}`;
}

export function outboxRecordId(key: string, buildNumber: string): string {
  return NodeCrypto.createHash("sha256").update(`${key}\0${buildNumber}`).digest("hex");
}

export function validateBootstrap(document: ForkReleaseBootstrap): void {
  if (document.schemaVersion !== 1) throw new Error("Unsupported bootstrap schema version.");
  assertFullSha(document.sourceRange.baseExclusive, "Bootstrap source base");
  assertFullSha(document.sourceRange.headInclusive, "Bootstrap source head");
  assertFullSha(document.stableBase.commit, "Bootstrap stable base");
  assertFullSha(document.stableBase.tree, "Bootstrap stable tree");
  assertFullSha(document.patch.resultTree, "Bootstrap result tree");
  if (!/^[0-9a-f]{64}$/.test(document.patch.sha256)) throw new Error("Invalid patch SHA-256.");
  const replayPaths = new Set<string>();
  for (const resolution of document.infrastructureReplayResolutions) {
    if (
      NodePath.isAbsolute(resolution.path) ||
      resolution.path.includes("..") ||
      resolution.invariant.trim().length === 0
    ) {
      throw new Error(`Invalid infrastructure replay resolution '${resolution.path}'.`);
    }
    if (replayPaths.has(resolution.path)) {
      throw new Error("Infrastructure replay resolutions contain duplicate paths.");
    }
    replayPaths.add(resolution.path);
  }
  if (document.paths.length !== 79)
    throw new Error(`Expected 79 bootstrap paths, found ${document.paths.length}.`);
  const unique = new Set(document.paths.map(({ path }) => path));
  if (unique.size !== document.paths.length)
    throw new Error("Bootstrap path inventory contains duplicates.");
  for (const entry of document.paths) {
    if (NodePath.isAbsolute(entry.path) || entry.path.includes("..")) {
      throw new Error(`Unsafe bootstrap path '${entry.path}'.`);
    }
    assertFullSha(entry.resolvedBlob, `Resolved blob for ${entry.path}`);
    if (entry.disposition === "adapt" && !entry.invariant) {
      throw new Error(`Adapted path '${entry.path}' has no invariant.`);
    }
    if (entry.disposition === "clean" && entry.status === "A" && !entry.sourceBlob) {
      throw new Error(`Added clean path '${entry.path}' has no source blob.`);
    }
    if (entry.disposition === "clean" && entry.status === "M" && !entry.sourcePatchId) {
      throw new Error(`Modified clean path '${entry.path}' has no source patch id.`);
    }
  }
}

export function sha256File(filePath: string): string {
  return NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(filePath)).digest("hex");
}

export function verifyBootstrapPatch(root: string, document: ForkReleaseBootstrap): void {
  validateBootstrap(document);
  const patchPath = NodePath.resolve(root, document.patch.path);
  if (sha256File(patchPath) !== document.patch.sha256) {
    throw new Error("Collections bootstrap patch checksum does not match its manifest.");
  }
}

export function requiredReleaseAssets(names: ReadonlyArray<string>, version: string): void {
  const lower = names.map((name) => name.toLowerCase());
  const has = (predicate: (name: string) => boolean) => lower.some(predicate);
  const versionToken = version.toLowerCase();
  const required: ReadonlyArray<[string, (name: string) => boolean]> = [
    [
      "macOS arm64 DMG",
      (name) => name.includes(versionToken) && name.includes("arm64") && name.endsWith(".dmg"),
    ],
    [
      "macOS arm64 ZIP",
      (name) => name.includes(versionToken) && name.includes("arm64") && name.endsWith(".zip"),
    ],
    [
      "macOS x64 DMG",
      (name) => name.includes(versionToken) && name.includes("x64") && name.endsWith(".dmg"),
    ],
    [
      "macOS x64 ZIP",
      (name) => name.includes(versionToken) && name.includes("x64") && name.endsWith(".zip"),
    ],
    [
      "Linux x64 AppImage",
      (name) =>
        name.includes(versionToken) &&
        (name.includes("x64") || name.includes("x86_64")) &&
        name.endsWith(".appimage"),
    ],
    [
      "Windows x64 NSIS",
      (name) => name.includes(versionToken) && name.includes("x64") && name.endsWith(".exe"),
    ],
    ["canonical macOS update manifest", (name) => name === "latest-mac.yml"],
    ["Linux update manifest", (name) => name === "latest-linux.yml"],
    ["Windows update manifest", (name) => name === "latest.yml"],
    ["SHA-256 checksums", (name) => name === "sha256sums.txt"],
  ];
  const missing = required.filter(([, predicate]) => !has(predicate)).map(([label]) => label);
  if (missing.length > 0) throw new Error(`Incomplete release asset set: ${missing.join(", ")}.`);
  if (has((name) => name === "latest-mac-x64.yml")) {
    throw new Error("The secondary macOS manifest must be merged before publication.");
  }
}

export function collectReleaseEvidence(directory: string, version: string): ReleaseAssetEvidence {
  const names = NodeFS.readdirSync(directory).filter((name) =>
    NodeFS.statSync(NodePath.join(directory, name)).isFile(),
  );
  requiredReleaseAssets(names, version);
  return {
    names: [...names].sort(),
    sha256: Object.fromEntries(
      names.sort().map((name) => [name, sha256File(NodePath.join(directory, name))]),
    ),
  };
}

export function assertAbsoluteStateDirectory(directory: string): string {
  if (!NodePath.isAbsolute(directory)) throw new Error("FORK_RELEASE_STATE_DIR must be absolute.");
  NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = NodeFS.statSync(directory);
  if (!stat.isDirectory()) throw new Error("FORK_RELEASE_STATE_DIR is not a directory.");
  NodeFS.accessSync(directory, NodeFS.constants.R_OK | NodeFS.constants.W_OK);
  return directory;
}

export function atomicWriteJson(filePath: string, value: unknown): void {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${NodeCrypto.randomUUID()}`;
  const file = NodeFS.openSync(temporary, "wx", 0o600);
  try {
    NodeFS.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    NodeFS.fsyncSync(file);
  } finally {
    NodeFS.closeSync(file);
  }
  NodeFS.renameSync(temporary, filePath);
  const directory = NodeFS.openSync(NodePath.dirname(filePath), "r");
  try {
    NodeFS.fsyncSync(directory);
  } finally {
    NodeFS.closeSync(directory);
  }
}

export function readJsonFile<T>(filePath: string): T {
  return JSON.parse(NodeFS.readFileSync(filePath, "utf8")) as T;
}
