// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  Integration,
  ZERO_SHA,
  dispatchRepair,
  integrationGit,
  verifiedIntegrationCurrent,
  workflowLock,
} from "./lib/fork-integration.ts";
import { atomicWriteJson } from "./lib/fork-release.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-integration-test-"));
  roots.push(root);
  const repo = NodePath.join(root, "repo");
  NodeFS.mkdirSync(repo);
  NodeChildProcess.execFileSync("git", ["init", "-b", "main", repo]);
  const git = (args: string[]) => integrationGit(repo, args);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  const commit = (file: string, text: string) => {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(repo, file)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(repo, file), text);
    git(["add", file]);
    git(["commit", "-m", `Change ${file}`]);
    return git(["rev-parse", "HEAD"]);
  };
  const base = commit("feature.txt", "base\n");
  const source = commit("feature.txt", "fork feature\n");
  git(["checkout", "--detach", base]);
  const target = commit("feature.txt", "new upstream feature\n");
  const stateDir = NodePath.join(root, "state");
  NodeFS.mkdirSync(stateDir);
  const inputs = { source, target, observed: ZERO_SHA };
  const integration = new Integration(stateDir, inputs, NodePath.join(root, "workers"));
  const repair = (value: Integration, text = "upstream plus fork\n") => {
    const state = value.read(),
      request = state.requests.at(-1)!;
    NodeFS.writeFileSync(NodePath.join(state.checkout, "feature.txt"), text);
    integrationGit(state.checkout, ["add", "feature.txt"]);
    atomicWriteJson(NodePath.join(state.checkout, ".fork-repair-complete.json"), {
      requestId: request.id,
      status: "completed",
    });
    return value.finish()!;
  };
  return { root, repo, git, commit, base, source, target, stateDir, inputs, integration, repair };
}

describe("persistent integration", () => {
  it("preserves a resolved merge through new upstream and main commits", () => {
    const f = fixture();
    expect(f.integration.prepare(f.repo).conflicts).toEqual(["feature.txt"]);
    f.integration.request();
    f.integration.accepted(f.integration.read().requests[0]!.id, 1);
    const first = f.repair(f.integration);
    f.integration.markQuality();
    f.integration.markVerified("build/1");
    expect(
      verifiedIntegrationCurrent(f.stateDir, f.repo, { ...f.inputs, observed: first.head }),
    ).toBe(false); // candidate not yet in source clone
    f.git(["fetch", first.checkout, `${first.head}:refs/heads/integration`]);
    expect(
      verifiedIntegrationCurrent(f.stateDir, f.repo, { ...f.inputs, observed: first.head }),
    ).toBe(true);
    f.git(["checkout", "--detach", f.target]);
    const target = f.commit("upstream.txt", "next upstream\n");
    f.git(["checkout", "--detach", f.source]);
    const source = f.commit("fork.txt", "new fork change\n");
    const next = new Integration(
      f.stateDir,
      { source, target, observed: first.head },
      NodePath.join(f.root, "workers"),
    );
    const second = next.prepare(f.repo);
    expect(second.status).toBe("prepared");
    expect(second.requests).toHaveLength(0);
    expect(NodeFS.readFileSync(NodePath.join(second.checkout, "feature.txt"), "utf8")).toBe(
      "upstream plus fork\n",
    );
    expect(NodeFS.existsSync(NodePath.join(second.checkout, "fork.txt"))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(second.checkout, "upstream.txt"))).toBe(true);
    next.assertCandidate();
  });
  it("takes canonical maintenance files from main without spending an agent attempt", () => {
    const f = fixture();
    NodeChildProcess.spawnSync("git", ["merge", "--no-commit", f.source], { cwd: f.repo });
    f.commit("feature.txt", "upstream plus fork\n");
    const observed = f.commit("docs/operations/fork-releases.md", "old integration notes\n");
    f.git(["checkout", "--detach", f.source]);
    const source = f.commit(
      "docs/operations/fork-releases.md",
      "canonical automation instructions\n",
    );
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, source, observed },
      NodePath.join(f.root, "workers"),
    );
    const candidate = next.prepare(f.repo);
    expect(candidate.status).toBe("prepared");
    expect(candidate.requests).toHaveLength(0);
    expect(
      NodeFS.readFileSync(
        NodePath.join(candidate.checkout, "docs/operations/fork-releases.md"),
        "utf8",
      ),
    ).toBe("canonical automation instructions\n");
    expect(NodeFS.readFileSync(NodePath.join(candidate.checkout, "feature.txt"), "utf8")).toBe(
      "upstream plus fork\n",
    );
  });

  it("reuses the same pending turn after Jenkins restarts and limits repairs per input", async () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    const commands: string[] = [];
    const dispatch = async (payload: Record<string, unknown>) => {
      commands.push(String(payload.type));
      return 1;
    };
    const first = await dispatchRepair(
      f.integration,
      "project",
      { instanceId: "codex", model: "test" },
      dispatch,
    );
    const resumed = new Integration(f.stateDir, f.inputs, NodePath.join(f.root, "workers"));
    expect(resumed.prepare(f.repo).status).toBe("needs-repair");
    expect((await dispatchRepair(resumed, "project", {}, dispatch)).id).toBe(first.id);
    expect(commands.filter((c) => c === "thread.turn.start")).toHaveLength(1);
    f.repair(resumed);
    await dispatchRepair(resumed, "project", {}, dispatch, "test failed");
    f.repair(resumed);
    expect(() => resumed.request("still failed")).toThrow(/exhausted 2 attempts/);
    expect(resumed.read().requests).toHaveLength(2);
  });
  it("does not treat dispatch acceptance as repair completion", () => {
    const f = fixture();
    const state = f.integration.prepare(f.repo);
    const { request } = f.integration.request();
    f.integration.accepted(request.id, 10);
    expect(f.integration.finish()).toBeUndefined();
    atomicWriteJson(NodePath.join(state.checkout, ".fork-repair-complete.json"), {
      requestId: "older-request",
      status: "completed",
    });
    expect(f.integration.finish()).toBeUndefined();
    atomicWriteJson(NodePath.join(state.checkout, ".fork-repair-complete.json"), {
      requestId: request.id,
      status: "completed",
    });
    expect(() => f.integration.finish()).toThrow(/unresolved conflicts/);
  });
  it("rejects a repair which changed the frozen HEAD", () => {
    const f = fixture();
    const state = f.integration.prepare(f.repo);
    const { request } = f.integration.request();
    integrationGit(state.checkout, ["reset", "--hard", f.target]);
    atomicWriteJson(NodePath.join(state.checkout, ".fork-repair-complete.json"), {
      requestId: request.id,
      status: "completed",
    });
    expect(() => f.integration.finish()).toThrow(/changed HEAD/);
  });
  it("keeps failed candidates out of the success journal and shared rerere cache", () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    f.integration.request();
    f.repair(f.integration);
    expect(() => f.integration.markVerified("build/failed")).toThrow(/passing quality/);
    expect(NodeFS.existsSync(NodePath.join(f.stateDir, "integration-success.json"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(f.stateDir, "verified-rerere"))).toBe(false);
    f.integration.markQuality();
    f.integration.markVerified("build/passed");
    expect(NodeFS.existsSync(NodePath.join(f.stateDir, "verified-rerere"))).toBe(true);
  });
  it("reuses a validated Git resolution when a fresh merge meets the same conflict", () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    f.integration.request();
    f.repair(f.integration);
    f.integration.markQuality();
    f.integration.markVerified("build/passed");
    f.git(["checkout", "--detach", f.target]);
    const target = f.commit("unrelated.txt", "next\n");
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, target },
      NodePath.join(f.root, "workers"),
    );
    expect(next.prepare(f.repo).status).toBe("prepared");
    expect(NodeFS.readFileSync(NodePath.join(next.read().checkout, "feature.txt"), "utf8")).toBe(
      "upstream plus fork\n",
    );
  });
  it("consumes each completion receipt only once", () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    f.integration.request();
    const done = f.repair(f.integration);
    expect(f.integration.finish()!.head).toBe(done.head);
    expect(new Integration(f.stateDir, f.inputs).prepare(f.repo).head).toBe(done.head);
  });
});

describe("interrupted state transitions", () => {
  it("recovers a committed merge journal when checkout reset was interrupted", () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    f.integration.request();
    const completed = f.repair(f.integration);
    integrationGit(completed.checkout, ["reset", "--hard", f.source]);
    f.integration.save({ ...completed, status: "preparing" });
    const resumed = new Integration(f.stateDir, f.inputs).prepare(f.repo);
    expect(resumed.head).toBe(completed.head);
    expect(integrationGit(resumed.checkout, ["rev-parse", "HEAD"])).toBe(completed.head);
    expect(NodeFS.readFileSync(NodePath.join(resumed.checkout, "feature.txt"), "utf8")).toBe(
      "upstream plus fork\n",
    );
  });
  it("does not drop a stable patch if Jenkins stopped before the cherry-pick started", () => {
    const f = fixture();
    const stable = new Integration(
      f.stateDir,
      f.inputs,
      NodePath.join(f.root, "workers"),
      "stable",
    );
    const pending = stable.prepare(f.repo);
    integrationGit(pending.checkout, ["reset", "--hard", f.target]);
    stable.save({ ...pending, status: "preparing" });
    const resumed = new Integration(f.stateDir, f.inputs, undefined, "stable").prepare(f.repo);
    expect(resumed.status).toBe("needs-repair");
    expect(resumed.conflicts).toEqual(["feature.txt"]);
    expect(resumed.replay?.index).toBe(0);
  });
});

describe("stable candidate repair", () => {
  it("replays every fork patch onto the exact stable target without merge commits", () => {
    const f = fixture();
    f.git(["checkout", "--detach", f.source]);
    const source = f.commit("extra-fork.txt", "second fork patch\n");
    const stable = new Integration(
      f.stateDir,
      { ...f.inputs, source },
      NodePath.join(f.root, "workers"),
      "stable",
    );
    const pending = stable.prepare(f.repo);
    expect(pending.head).toBe(f.target);
    expect(pending.conflicts).toEqual(["feature.txt"]);
    stable.request();
    const candidate = f.repair(stable);
    stable.assertCandidate();
    expect(candidate.replay?.index).toBe(2);
    expect(
      integrationGit(candidate.checkout, [
        "rev-list",
        "--merges",
        `${f.target}..${candidate.head}`,
      ]),
    ).toBe("");
    expect(
      integrationGit(candidate.checkout, ["rev-list", "--count", `${f.target}..${candidate.head}`]),
    ).toBe("2");
    expect(NodeFS.readFileSync(NodePath.join(candidate.checkout, "extra-fork.txt"), "utf8")).toBe(
      "second fork patch\n",
    );
  });
});

describe("workflow ownership", () => {
  it("serializes branch jobs and does not let an old owner release the new owner's lock", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-lock-test-"));
    roots.push(dir);
    expect(workflowLock(dir, "acquire", "t3code/main#9").acquired).toBe(true);
    expect(workflowLock(dir, "acquire", "t3code/fix#2")).toEqual({
      acquired: false,
      owner: "t3code/main#9",
    });
    workflowLock(dir, "release", "t3code/main#9");
    workflowLock(dir, "acquire", "t3code/fix#2");
    workflowLock(dir, "release", "t3code/main#9");
    expect(workflowLock(dir, "acquire", "t3code/main#10").owner).toBe("t3code/fix#2");
  });
});

describe("incident delivery", () => {
  it("updates one incident across new targets and records the successful recovery URL", async () => {
    const f = fixture();
    f.git(["checkout", "--detach", f.target]);
    const nextTarget = f.commit("later.txt", "next upstream\n");
    const ghState = NodePath.join(f.root, "github.json");
    NodeFS.writeFileSync(ghState, JSON.stringify({ issues: [], comments: [] }));
    const fakeGh = NodePath.join(f.root, "gh");
    NodeFS.writeFileSync(
      fakeGh,
      String.raw`#!/usr/bin/env python3
import json,os,sys
p=os.environ['FAKE_GH_STATE']; s=json.load(open(p)); a=sys.argv[1:]
def value(flag): return a[a.index(flag)+1]
if a[:2]==['issue','list']: print(json.dumps(s['issues']))
elif a[:2]==['issue','create']:
    issue={'number':len(s['issues'])+1,'state':'OPEN','body':value('--body'),'title':value('--title'),'url':'https://example.test/issues/1'}
    s['issues'].append(issue); print(issue['url'])
elif a[:2]==['issue','comment']: s['comments'].append({'body':value('--body')})
elif a[:2]==['issue','close']: s['issues'][int(a[2])-1]['state']='CLOSED'
elif a[0]=='api': print(json.dumps([s['comments']]))
else: raise Exception(a)
json.dump(s,open(p,'w'))
`,
      { mode: 0o755 },
    );
    const dispatched: Array<{ threadId: string; incidentKey: string; state: string; url: string }> =
      [];
    const server = NodeHttp.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        dispatched.push(JSON.parse(body));
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ sequence: dispatched.length }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing HTTP address.");
      const execute = (args: string[], build: string) =>
        new Promise<void>((resolve, reject) => {
          const child = NodeChildProcess.spawn(
            process.execPath,
            [
              "--experimental-strip-types",
              NodePath.resolve(import.meta.dirname, "fork-release.ts"),
              "incident",
              ...args,
              "--state-dir",
              f.stateDir,
            ],
            {
              cwd: f.repo,
              env: {
                ...process.env,
                PATH: `${f.root}:${process.env.PATH}`,
                FAKE_GH_STATE: ghState,
                JOB_NAME: "t3code/main",
                BUILD_NUMBER: build,
                T3CODE_JENKINS_BASE_URL: `http://127.0.0.1:${address.port}`,
                T3CODE_JENKINS_TOKEN: "test-credential",
                T3CODE_JENKINS_PROJECT_ID: "project",
              },
            },
          );
          let stderr = "";
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
        });
      const common = [
        "open",
        "--mode",
        "nightly-integration",
        "--title",
        "Maintenance failed",
        "--summary",
        "Repair required",
      ];
      await execute(
        [
          ...common,
          "--target-identity",
          `commit:${f.target}`,
          "--failure-class",
          "patch-replay",
          "--url",
          "https://build/failed-1",
        ],
        "1",
      );
      await execute(
        [
          ...common,
          "--target-identity",
          `commit:${nextTarget}`,
          "--failure-class",
          "validation",
          "--url",
          "https://build/failed-2",
        ],
        "2",
      );
      const pending = JSON.parse(NodeFS.readFileSync(ghState, "utf8")) as {
        issues: Array<{ state: string }>;
        comments: Array<{ body: string }>;
      };
      expect(pending.issues).toHaveLength(1);
      expect(pending.comments).toHaveLength(2);
      expect(new Set(dispatched.map((item) => item.threadId)).size).toBe(1);
      expect(new Set(dispatched.map((item) => item.incidentKey)).size).toBe(1);
      await execute(
        ["recover", "--target-identity", `commit:${nextTarget}`, "--url", "https://build/success"],
        "3",
      );
      const recovered = JSON.parse(NodeFS.readFileSync(ghState, "utf8")) as typeof pending;
      expect(recovered.issues[0]!.state).toBe("CLOSED");
      expect(
        recovered.comments
          .filter((c) => c.body.startsWith("Recovered by"))
          .every((c) => c.body.includes("https://build/success")),
      ).toBe(true);
      expect(
        dispatched
          .filter((item) => item.state === "recovered")
          .every((item) => item.url === "https://build/success"),
      ).toBe(true);
      const count = dispatched.length;
      await execute(["drain"], "4");
      expect(dispatched).toHaveLength(count);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
