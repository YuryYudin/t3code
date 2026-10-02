#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalFetch:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  Integration,
  dispatchRepair,
  verifiedIntegrationCurrent,
  workflowLock,
  shareCheckout,
} from "./lib/fork-integration.ts";
import { assertAbsoluteStateDirectory } from "./lib/fork-release.ts";

const [command, ...argv] = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < argv.length; i += 2) flags.set(argv[i]!.replace(/^--/, ""), argv[i + 1]!);
function flag(name: string, fallback?: string): string {
  const value = flags.get(name) ?? fallback;
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}
function output(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
async function main() {
  if (command === "share") {
    const checkout = flag("checkout");
    if (NodeFS.realpathSync(checkout) !== NodeFS.realpathSync(process.cwd()))
      throw new Error("Sharing is limited to the current repair checkout.");
    shareCheckout(checkout, Number(flag("uid")));
    return output({ status: "shared" });
  }
  const stateDir = assertAbsoluteStateDirectory(
    flag("state-dir", process.env.FORK_RELEASE_STATE_DIR),
  );
  if (command === "lock") {
    const operation = flag("operation");
    if (operation !== "acquire" && operation !== "release")
      throw new Error("Invalid lock operation.");
    return output(workflowLock(stateDir, operation, flag("owner")));
  }
  const inputs = { source: flag("source"), target: flag("target"), observed: flag("observed") };
  const kind = flags.get("kind") ?? "integration";
  if (kind !== "integration" && kind !== "stable") throw new Error("Invalid candidate kind.");
  const integration = new Integration(stateDir, inputs, undefined, kind);
  switch (command) {
    case "inspect": {
      const state = integration.read();
      return output({
        kind: state.kind,
        inputs: state.inputs,
        status: state.status,
        conflicts: state.conflicts,
        attempts: state.requests.length,
      });
    }
    case "current":
      return output({ current: verifiedIntegrationCurrent(stateDir, process.cwd(), inputs) });
    case "prepare": {
      const projectRoot = flag("project-root", process.env.FORK_REPAIR_PROJECT_ROOT);
      return output(integration.prepare(process.cwd(), NodeFS.statSync(projectRoot).uid));
    }
    case "request": {
      const base = flag("base-url", process.env.T3CODE_JENKINS_BASE_URL).replace(/\/$/, "");
      const token = flag("token", process.env.T3CODE_JENKINS_TOKEN);
      const projectId = flag("project-id", process.env.T3CODE_JENKINS_PROJECT_ID);
      const modelSelection: unknown = JSON.parse(
        flag("model-selection", process.env.T3CODE_JENKINS_MODEL_SELECTION),
      );
      const feedbackPath = flags.get("feedback");
      const feedback = feedbackPath ? NodeFS.readFileSync(feedbackPath, "utf8") : "";
      const request = await dispatchRepair(
        integration,
        projectId,
        modelSelection,
        async (payload) => {
          const response = await fetch(`${base}/api/orchestration/dispatch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(60000),
          });
          if (!response.ok)
            throw new Error(`T3 repair dispatch rejected with HTTP ${response.status}.`);
          const receipt = (await response.json()) as { sequence: number };
          return receipt.sequence;
        },
        feedback,
      );
      return output({ requestId: request.id, attempt: request.attempt });
    }
    case "finish":
      return output(integration.finish() ?? { status: "waiting" });
    case "bundle":
      return output(integration.bundle(NodePath.resolve(flag("output")), flag("ref")));
    case "quality":
      integration.markQuality();
      return output(integration.read());
    case "verified":
      integration.markVerified(flag("build", process.env.BUILD_URL));
      return output(integration.read());
    default:
      throw new Error(
        "Usage: fork-integration <current|prepare|request|finish|bundle|quality|verified|lock> [flags]",
      );
  }
}
await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
