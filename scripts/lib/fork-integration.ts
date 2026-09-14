// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { assertFullSha, atomicWriteJson, readJsonFile } from "./fork-release.ts";

export const ZERO_SHA = "0".repeat(40);
export const REPAIR_LIMIT = 2;
export const AUTOMATION_PATHS = [
  "Jenkinsfile",
  "scripts/diagnose-apple-notarization.ts",
  "docs/operations/fork-releases.md",
  "scripts/fork-release.test.ts",
  "scripts/fork-integration.test.ts",
  "scripts/fork-release.ts",
  "scripts/lib/fork-release.ts",
  "scripts/fork-integration.ts",
  "scripts/lib/fork-integration.ts",
  "scripts/fork-release-bootstrap.json",
  "scripts/fork-release-bootstrap/collections-v0.0.40.patch",
];
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
}
export interface IntegrationState {
  readonly schemaVersion: 1;
  readonly kind: "integration" | "stable";
  readonly replay?: {
    readonly commits: ReadonlyArray<string>;
    readonly index: number;
    readonly pending?: string;
  };
  readonly id: string;
  readonly inputs: IntegrationInputs;
  readonly checkout: string;
  readonly shareWithUid?: number;
  readonly head: string;
  readonly merged: ReadonlyArray<"source" | "target">;
  readonly merging?: "source" | "target" | undefined;
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
export function integrationGit(cwd: string, args: ReadonlyArray<string>): string {
  return run("git", ["-c", `safe.directory=${cwd}`, ...args], cwd);
}
function ancestor(cwd: string, older: string, newer: string): boolean {
  return (
    NodeChildProcess.spawnSync(
      "git",
      ["-c", `safe.directory=${cwd}`, "merge-base", "--is-ancestor", older, newer],
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
  const owned: string[] = [];
  const directories: string[] = [];
  const visit = (path: string) => {
    const stat = NodeFS.lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.uid === process.getuid?.()) {
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
    run("setfacl", ["-m", `d:u:${uid}:rwx`, ...directories.slice(index, index + 200)]);
  }
}

export class Integration {
  readonly journal: string;
  readonly statePath: string;
  readonly workspaceRoot: string;
  readonly stateDir: string;
  readonly inputs: IntegrationInputs;
  readonly kind: "integration" | "stable";
  constructor(
    stateDir: string,
    inputs: IntegrationInputs,
    workspaceRoot?: string,
    kind: "integration" | "stable" = "integration",
  ) {
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
    const head =
      this.kind === "stable"
        ? this.inputs.target
        : this.inputs.observed === ZERO_SHA
          ? this.inputs.source
          : this.inputs.observed;
    const boundary = integrationGit(checkout, [
      "merge-base",
      this.inputs.source,
      this.inputs.target,
    ]);
    const commits =
      this.kind === "stable"
        ? integrationGit(checkout, ["rev-list", "--reverse", `${boundary}..${this.inputs.source}`])
            .split("\n")
            .filter(Boolean)
        : [];
    for (const commit of commits) {
      if (
        integrationGit(checkout, ["rev-list", "--parents", "-n", "1", commit]).split(" ").length !==
        2
      )
        throw new Error("Stable source patch range contains a merge commit.");
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
        ...(this.kind === "stable" ? { replay: { commits, index: 0 } } : {}),
        id,
        inputs: this.inputs,
        checkout,
        ...(shareWithUid === undefined ? {} : { shareWithUid }),
        head,
        merged: [],
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
      NodeChildProcess.spawnSync(
        "git",
        ["-c", `safe.directory=${state.checkout}`, "cherry-pick", "--quit"],
        { cwd: state.checkout },
      );
      integrationGit(state.checkout, ["reset", "--hard", state.head]);
    }
    if (state.kind === "stable") return this.advanceStable(state);
    for (const merging of ["source", "target"] as const) {
      if (state.merged.includes(merging)) continue;
      const incoming = state.inputs[merging];
      if (ancestor(state.checkout, incoming, state.head)) {
        state = this.save({ ...state, merged: [...state.merged, merging] });
        continue;
      }
      // Persist intent before Git: resume an interrupted merge in place.
      state = this.save({ ...state, merging });
      const mergeHead = NodePath.join(state.checkout, ".git", "MERGE_HEAD");
      if (!NodeFS.existsSync(mergeHead)) {
        const result = NodeChildProcess.spawnSync(
          "git",
          ["-c", `safe.directory=${state.checkout}`, "merge", "--no-ff", "--no-commit", incoming],
          { cwd: state.checkout, encoding: "utf8" },
        );
        if (result.status !== 0 && !NodeFS.existsSync(mergeHead))
          throw new Error(`Integration merge failed: ${result.stderr || result.stdout}`);
      }
      let conflicts = this.resolveAutomationConflicts(state);
      if (conflicts.length === 1 && conflicts[0] === "pnpm-lock.yaml") {
        integrationGit(state.checkout, ["checkout", "--ours", "--", "pnpm-lock.yaml"]);
        run("corepack", ["pnpm", "install", "--lockfile-only", "--ignore-scripts"], state.checkout);
        integrationGit(state.checkout, ["add", "--", "pnpm-lock.yaml"]);
        conflicts = unresolved(state.checkout);
      }
      if (conflicts.length) return this.save({ ...state, status: "needs-repair", conflicts });
      state = this.commitMerge(state);
    }
    return this.save({ ...state, status: "prepared", merging: undefined });
  }
  private resolveAutomationConflicts(state: IntegrationState): string[] {
    // Historical automation revisions do not override the reviewed frozen source,
    // and must not spend repair attempts intended for application compatibility.
    for (const path of unresolved(state.checkout).filter((path) =>
      AUTOMATION_PATHS.includes(path),
    )) {
      if (
        integrationGit(state.checkout, ["ls-tree", "--name-only", state.inputs.source, "--", path])
      ) {
        integrationGit(state.checkout, ["checkout", state.inputs.source, "--", path]);
      } else {
        integrationGit(state.checkout, ["rm", "-f", "--", path]);
      }
    }
    return unresolved(state.checkout);
  }
  private advanceStable(initial: IntegrationState): IntegrationState {
    let state = initial;
    while (state.replay && state.replay.index < state.replay.commits.length) {
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
          ["-c", `safe.directory=${state.checkout}`, "cherry-pick", "--no-commit", commit],
          { cwd: state.checkout, encoding: "utf8" },
        );
        if (
          result.status !== 0 &&
          !unresolved(state.checkout).length &&
          !NodeFS.existsSync(NodePath.join(state.checkout, ".git", "MERGE_MSG"))
        )
          throw new Error(`Stable replay failed: ${result.stderr || result.stdout}`);
      }
      let conflicts = this.resolveAutomationConflicts(state);
      if (conflicts.length === 1 && conflicts[0] === "pnpm-lock.yaml") {
        integrationGit(state.checkout, ["checkout", "--ours", "--", "pnpm-lock.yaml"]);
        run("corepack", ["pnpm", "install", "--lockfile-only", "--ignore-scripts"], state.checkout);
        integrationGit(state.checkout, ["add", "--", "pnpm-lock.yaml"]);
        conflicts = unresolved(state.checkout);
      }
      if (conflicts.length) return this.save({ ...state, status: "needs-repair", conflicts });
      state = this.commitStable(state);
    }
    return this.save({ ...state, status: "prepared" });
  }
  private commitStable(state: IntegrationState): IntegrationState {
    const replay = state.replay;
    if (!replay?.pending) throw new Error("Missing stable replay patch.");
    integrationGit(state.checkout, [
      "diff",
      "--cached",
      "--check",
      "--",
      ".",
      ":(exclude,glob)**/*.patch",
      ":(exclude).repos",
    ]);
    const tree = integrationGit(state.checkout, ["write-tree"]);
    const message = integrationGit(state.checkout, ["show", "-s", "--format=%B", replay.pending]);
    const result = NodeChildProcess.spawnSync(
      "git",
      ["-c", `safe.directory=${state.checkout}`, "commit-tree", tree, "-p", state.head],
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
    const head = assertFullSha(result.stdout.trim(), "Stable replay candidate");
    integrationGit(state.checkout, ["rerere"]);
    state = this.save({
      ...state,
      head,
      replay: { commits: replay.commits, index: replay.index + 1 },
      conflicts: [],
      status: "preparing",
    });
    NodeChildProcess.spawnSync(
      "git",
      ["-c", `safe.directory=${state.checkout}`, "cherry-pick", "--quit"],
      { cwd: state.checkout },
    );
    integrationGit(state.checkout, ["reset", "--hard", head]);
    return state;
  }
  private commitMerge(state: IntegrationState): IntegrationState {
    if (!state.merging) throw new Error("Missing pending merge.");
    const mergeHead = integrationGit(state.checkout, ["rev-parse", "MERGE_HEAD"]);
    if (mergeHead !== state.inputs[state.merging])
      throw new Error("Repair changed the merge target.");
    integrationGit(state.checkout, [
      "diff",
      "--cached",
      "--check",
      "--",
      ".",
      ":(exclude,glob)**/*.patch",
      ":(exclude).repos",
    ]);
    const tree = integrationGit(state.checkout, ["write-tree"]);
    const result = NodeChildProcess.spawnSync(
      "git",
      [
        "-c",
        `safe.directory=${state.checkout}`,
        "commit-tree",
        tree,
        "-p",
        state.head,
        "-p",
        mergeHead,
      ],
      {
        cwd: state.checkout,
        input: `Merge ${state.merging} ${mergeHead} into fork integration\n`,
        encoding: "utf8",
      },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    const head = assertFullSha(result.stdout.trim(), "Merged candidate");
    integrationGit(state.checkout, ["rerere"]);
    state = this.save({
      ...state,
      head,
      merged: [...state.merged, state.merging],
      merging: undefined,
      conflicts: [],
      status: "preparing",
    });
    integrationGit(state.checkout, ["reset", "--hard", head]);
    return state;
  }
  request(feedback = ""): { state: IntegrationState; request: RepairRequest } {
    let state = this.read();
    const previous = state.requests.at(-1);
    if (previous && !previous.completed) return { state, request: previous };
    if (state.requests.length >= REPAIR_LIMIT)
      throw new Error(
        `Automatic repair exhausted ${REPAIR_LIMIT} attempts for input ${state.id}; unchanged retries will reuse this incident.`,
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
      `Candidate policy: ${state.kind === "stable" ? "linear replay onto the exact official stable release; never merge or use the integration tip" : "persistent development integration merges"}.`,
      "Perform this authorized automatic fork maintenance repair now, then return a completion receipt. Do not delegate or ask for confirmation.",
      `Work ONLY in ${state.checkout}. This is a disposable shared checkout. The user's project directory and live T3 data must not be changed.`,
      `Frozen source main: ${state.inputs.source}; upstream target: ${state.inputs.target}; observed integration: ${state.inputs.observed}; HEAD must remain ${state.head}.`,
      `Use git -c safe.directory=${state.checkout} for Git commands in this checkout. Do not create commits, reset HEAD, abort a merge, change remotes, push, release, or alter Jenkins/signing credentials. Jenkins creates commits and promotes only after its gates pass.`,
      "Preserve upstream changes and fork Collections on web/desktop/mobile, multi-window support, remote connections, and fork update identity. Read both sides of each conflict; do not resolve application files wholesale with ours/theirs. Preserve independent upstream and fork tests. For dependency changes align React and react-test-renderer and regenerate pnpm-lock.yaml after resolving manifests. Preserve upstream dependency .patch assets and read-only .repos references byte for byte; their whitespace is part of the upstream snapshot. Exclude **/*.patch and .repos when running git diff --check.",
      `Unresolved paths: ${state.conflicts.join(", ") || "none; repair the gate failure below"}.`,
      `Protected automation files must exactly match the frozen source: ${AUTOMATION_PATHS.join(", ")}. Do not weaken tests or verification gates.`,
      "Run only focused checks relevant to the repair when tools are already available. Do not install the entire workspace just to run checks; Jenkins owns dependency installation, repository-wide checks, and native builds. If local test tooling is unavailable, finish the source resolution and return the receipt so Jenkins can supply gate feedback. Do not start browsers, dev servers, devices, or touch live ~/.t3/userdata.",
      feedback
        ? `Jenkins installed the workspace dependencies in this checkout before this feedback attempt. Run the failing focused tests locally and iterate until they pass, including follow-on errors that the first missing mock export may have hidden. Run the relevant scoped type checks for production changes. Parser checks alone are not sufficient when the test runner is available.\nJenkins gate feedback:\n${feedback.slice(-16000)}`
        : "Inspect the merge diff and relevant upstream commits before adapting the fork.",
      `Before returning the receipt, run node scripts/fork-integration.ts share --checkout ${state.checkout} --uid ${process.getuid?.()} from this checkout. It grants Jenkins access only to files you own here, excluding dependencies and symlink targets.`,
      `Stage all intended tracked repairs, ensure no unresolved paths or unstaged edits remain, then write ${NodePath.join(state.checkout, ".fork-repair-complete.json")} atomically with exactly {"requestId":${JSON.stringify(id)},"status":"completed"}. Create the receipt with mode 0644 so Jenkins can read it. This receipt is the last filesystem operation; finish the turn immediately afterward. If unable to resolve, write the same receipt with status "failed" and a concise detail. Never fabricate success.`,
    ].join("\n\n");
    const request = { id, attempt, message, createdAt: new Date().toISOString() };
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
      "--",
      ".",
      ":(exclude,glob)**/*.patch",
      ":(exclude).repos",
    ]);
    state = {
      ...state,
      requests: state.requests.map((r) => (r.id === request.id ? { ...r, completed: true } : r)),
    };
    if (state.replay?.pending) state = this.commitStable(state);
    else if (state.merging) state = this.commitMerge(state);
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
    const parents =
      state.kind === "stable"
        ? [state.inputs.target]
        : [state.inputs.source, state.inputs.target, state.inputs.observed];
    if (
      state.kind === "stable" &&
      (state.replay?.index !== state.replay?.commits.length ||
        integrationGit(state.checkout, [
          "rev-list",
          "--merges",
          `${state.inputs.target}..${state.head}`,
        ]))
    )
      throw new Error("Stable candidate must replay every fork patch with linear history.");
    for (const input of parents) {
      if (input !== ZERO_SHA && !ancestor(state.checkout, input, state.head))
        throw new Error("Integration candidate lost an input parent.");
    }
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
    if (
      integrationGit(state.checkout, [
        "diff",
        "--name-only",
        state.inputs.source,
        state.head,
        "--",
        ...AUTOMATION_PATHS,
      ])
    )
      throw new Error("Repair changed protected automation source.");
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
  private persistVerifiedResolutions(state: IntegrationState): void {
    if (state.kind !== "integration") return;
    const range =
      state.inputs.observed === ZERO_SHA ? state.head : `${state.inputs.observed}..${state.head}`;
    const merges = integrationGit(state.checkout, [
      "rev-list",
      "--first-parent",
      "--min-parents=2",
      range,
    ])
      .split("\n")
      .filter(Boolean);
    const merge = merges.find(
      (commit) =>
        integrationGit(state.checkout, ["rev-parse", `${commit}^2`]) === state.inputs.target,
    );
    if (!merge) return;
    // Reconstruct the actual conflict preimages, then record the final tested
    // blobs. Feedback may have changed the original resolution or cleared its
    // private cache, so exporting that earlier cache is insufficient.
    const temporary = NodeFS.mkdtempSync(NodePath.join(this.journal, "verified-cache-"));
    const scratch = NodePath.join(temporary, "checkout");
    try {
      run("git", ["clone", "--no-hardlinks", "--no-checkout", state.checkout, scratch]);
      integrationGit(scratch, ["config", "user.name", "T3 Code maintenance"]);
      integrationGit(scratch, ["config", "user.email", "maintenance@tapnetix.com"]);
      integrationGit(scratch, ["config", "rerere.enabled", "true"]);
      integrationGit(scratch, [
        "checkout",
        "--detach",
        integrationGit(state.checkout, ["rev-parse", `${merge}^1`]),
      ]);
      const result = NodeChildProcess.spawnSync(
        "git",
        ["merge", "--no-ff", "--no-commit", state.inputs.target],
        { cwd: scratch, encoding: "utf8" },
      );
      const conflicts = unresolved(scratch);
      if (result.status !== 0 && !conflicts.length)
        throw new Error("Could not reconstruct verified merge resolutions.");
      for (const path of conflicts) {
        const exists =
          NodeChildProcess.spawnSync("git", ["cat-file", "-e", `${state.head}:${path}`], {
            cwd: scratch,
          }).status === 0;
        integrationGit(
          scratch,
          exists ? ["checkout", state.head, "--", path] : ["rm", "--force", "--", path],
        );
      }
      integrationGit(scratch, ["rerere"]);
      const cache = NodePath.join(scratch, ".git", "rr-cache");
      if (NodeFS.existsSync(cache)) {
        for (const entry of NodeFS.readdirSync(cache)) {
          const directory = NodePath.join(cache, entry);
          if (NodeFS.readdirSync(directory).some((name) => name.startsWith("postimage"))) {
            NodeFS.cpSync(directory, NodePath.join(this.stateDir, "verified-rerere", entry), {
              recursive: true,
            });
          }
        }
      }
    } finally {
      NodeFS.rmSync(temporary, { recursive: true, force: true });
    }
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
    this.persistVerifiedResolutions(state);
    if (state.kind === "stable") {
      const cache = NodePath.join(state.checkout, ".git", "rr-cache");
      if (NodeFS.existsSync(cache))
        NodeFS.cpSync(cache, NodePath.join(this.stateDir, "verified-rerere"), { recursive: true });
    }
    this.save({ ...state, status: "verified", verifiedBuild: build });
    atomicWriteJson(NodePath.join(this.stateDir, `${state.kind}-success.json`), {
      inputs: state.inputs,
      candidate: state.head,
      build,
    });
  }
}
export function verifiedIntegrationCurrent(
  stateDir: string,
  repository: string,
  inputs: IntegrationInputs,
): boolean {
  const path = NodePath.join(stateDir, "integration-success.json");
  if (!NodeFS.existsSync(path)) return false;
  const receipt = readJsonFile<{ candidate: string }>(path);
  return (
    receipt.candidate === inputs.observed &&
    ancestor(repository, inputs.source, inputs.observed) &&
    ancestor(repository, inputs.target, inputs.observed)
  );
}
export type Dispatch = (payload: Record<string, unknown>) => Promise<number>;
export async function dispatchRepair(
  integration: Integration,
  projectId: string,
  modelSelection: unknown,
  dispatch: Dispatch,
  feedback = "",
): Promise<RepairRequest> {
  const { state, request } = integration.request(feedback);
  const threadId = "t3-fork-maintenance-integration";
  // Persisted request IDs let a restarted Jenkins build reuse the same turn.
  if (request.receiptSequence !== undefined) return request;
  await dispatch({
    type: "thread.create",
    commandId: "fork-maintenance:create",
    threadId,
    projectId,
    title: "Automatic fork maintenance",
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
