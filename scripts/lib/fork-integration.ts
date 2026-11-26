// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assertFullSha, atomicWriteJson, readJsonFile } from "./fork-release.ts";

export const ZERO_SHA = "0".repeat(40);
export const REPAIR_LIMIT = 2;
export const STABLE_SOURCE_REPAIR_LIMIT = 12;
export const STABLE_QUALITY_REPAIR_LIMIT = 3;
export interface IntegrationInputs {
  readonly source: string;
  readonly target: string;
  readonly observed: string;
}
export interface RepairRequest {
  readonly id: string;
  readonly attempt: number;
  readonly message: string;
  readonly createdAt: string;
  readonly receiptSequence?: number;
  readonly completed?: boolean;
  readonly stage?: string;
}
export interface IntegrationState {
  readonly schemaVersion: 1;
  readonly kind: "integration" | "stable";
  readonly replay: {
    readonly commits: ReadonlyArray<string>;
    readonly index: number;
    readonly pending?: string;
  };
  readonly id: string;
  readonly inputs: IntegrationInputs;
  readonly checkout: string;
  readonly shareWithUid?: number;
  readonly head: string;
  readonly status: "preparing" | "needs-repair" | "prepared" | "verified";
  readonly conflicts: ReadonlyArray<string>;
  readonly requests: ReadonlyArray<RepairRequest>;
  readonly qualitySha?: string | undefined;
  readonly verifiedBuild?: string;
}
export function integrationId(inputs: IntegrationInputs, kind = "integration"): string {
  for (const [name, sha] of Object.entries(inputs)) assertFullSha(sha, name);
  return NodeCrypto.createHash("sha256").update(JSON.stringify({ kind, inputs })).digest("hex");
}
function run(command: string, args: ReadonlyArray<string>, cwd?: string): string {
  const result = NodeChildProcess.spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed: ${[result.stderr, result.stdout, result.error?.message].filter(Boolean).join("\n").slice(-8000)}`,
    );
  return result.stdout.trim();
}
const LOCKFILE = "pnpm-lock.yaml";
function regenerateLockfileWithPnpm(checkout: string): void {
  run("corepack", ["pnpm", "install", "--lockfile-only", "--ignore-scripts"], checkout);
}
// The repair worker can write these checkouts, so Jenkins never runs their hooks or monitors.
function gitConfig(cwd: string): string[] {
  return [
    "-c",
    `safe.directory=${cwd}`,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
  ];
}
export function integrationGit(cwd: string, args: ReadonlyArray<string>): string {
  return run("git", [...gitConfig(cwd), ...args], cwd);
}
function ancestor(cwd: string, older: string, newer: string): boolean {
  return (
    NodeChildProcess.spawnSync(
      "git",
      [...gitConfig(cwd), "merge-base", "--is-ancestor", older, newer],
      { cwd },
    ).status === 0
  );
}
function unresolved(cwd: string): string[] {
  return integrationGit(cwd, ["diff", "--name-only", "--diff-filter=U"])
    .split("\n")
    .filter(Boolean)
    .sort();
}
export function shareCheckout(checkout: string, uid: number): void {
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("Invalid shared checkout UID.");
  const ownerUid = process.getuid?.();
  const owned: string[] = [];
  const directories: string[] = [];
  const visit = (path: string) => {
    const stat = NodeFS.lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.uid === ownerUid) {
      owned.push(path);
      if (stat.isDirectory()) directories.push(path);
    }
    if (stat.isDirectory()) {
      for (const entry of NodeFS.readdirSync(path)) {
        if (entry !== "node_modules") visit(NodePath.join(path, entry));
      }
    }
  };
  visit(checkout);
  for (let index = 0; index < owned.length; index += 200) {
    run("setfacl", ["-m", `u:${uid}:rwX`, ...owned.slice(index, index + 200)]);
  }
  for (let index = 0; index < directories.length; index += 200) {
    // A new file belongs to its creator. Retain named access for both accounts
    // so worker-created dependencies remain writable by Jenkins on the next attempt.
    const defaults = [
      `d:u:${uid}:rwx`,
      ...(ownerUid === undefined || ownerUid === uid ? [] : [`d:u:${ownerUid}:rwx`]),
    ].join(",");
    run("setfacl", ["-m", defaults, ...directories.slice(index, index + 200)]);
  }
}

/** The worker runs this as itself; shareCheckout is the same grant from Jenkins' side. */
function shareCommand(checkout: string, uid: number | undefined): string {
  if (!Number.isSafeInteger(uid)) throw new Error("Jenkins UID is unavailable.");
  const quoted = `'${checkout.replaceAll("'", "'\\''")}'`;
  return [
    `find ${quoted} -name node_modules -prune -o -user "$(id -u)" ! -type l -exec setfacl -m u:${uid}:rwX {} +`,
    `find ${quoted} -name node_modules -prune -o -user "$(id -u)" -type d -exec setfacl -m d:u:${uid}:rwx,d:u:"$(id -u)":rwx {} +`,
  ].join(" && ");
}

export class Integration {
  readonly journal: string;
  readonly statePath: string;
  readonly workspaceRoot: string;
  readonly stateDir: string;
  readonly inputs: IntegrationInputs;
  readonly kind: "integration" | "stable";
  private readonly regenerateLockfile: (checkout: string) => void;
  constructor(
    stateDir: string,
    inputs: IntegrationInputs,
    workspaceRoot?: string,
    kind: "integration" | "stable" = "integration",
    regenerateLockfile: (checkout: string) => void = regenerateLockfileWithPnpm,
  ) {
    this.regenerateLockfile = regenerateLockfile;
    this.stateDir = stateDir;
    this.inputs = inputs;
    this.kind = kind;
    this.journal = NodePath.join(stateDir, "integration", integrationId(inputs, kind));
    this.statePath = NodePath.join(this.journal, "state.json");
    this.workspaceRoot =
      workspaceRoot ??
      NodePath.join("/var/tmp", `t3code-fork-repair-${process.getuid?.() ?? "ci"}`);
  }
  read(): IntegrationState {
    return readJsonFile(this.statePath);
  }
  save(state: IntegrationState): IntegrationState {
    atomicWriteJson(this.statePath, state);
    return state;
  }
  prepare(repository: string, shareWithUid?: number): IntegrationState {
    if (NodeFS.existsSync(this.statePath)) return this.advance(this.read());
    const id = integrationId(this.inputs, this.kind);
    const checkout = NodePath.join(this.workspaceRoot, id, "checkout");
    // An interrupted clone has no journal yet. This path is owned exclusively
    // by this transaction; never clean another job's or the user's checkout.
    NodeFS.rmSync(NodePath.dirname(checkout), { recursive: true, force: true });
    NodeFS.mkdirSync(this.workspaceRoot, { recursive: true, mode: 0o700 });
    // /var/tmp is shared: refuse a root another account created or redirected.
    const root = NodeFS.lstatSync(this.workspaceRoot);
    if (!root.isDirectory() || root.uid !== process.getuid?.())
      throw new Error(
        `Repair workspace ${this.workspaceRoot} is not a directory this account owns.`,
      );
    NodeFS.mkdirSync(NodePath.dirname(checkout), { recursive: true, mode: 0o700 });
    run("git", ["clone", "--no-hardlinks", "--no-checkout", repository, checkout]);
    integrationGit(checkout, [
      "remote",
      "set-url",
      "origin",
      "git@github.com:YuryYudin/t3code.git",
    ]);
    integrationGit(checkout, ["config", "user.name", "T3 Code maintenance"]);
    integrationGit(checkout, ["config", "user.email", "maintenance@tapnetix.com"]);
    integrationGit(checkout, ["config", "core.sharedRepository", "group"]);
    integrationGit(checkout, ["config", "rerere.enabled", "true"]);
    integrationGit(checkout, ["config", "rerere.autoupdate", "true"]);
    NodeFS.appendFileSync(
      NodePath.join(checkout, ".git", "info", "exclude"),
      "\n.fork-repair-request.json\n.fork-repair-complete.json\n",
    );
    const cache = NodePath.join(this.stateDir, "verified-rerere");
    if (NodeFS.existsSync(cache))
      NodeFS.cpSync(cache, NodePath.join(checkout, ".git", "rr-cache"), { recursive: true });
    const head = this.inputs.target;
    const boundary = integrationGit(checkout, [
      "merge-base",
      this.inputs.source,
      this.inputs.target,
    ]);
    const commits = integrationGit(checkout, [
      "rev-list",
      "--reverse",
      `${boundary}..${this.inputs.source}`,
    ])
      .split("\n")
      .filter(Boolean);
    for (const commit of commits) {
      if (
        integrationGit(checkout, ["rev-list", "--parents", "-n", "1", commit]).split(" ").length !==
        2
      )
        throw new Error("Fork source patch range contains a merge commit.");
    }
    integrationGit(checkout, ["checkout", "--detach", head]);
    if (shareWithUid !== undefined && shareWithUid !== process.getuid?.()) {
      // The existing T3 environment runs under the project owner, on this
      // controller. ACLs grant that account access only to repair checkouts.
      run("setfacl", ["-m", `u:${shareWithUid}:x`, this.workspaceRoot]);
      shareCheckout(NodePath.dirname(checkout), shareWithUid);
    }
    return this.advance(
      this.save({
        schemaVersion: 1,
        kind: this.kind,
        replay: { commits, index: 0 },
        id,
        inputs: this.inputs,
        checkout,
        ...(shareWithUid === undefined ? {} : { shareWithUid }),
        head,
        status: "preparing",
        conflicts: [],
        requests: [],
      }),
    );
  }
  advance(initial: IntegrationState): IntegrationState {
    let state = initial;
    if (state.status !== "preparing") return state;
    if (integrationGit(state.checkout, ["rev-parse", "HEAD"]) !== state.head) {
      NodeChildProcess.spawnSync("git", [...gitConfig(state.checkout), "cherry-pick", "--quit"], {
        cwd: state.checkout,
      });
      integrationGit(state.checkout, ["reset", "--hard", state.head]);
    }
    return this.advanceReplay(state);
  }
  private reconcileLockfile(state: IntegrationState, conflicts: string[]): string[] {
    if (conflicts.length !== 1 || conflicts[0] !== LOCKFILE) return conflicts;
    this.regenerateLockfileFromTarget(state);
    return unresolved(state.checkout);
  }
  // Generated hunks cannot be merged line by line: one that applies cleanly can still name a patch
  // hash the target dropped. Start from the target's graph and add the staged manifests to it.
  private regenerateLockfileFromTarget(state: IntegrationState): void {
    integrationGit(state.checkout, ["checkout", state.inputs.target, "--", LOCKFILE]);
    this.regenerateLockfile(state.checkout);
    integrationGit(state.checkout, ["add", "--", LOCKFILE]);
  }
  private reconcileStagedLockfile(state: IntegrationState): void {
    if (integrationGit(state.checkout, ["diff", "--cached", "--name-only", "--", LOCKFILE]))
      this.regenerateLockfileFromTarget(state);
  }
  private advanceReplay(initial: IntegrationState): IntegrationState {
    let state = initial;
    while (state.replay.index < state.replay.commits.length) {
      const commit = state.replay.commits[state.replay.index]!;
      const cherryPickHead = NodePath.join(state.checkout, ".git", "CHERRY_PICK_HEAD");
      if (
        !state.replay.pending ||
        (!NodeFS.existsSync(cherryPickHead) &&
          !integrationGit(state.checkout, ["diff", "--cached", "--name-only"]))
      ) {
        state = this.save({ ...state, replay: { ...state.replay, pending: commit } });
        const result = NodeChildProcess.spawnSync(
          "git",
          [...gitConfig(state.checkout), "cherry-pick", "--no-commit", commit],
          { cwd: state.checkout, encoding: "utf8" },
        );
        if (
          result.status !== 0 &&
          !unresolved(state.checkout).length &&
          !NodeFS.existsSync(NodePath.join(state.checkout, ".git", "MERGE_MSG"))
        )
          throw new Error(`Fork replay failed: ${result.stderr || result.stdout}`);
      }
      const conflicts = this.reconcileLockfile(state, unresolved(state.checkout));
      if (conflicts.length) return this.save({ ...state, status: "needs-repair", conflicts });
      state = this.commitReplay(state);
    }
    return this.save({ ...state, status: "prepared" });
  }
  private commitReplay(state: IntegrationState): IntegrationState {
    const replay = state.replay;
    if (!replay.pending) throw new Error("Missing replay patch.");
    this.reconcileStagedLockfile(state);
    integrationGit(state.checkout, [
      "diff",
      "--cached",
      "--check",
      state.inputs.target,
      "--",
      ".",
      ":(exclude,glob)**/*.patch",
      ":(exclude).repos",
    ]);
    const tree = integrationGit(state.checkout, ["write-tree"]);
    const [originalParent, originalTree] = integrationGit(state.checkout, [
      "rev-parse",
      `${replay.pending}^`,
      `${replay.pending}^{tree}`,
    ]).split("\n");
    // A new committer timestamp would sever integration ancestry on every
    // fork revision, even when the stable base and patch are unchanged.
    let head = replay.pending;
    if (originalParent !== state.head || originalTree !== tree) {
      const message = integrationGit(state.checkout, ["show", "-s", "--format=%B", replay.pending]);
      const result = NodeChildProcess.spawnSync(
        "git",
        [...gitConfig(state.checkout), "commit-tree", tree, "-p", state.head],
        {
          cwd: state.checkout,
          input: `${message}\n`,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: integrationGit(state.checkout, [
              "show",
              "-s",
              "--format=%an",
              replay.pending,
            ]),
            GIT_AUTHOR_EMAIL: integrationGit(state.checkout, [
              "show",
              "-s",
              "--format=%ae",
              replay.pending,
            ]),
            GIT_AUTHOR_DATE: integrationGit(state.checkout, [
              "show",
              "-s",
              "--format=%aI",
              replay.pending,
            ]),
          },
        },
      );
      if (result.status !== 0) throw new Error(result.stderr);
      head = assertFullSha(result.stdout.trim(), "Replay candidate");
    }
    integrationGit(state.checkout, ["rerere"]);
    state = this.save({
      ...state,
      head,
      replay: { commits: replay.commits, index: replay.index + 1 },
      conflicts: [],
      status: "preparing",
    });
    NodeChildProcess.spawnSync("git", [...gitConfig(state.checkout), "cherry-pick", "--quit"], {
      cwd: state.checkout,
    });
    integrationGit(state.checkout, ["reset", "--hard", head]);
    return state;
  }
  request(feedback = ""): { state: IntegrationState; request: RepairRequest } {
    let state = this.read();
    const previous = state.requests.at(-1);
    if (previous && !previous.completed) return { state, request: previous };
    const stage = state.replay.pending ? `replay:${state.replay.pending}` : "quality";
    // Advancing to another patch is progress, not a retry of the same failure.
    const used = state.requests.filter((request) => request.stage === stage).length;
    const repairLimit = stage === "quality" ? STABLE_QUALITY_REPAIR_LIMIT : REPAIR_LIMIT;
    if (
      stage !== "quality" &&
      state.requests.filter((request) => request.stage !== "quality").length >=
        STABLE_SOURCE_REPAIR_LIMIT
    )
      throw new Error(
        `Automatic replay exhausted ${STABLE_SOURCE_REPAIR_LIMIT} source repairs for input ${state.id}; unchanged retries will reuse this incident.`,
      );
    if (used >= repairLimit)
      throw new Error(
        `Automatic repair exhausted ${repairLimit} attempts for input ${state.id} at ${stage}; unchanged retries will reuse this incident.`,
      );
    if (!["needs-repair", "prepared"].includes(state.status))
      throw new Error("Candidate does not need repair.");
    if (feedback) {
      // A failed gate invalidates resolutions recorded during that attempt.
      NodeFS.rmSync(NodePath.join(state.checkout, ".git", "rr-cache"), {
        recursive: true,
        force: true,
      });
    }
    if (state.shareWithUid !== undefined && state.shareWithUid !== process.getuid?.()) {
      shareCheckout(NodePath.dirname(state.checkout), state.shareWithUid);
    }
    const attempt = state.requests.length + 1;
    const id = `fork-repair:${state.id}:${attempt}`;
    const message = [
      `Candidate policy: linear replay of the fork commits onto ${state.kind === "stable" ? "the exact official stable release" : "the current upstream main"}; never merge.`,
      "Perform this authorized automatic fork maintenance repair now, then return a completion receipt. Do not delegate or ask for confirmation.",
      `Work ONLY in ${state.checkout}. This is a disposable shared checkout. The user's project directory and live T3 data must not be changed.`,
      `Frozen source main: ${state.inputs.source}; upstream target: ${state.inputs.target}; HEAD must remain ${state.head}.`,
      `Use git -c safe.directory=${state.checkout} for Git commands in this checkout. Do not create commits, reset HEAD, abort a merge, change remotes, push, release, or alter Jenkins/signing credentials. Jenkins creates commits and promotes only after its gates pass.`,
      "Preserve upstream changes and fork Collections on web/desktop/mobile, multi-window support, remote connections, and fork update identity. Read both sides of each conflict; do not resolve application files wholesale with ours/theirs. Preserve independent upstream and fork tests. For dependency changes align React and react-test-renderer and regenerate pnpm-lock.yaml after resolving manifests. Preserve upstream dependency .patch assets and read-only .repos references byte for byte; their whitespace is part of the upstream snapshot. Exclude **/*.patch and .repos when running git diff --check.",
      `Unresolved paths: ${state.conflicts.join(", ") || "none; repair the gate failure below"}.`,
      "Do not weaken tests or verification gates.",
      "Run only focused checks relevant to the repair when tools are already available. Do not install the entire workspace just to run checks; Jenkins owns dependency installation, repository-wide checks, and native builds. If local test tooling is unavailable, finish the source resolution and return the receipt so Jenkins can supply gate feedback. Do not start browsers, dev servers, devices, or touch live ~/.t3/userdata.",
      feedback
        ? `Jenkins installed the workspace dependencies in this checkout before this feedback attempt. Run the failing focused tests locally and iterate until they pass, including follow-on errors that the first missing mock export may have hidden. Run the relevant scoped type checks for production changes. Parser checks alone are not sufficient when the test runner is available.\nJenkins gate feedback:\n${feedback.slice(-16000)}`
        : "Inspect the conflicting fork patch and the relevant upstream commits before adapting the fork.",
      `Before returning the receipt, grant Jenkins access to the files you created or changed here, skipping dependencies and symlinks: ${shareCommand(state.checkout, process.getuid?.())}`,
      `Stage all intended tracked repairs, ensure no unresolved paths or unstaged edits remain, then write ${NodePath.join(state.checkout, ".fork-repair-complete.json")} atomically with exactly {"requestId":${JSON.stringify(id)},"status":"completed"}. Create the receipt with mode 0644 so Jenkins can read it. This receipt is the last filesystem operation; finish the turn immediately afterward. If unable to resolve, write the same receipt with status "failed" and a concise detail. Never fabricate success.`,
    ].join("\n\n");
    const request = {
      id,
      attempt,
      message,
      createdAt: new Date().toISOString(),
      ...(stage === undefined ? {} : { stage }),
    };
    state = this.save({ ...state, requests: [...state.requests, request] });
    NodeFS.rmSync(NodePath.join(state.checkout, ".fork-repair-complete.json"), { force: true });
    atomicWriteJson(NodePath.join(state.checkout, ".fork-repair-request.json"), request);
    return { state, request };
  }
  accepted(id: string, sequence: number): void {
    const state = this.read();
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new Error("Invalid repair dispatch receipt.");
    this.save({
      ...state,
      requests: state.requests.map((r) => (r.id === id ? { ...r, receiptSequence: sequence } : r)),
    });
  }
  finish(): IntegrationState | undefined {
    let state = this.read();
    const request = state.requests.at(-1);
    const receiptPath = NodePath.join(state.checkout, ".fork-repair-complete.json");
    if (!request || !NodeFS.existsSync(receiptPath)) return undefined;
    if (request.completed) return this.advance(state);
    const receipt = readJsonFile<{ requestId: string; status: string; detail?: string }>(
      receiptPath,
    );
    if (receipt.requestId !== request.id) return undefined;
    if (receipt.status !== "completed")
      throw new Error(`Repair agent failed: ${receipt.detail ?? "no detail"}`);
    if (integrationGit(state.checkout, ["rev-parse", "HEAD"]) !== state.head)
      throw new Error("Repair agent changed HEAD.");
    if (unresolved(state.checkout).length)
      throw new Error("Repair receipt left unresolved conflicts.");
    if (integrationGit(state.checkout, ["diff", "--name-only"]))
      throw new Error("Repair receipt left unstaged changes.");
    if (integrationGit(state.checkout, ["ls-files", "--others", "--exclude-standard"]))
      throw new Error("Repair receipt left untracked files.");
    integrationGit(state.checkout, [
      "diff",
      "--cached",
      "--check",
      state.inputs.target,
      "--",
      ".",
      ":(exclude,glob)**/*.patch",
      ":(exclude).repos",
    ]);
    state = {
      ...state,
      requests: state.requests.map((r) => (r.id === request.id ? { ...r, completed: true } : r)),
    };
    if (state.replay.pending) state = this.commitReplay(state);
    else {
      const tree = integrationGit(state.checkout, ["write-tree"]);
      const head = integrationGit(state.checkout, [
        "commit-tree",
        tree,
        "-p",
        state.head,
        "-m",
        "fix(integration): repair upstream compatibility",
      ]);
      state = this.save({ ...state, head, qualitySha: undefined });
      integrationGit(state.checkout, ["reset", "--hard", head]);
    }
    return this.advance(state);
  }
  assertCandidate(): void {
    const state = this.read();
    if (state.status !== "prepared" && state.status !== "verified")
      throw new Error("Integration candidate is incomplete.");
    if (
      state.replay.index !== state.replay.commits.length ||
      integrationGit(state.checkout, [
        "rev-list",
        "--merges",
        `${state.inputs.target}..${state.head}`,
      ])
    )
      throw new Error("Candidate must replay every fork patch with linear history.");
    if (!ancestor(state.checkout, state.inputs.target, state.head))
      throw new Error("Candidate lost its upstream target.");
    const boundary = integrationGit(state.checkout, [
      "merge-base",
      state.inputs.source,
      state.inputs.target,
    ]);
    const forkPaths = new Set(
      integrationGit(state.checkout, ["diff", "--name-only", boundary, state.inputs.source]).split(
        "\n",
      ),
    );
    const patches = integrationGit(state.checkout, [
      "ls-tree",
      "-r",
      "--name-only",
      state.inputs.target,
    ])
      .split("\n")
      .filter((path) => path.endsWith(".patch") && !forkPaths.has(path));
    if (
      patches.length &&
      integrationGit(state.checkout, [
        "diff",
        "--name-only",
        state.inputs.target,
        state.head,
        "--",
        ...patches,
      ])
    )
      throw new Error("Repair changed upstream dependency patch assets.");
    // Vendored references are upstream input, including intentional whitespace.
    // Verify their exact snapshot instead of applying our source formatting rules.
    if (
      integrationGit(state.checkout, [
        "diff",
        "--name-only",
        state.inputs.target,
        state.head,
        "--",
        ".repos",
      ])
    )
      throw new Error("Repair changed upstream vendored references.");
    if (integrationGit(state.checkout, ["status", "--porcelain"]))
      throw new Error("Integration candidate is dirty.");
  }
  bundle(path: string, ref: string): IntegrationState {
    this.assertCandidate();
    const state = this.read();
    integrationGit(state.checkout, ["update-ref", ref, state.head]);
    const sourceRef = "refs/heads/fork-release/source-evidence";
    integrationGit(state.checkout, ["update-ref", sourceRef, state.inputs.source]);
    const refs = [ref, sourceRef];
    if (state.inputs.observed !== ZERO_SHA) {
      const observedRef = "refs/heads/fork-release/observed-evidence";
      integrationGit(state.checkout, ["update-ref", observedRef, state.inputs.observed]);
      refs.push(observedRef);
    }
    // Stable replays rewrite fork commits. Include their original objects so
    // native input comparisons on fresh workers can read the observed main.
    integrationGit(state.checkout, ["bundle", "create", path, ...refs]);
    return state;
  }
  markQuality(): void {
    const state = this.read();
    this.assertCandidate();
    this.save({ ...state, qualitySha: state.head });
  }
  markVerified(build: string): void {
    this.assertCandidate();
    const state = this.read();
    if (state.qualitySha !== state.head)
      throw new Error("Candidate has no passing quality receipt.");
    const cache = NodePath.join(state.checkout, ".git", "rr-cache");
    if (NodeFS.existsSync(cache))
      NodeFS.cpSync(cache, NodePath.join(this.stateDir, "verified-rerere"), { recursive: true });
    this.save({ ...state, status: "verified", verifiedBuild: build });
    atomicWriteJson(NodePath.join(this.stateDir, `${state.kind}-success.json`), {
      inputs: state.inputs,
      candidate: state.head,
      build,
    });
  }
}
/** These exact inputs already produced a candidate that passed every gate. */
export function verifiedIntegrationCurrent(
  stateDir: string,
  inputs: IntegrationInputs,
  kind: IntegrationState["kind"],
): boolean {
  const integration = new Integration(stateDir, inputs, undefined, kind);
  return NodeFS.existsSync(integration.statePath) && integration.read().status === "verified";
}
export type Dispatch = (payload: Record<string, unknown>) => Promise<number>;
/**
 * One thread per candidate: attempts on the same inputs keep their context, and a turn
 * still running for another lane or an older target never blocks a new repair.
 */
export function repairThreadId(state: Pick<IntegrationState, "kind" | "id">): string {
  return `t3-fork-repair-${state.kind === "stable" ? "stable" : "nightly"}-${state.id.slice(0, 16)}`;
}
function repairThreadTitle(state: Pick<IntegrationState, "kind" | "inputs">): string {
  const target = state.inputs.target.slice(0, 10);
  return state.kind === "stable"
    ? `Fork repair: stable ${target}`
    : `Fork repair: nightly ${target}`;
}
export async function dispatchRepair(
  integration: Integration,
  projectId: string,
  modelSelection: unknown,
  dispatch: Dispatch,
  feedback = "",
): Promise<RepairRequest> {
  const { state, request } = integration.request(feedback);
  const threadId = repairThreadId(state);
  // Persisted request IDs let a restarted Jenkins build reuse the same turn.
  if (request.receiptSequence !== undefined) return request;
  await dispatch({
    type: "thread.create",
    commandId: `fork-maintenance:create:${threadId}`,
    threadId,
    projectId,
    title: repairThreadTitle(state),
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: state.checkout,
    createdAt: request.createdAt,
  }).catch(() => {
    // Older servers return 500 on a repeated deterministic create. The meta
    // update below must succeed before any work is dispatched.
  });
  await dispatch({
    type: "thread.session.stop",
    commandId: `${request.id}:stop-previous`,
    threadId,
    createdAt: request.createdAt,
  });
  await dispatch({
    type: "thread.meta.update",
    commandId: `${request.id}:workspace`,
    threadId,
    branch: null,
    worktreePath: state.checkout,
  });
  const sequence = await dispatch({
    type: "thread.turn.start",
    commandId: request.id,
    threadId,
    message: { messageId: request.id, role: "user", text: request.message, attachments: [] },
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: request.createdAt,
  });
  integration.accepted(request.id, sequence);
  return request;
}
/** Ends the candidate's repair turn so a timed-out wait leaves nothing running. */
export async function stopRepair(integration: Integration, dispatch: Dispatch): Promise<void> {
  const state = integration.read();
  const request = state.requests.at(-1);
  if (!request) return;
  await dispatch({
    type: "thread.session.stop",
    commandId: `${request.id}:stop-after-wait`,
    threadId: repairThreadId(state),
    createdAt: new Date().toISOString(),
  });
}
export function workflowLock(
  stateDir: string,
  operation: "acquire" | "release",
  owner: string,
): { acquired: boolean; owner?: string | undefined } {
  if (!/^.+#\d+$/.test(owner)) throw new Error("Workflow lock owner must be a Jenkins run ID.");
  const path = NodePath.join(stateDir, "workflow-lock.json");
  const previous = NodeFS.existsSync(path)
    ? readJsonFile<{ owner: string }>(path).owner
    : undefined;
  if (operation === "release") {
    if (previous === owner) NodeFS.rmSync(path);
    return { acquired: false, owner: previous };
  }
  if (previous && previous !== owner) return { acquired: false, owner: previous };
  atomicWriteJson(path, { owner });
  return { acquired: true, owner };
}
