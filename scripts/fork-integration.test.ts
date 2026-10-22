// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  Integration,
  STABLE_SOURCE_REPAIR_LIMIT,
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

  it("preserves meaningful blank context lines in upstream dependency patches", () => {
    const f = fixture();
    const patch = "--- a/file\n+++ b/file\n@@ -1,2 +1,2 @@\n \n-old\n+new\n";
    const target = f.commit("patches/dependency.patch", patch);
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, target },
      NodePath.join(f.root, "workers"),
    );
    next.prepare(f.repo);
    next.request();
    f.repair(next);
    next.assertCandidate();
    const checkout = next.read().checkout;
    expect(NodeFS.readFileSync(NodePath.join(checkout, "patches/dependency.patch"), "utf8")).toBe(
      patch,
    );
    NodeFS.writeFileSync(
      NodePath.join(checkout, "patches/dependency.patch"),
      patch.replace("\n \n", "\n\n"),
    );
    integrationGit(checkout, ["add", "patches/dependency.patch"]);
    integrationGit(checkout, ["commit", "-m", "Corrupt patch context"]);
    next.save({ ...next.read(), head: integrationGit(checkout, ["rev-parse", "HEAD"]) });
    expect(() => next.assertCandidate()).toThrow(/dependency patch assets/);
  });

  it("preserves upstream vendored references with whitespace while rejecting edits", () => {
    const f = fixture();
    const reference = "upstream reference with trailing space \n\n";
    const target = f.commit(".repos/example/reference.txt", reference);
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, target },
      NodePath.join(f.root, "workers"),
    );
    next.prepare(f.repo);
    next.request();
    f.repair(next);
    next.assertCandidate();
    const checkout = next.read().checkout;
    const path = NodePath.join(checkout, ".repos/example/reference.txt");
    expect(NodeFS.readFileSync(path, "utf8")).toBe(reference);
    NodeFS.writeFileSync(path, "reformatted reference\n");
    integrationGit(checkout, ["add", ".repos"]);
    integrationGit(checkout, ["commit", "-m", "Corrupt vendored reference"]);
    next.save({ ...next.read(), head: integrationGit(checkout, ["rev-parse", "HEAD"]) });
    expect(() => next.assertCandidate()).toThrow(/upstream vendored references/);
  });

  it("preserves unchanged generated upstream sources while checking fork additions", () => {
    const f = fixture();
    const schema = "type Query {\n  field: String  \n}\n";
    const target = f.commit("apps/server/schema/expo.graphql", schema);
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, target },
      NodePath.join(f.root, "workers"),
    );
    next.prepare(f.repo);
    next.request();
    f.repair(next);
    next.assertCandidate();
    expect(
      NodeFS.readFileSync(
        NodePath.join(next.read().checkout, "apps/server/schema/expo.graphql"),
        "utf8",
      ),
    ).toBe(schema);
    next.request("a fork addition still needs checking");
    expect(() => f.repair(next, "invalid fork addition \n")).toThrow(
      /feature.txt.*trailing whitespace/s,
    );
  });

  it("still rejects whitespace errors in repaired application code", () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    f.integration.request();
    expect(() => f.repair(f.integration, "application code with trailing space \n")).toThrow(
      /feature.txt.*trailing whitespace/s,
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
    expect(() => resumed.request()).toThrow(/exhausted 2 attempts/);
    expect(resumed.read().requests).toHaveLength(2);
    const final = await dispatchRepair(resumed, "project", {}, dispatch, "still failed");
    expect((await dispatchRepair(resumed, "project", {}, dispatch, "still failed")).id).toBe(
      final.id,
    );
    expect(commands.filter((c) => c === "thread.turn.start")).toHaveLength(3);
    f.repair(resumed);
    expect(() => resumed.request("failed again")).toThrow(/exhausted 3 attempts/);
    expect(resumed.read().requests).toHaveLength(3);
  });

  it("reserves a quality feedback repair after conflicts in both integration merges", () => {
    const f = fixture();
    f.git(["checkout", "--detach", f.base]);
    const observed = f.commit("feature.txt", "previous integration feature\n");
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, observed },
      NodePath.join(f.root, "workers"),
    );
    expect(next.prepare(f.repo).merging).toBe("source");
    next.request();
    expect(f.repair(next, "fork source integrated\n").merging).toBe("target");
    next.request();
    expect(f.repair(next).status).toBe("prepared");
    expect(next.read().requests).toHaveLength(2);
    expect(next.request("The upstream service needs a test fixture").request.attempt).toBe(3);
    f.repair(next, "tested upstream compatibility\n");
    next.assertCandidate();
    next.markQuality();
    next.markVerified("build/feedback-passed");
    expect(next.read().status).toBe("verified");
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
  it("exports the final tested resolution after feedback changed the original repair", () => {
    const f = fixture();
    f.integration.prepare(f.repo);
    f.integration.request();
    f.repair(f.integration, "initial repair\n");
    f.integration.request("The feature gate rejected that repair");
    f.repair(f.integration, "final tested repair\n");
    expect(NodeFS.existsSync(NodePath.join(f.stateDir, "verified-rerere"))).toBe(false);
    f.integration.markQuality();
    f.integration.markVerified("build/passed");
    f.git(["checkout", "--detach", f.target]);
    const target = f.commit("later.txt", "next upstream\n");
    const next = new Integration(
      f.stateDir,
      { ...f.inputs, target },
      NodePath.join(f.root, "workers"),
    );
    expect(next.prepare(f.repo).status).toBe("prepared");
    expect(NodeFS.readFileSync(NodePath.join(next.read().checkout, "feature.txt"), "utf8")).toBe(
      "final tested repair\n",
    );
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
  it("retains commit identities on the same stable base and rebases a changed base", () => {
    const f = fixture();
    const first = new Integration(f.stateDir, f.inputs, NodePath.join(f.root, "workers"), "stable");
    first.prepare(f.repo);
    first.request();
    const initial = f.repair(first);
    f.git(["fetch", initial.checkout, `${initial.head}:refs/heads/verified-stable`]);
    f.git(["checkout", "--detach", initial.head]);
    const source = f.commit("next-fork-patch.txt", "next fork revision\n");
    const same = new Integration(
      f.stateDir,
      { ...f.inputs, source, observed: initial.head },
      NodePath.join(f.root, "workers"),
      "stable",
    );
    const reused = same.prepare(f.repo);
    expect(reused.status).toBe("prepared");
    expect(reused.head).toBe(source);
    expect(reused.requests).toHaveLength(0);
    same.assertCandidate();

    f.git(["checkout", "--detach", f.target]);
    const target = f.commit("new-upstream.txt", "next official stable base\n");
    const changed = new Integration(
      f.stateDir,
      { source, target, observed: source },
      NodePath.join(f.root, "workers"),
      "stable",
    );
    const rebased = changed.prepare(f.repo);
    expect(rebased.status).toBe("prepared");
    expect(rebased.head).not.toBe(source);
    expect(integrationGit(rebased.checkout, ["merge-base", target, rebased.head])).toBe(target);
    changed.assertCandidate();
  });

  it("continues through independent replay conflicts and reserves quality repairs", () => {
    const f = fixture();
    f.git(["checkout", "--detach", f.source]);
    f.commit("feature.txt", "second fork change\n");
    const source = f.commit("feature.txt", "third fork change\n");
    const stable = new Integration(
      f.stateDir,
      { ...f.inputs, source },
      NodePath.join(f.root, "workers"),
      "stable",
    );
    stable.prepare(f.repo);
    for (let index = 0; index < 3; index++) {
      expect(stable.read().status).toBe("needs-repair");
      const request = stable.request().request;
      const resumed = new Integration(
        f.stateDir,
        { ...f.inputs, source },
        NodePath.join(f.root, "workers"),
        "stable",
      );
      expect(resumed.request().request.id).toBe(request.id);
      f.repair(resumed, `upstream plus fork change ${index}\n`);
    }
    expect(stable.read().status).toBe("prepared");
    for (let index = 0; index < 3; index++) {
      stable.request("a focused compatibility test failed");
      f.repair(stable, `tested upstream plus all fork changes ${index}\n`);
    }
    expect(() => stable.request("still failing")).toThrow(/exhausted 3 attempts.*quality/);
    stable.assertCandidate();
    stable.markQuality();
    stable.markVerified("build/stable-v2");
    expect(stable.read().status).toBe("verified");
  });

  it("bounds the total number of source repairs across distinct stable patches", () => {
    const f = fixture();
    f.git(["checkout", "--detach", f.source]);
    let source = f.source;
    for (let index = 0; index < STABLE_SOURCE_REPAIR_LIMIT; index++)
      source = f.commit("feature.txt", `fork change ${index}\n`);
    const stable = new Integration(
      f.stateDir,
      { ...f.inputs, source },
      NodePath.join(f.root, "workers"),
      "stable",
    );
    stable.prepare(f.repo);
    for (let index = 0; index < STABLE_SOURCE_REPAIR_LIMIT; index++) {
      stable.request();
      f.repair(stable, `upstream and resolved change ${index}\n`);
    }
    expect(stable.read().status).toBe("needs-repair");
    expect(() => stable.request()).toThrow(/exhausted 12 source repairs/);
    expect(stable.read().requests).toHaveLength(STABLE_SOURCE_REPAIR_LIMIT);
  });

  it("replays historical automation using the frozen source without repair attempts", () => {
    const f = fixture();
    f.git(["checkout", "--detach", f.source]);
    f.commit("Jenkinsfile", "old automation\n");
    f.commit("Jenkinsfile", "intermediate automation\n");
    const source = f.commit("Jenkinsfile", "current reviewed automation\n");
    f.git(["checkout", "--detach", f.target]);
    const target = f.commit("Jenkinsfile", "new upstream automation\n");
    const stable = new Integration(
      f.stateDir,
      { ...f.inputs, source, target },
      NodePath.join(f.root, "workers"),
      "stable",
    );
    expect(stable.prepare(f.repo).conflicts).toEqual(["feature.txt"]);
    stable.request();
    const candidate = f.repair(stable);
    stable.assertCandidate();
    expect(candidate.status).toBe("prepared");
    expect(candidate.requests).toHaveLength(1);
    expect(candidate.replay?.index).toBe(4);
    expect(NodeFS.readFileSync(NodePath.join(candidate.checkout, "Jenkinsfile"), "utf8")).toBe(
      "current reviewed automation\n",
    );
  });

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
    const bundle = NodePath.join(f.root, "stable.bundle");
    const ref = "refs/heads/candidate";
    stable.bundle(bundle, ref);
    const worker = NodePath.join(f.root, "worker");
    NodeChildProcess.execFileSync("git", ["init", worker]);
    integrationGit(worker, ["fetch", bundle, `${ref}:refs/heads/candidate`]);
    expect(integrationGit(worker, ["show", `${source}:extra-fork.txt`])).toBe("second fork patch");
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
  it.each([false, true])(
    "keeps one thread across modes, recovery, and new episodes (legacy=%s)",
    async (legacy) => {
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
    issue={'number':len(s['issues'])+1,'state':'OPEN','body':value('--body'),'title':value('--title'),'url':'https://example.test/issues/'+str(len(s['issues'])+1)}
    s['issues'].append(issue); print(issue['url'])
elif a[:2]==['issue','comment']: s['comments'].append({'body':value('--body')})
elif a[:2]==['issue','close']: s['issues'][int(a[2])-1]['state']='CLOSED'
elif a[0]=='api': print(json.dumps([s['comments']]))
else: raise Exception(a)
json.dump(s,open(p,'w'))
`,
        { mode: 0o755 },
      );
      const dispatched: Array<{
        threadId: string;
        incidentKey: string;
        state: string;
        url: string;
        type: string;
        title: string;
      }> = [];
      const createdThreads = new Set<string>();
      const legacyUpdates: Array<{ threadId: string; title: string }> = [];
      const server = NodeHttp.createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          const payload = JSON.parse(body) as (typeof dispatched)[number];
          if (payload.type === "thread.external-alert.upsert") {
            dispatched.push(payload);
            if (legacy) {
              response.statusCode = 400;
              response.end("Unknown command");
              return;
            }
          }
          if (payload.type === "thread.create") {
            if (createdThreads.has(payload.threadId)) {
              response.statusCode = 500;
              response.end("Thread already exists");
              return;
            }
            createdThreads.add(payload.threadId);
          }
          if (payload.type === "thread.meta.update") legacyUpdates.push(payload);
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
                  T3CODE_JENKINS_MODEL_SELECTION: JSON.stringify({
                    instanceId: "test",
                    model: "test",
                  }),
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
            f.target,
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
          [
            "recover",
            "--target-identity",
            `commit:${nextTarget}`,
            "--url",
            "https://build/success",
          ],
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
        await execute(
          [
            "open",
            "--mode",
            "automatic-stable-release",
            "--target-identity",
            "stable:0.0.45",
            "--failure-class",
            "mac-signing",
            "--title",
            "Maintenance failed",
            "--summary",
            "Apple rejected notarization",
            "--url",
            "https://build/apple-failure",
          ],
          "4",
        );
        await execute(
          [
            ...common,
            "--target-identity",
            `commit:${nextTarget}`,
            "--failure-class",
            "validation",
            "--url",
            "https://build/new-episode",
          ],
          "5",
        );
        expect(new Set(dispatched.map((item) => item.threadId)).size).toBe(1);
        expect(new Set(dispatched.map((item) => item.incidentKey)).size).toBe(1);
        await execute(
          [
            "recover",
            "--target-identity",
            `commit:${nextTarget}`,
            "--url",
            "https://build/integration-recovered",
          ],
          "6",
        );
        expect(dispatched.at(-1)?.state).toBe("failing");
        if (legacy) expect(legacyUpdates.at(-1)?.title.startsWith("Recovered:")).toBe(false);
        await execute(
          [
            "open",
            "--mode",
            "out-of-cycle-release",
            "--target-identity",
            `candidate:${f.base}`,
            "--failure-class",
            "mac-signing",
            "--title",
            "Maintenance failed",
            "--summary",
            "Earlier reviewed source failed notarization",
            "--url",
            "https://build/out-of-cycle-failure",
          ],
          "7",
        );
        await execute(
          [
            "recover",
            "--target-identity",
            `candidate:${f.source}`,
            "--released-upstream-version",
            "0.0.45",
            "--released-source-sha",
            f.source,
            "--url",
            "https://build/release-recovered",
          ],
          "8",
        );
        expect(dispatched.at(-1)?.state).toBe("recovered");
        const finished = JSON.parse(NodeFS.readFileSync(ghState, "utf8")) as typeof pending;
        expect(finished.issues.every((issue) => issue.state === "CLOSED")).toBe(true);
        expect(new Set(dispatched.map((item) => item.threadId)).size).toBe(1);
        if (legacy) {
          expect(createdThreads.size).toBe(1);
          expect(new Set(legacyUpdates.map((item) => item.threadId)).size).toBe(1);
          expect(legacyUpdates.at(-1)?.title.startsWith("Recovered:")).toBe(true);
        }
        const count = dispatched.length;
        await execute(["drain"], "9");
        expect(dispatched).toHaveLength(count);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
});
