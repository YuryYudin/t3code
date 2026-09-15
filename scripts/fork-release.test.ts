// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  allocateForkVersion,
  atomicWriteJson,
  failureCommandId,
  firstForkVersion,
  incidentKey,
  incidentMarker,
  isIncidentRecoverable,
  outboxRecordId,
  publishedReleaseVersions,
  readJsonFile,
  recoveryCommandId,
  requiredReleaseAssets,
  targetIdentity,
  validateBootstrap,
  verifyBootstrapPatch,
  type ForkReleaseBootstrap,
} from "./lib/fork-release.ts";

const fullSha = "0123456789abcdef0123456789abcdef01234567";

describe("fork release versions", () => {
  it("allocates the first numeric fork version from the next upstream patch", () => {
    expect(firstForkVersion("v0.0.40")).toBe("0.0.41-1");
    expect(firstForkVersion("1.8.9")).toBe("1.8.10-1");
  });

  it("increments only matching numeric fork suffixes", () => {
    expect(
      allocateForkVersion({
        upstreamVersion: "0.0.40",
        existingVersions: ["v0.0.41-1", "0.0.41-3", "v0.0.42-8", "v0.0.41-nightly.9"],
      }),
    ).toBe("0.0.41-4");
  });

  it("does not treat draft releases as published version history", () => {
    expect(
      publishedReleaseVersions([
        { tagName: "v0.0.41-1", isDraft: true },
        { tagName: "v0.0.40-2", isDraft: false },
      ]),
    ).toEqual(["v0.0.40-2"]);
  });
});

describe("fork incident identities", () => {
  it("uses domain-qualified targets and stable command ids", () => {
    const identity = targetIdentity("nightly-integration", fullSha);
    const key = incidentKey({
      repository: "YuryYudin/t3code",
      jobFullName: "t3code/main",
      mode: "nightly-integration",
      targetIdentity: identity,
      failureClass: "patch-replay",
    });
    expect(identity).toBe(`commit:${fullSha}`);
    expect(key).toContain(":nightly-integration:commit:");
    expect(incidentMarker(key)).toMatch(/^<!-- t3-fork-incident:[0-9a-f]{64} -->$/);
    expect(outboxRecordId(key, "123")).toHaveLength(64);
    expect(
      failureCommandId({
        issueNumber: 42,
        jobFullName: "t3code/main",
        buildNumber: "123",
        failureClass: "patch-replay",
      }),
    ).toBe("jenkins:issue:42:failure:job:t3code%2Fmain:build:123:class:patch-replay");
    expect(
      recoveryCommandId({
        issueNumber: 42,
        targetIdentity: identity,
        failureClass: "patch-replay",
      }),
    ).toMatch(/^jenkins:issue:42:recovery:target:[0-9a-f]{64}:class:patch-replay$/);
  });

  it("rejects unqualified and abbreviated target identities", () => {
    expect(() => targetIdentity("nightly-integration", "abc123")).toThrow(/full lowercase/);
    expect(targetIdentity("automatic-stable-release", "v2.4.9")).toBe("stable:2.4.9");
  });

  it("recovers only within the incident mode's target domain", () => {
    expect(
      isIncidentRecoverable({
        mode: "nightly-integration",
        failedTargetIdentity: `commit:${fullSha}`,
        successfulTargetIdentity: `commit:${"a".repeat(40)}`,
        isAncestor: (failed, successful) => failed === fullSha && successful === "a".repeat(40),
      }),
    ).toBe(true);
    expect(
      isIncidentRecoverable({
        mode: "automatic-stable-release",
        failedTargetIdentity: "stable:0.0.40",
        successfulTargetIdentity: "stable:0.0.41",
        isAncestor: () => false,
      }),
    ).toBe(true);
    expect(
      isIncidentRecoverable({
        mode: "out-of-cycle-release",
        failedTargetIdentity: `candidate:${fullSha}`,
        successfulTargetIdentity: `candidate:${"a".repeat(40)}`,
        isAncestor: () => true,
      }),
    ).toBe(false);
  });
});

describe("bootstrap manifest", () => {
  it("verifies the checked-in immutable Collections patch", () => {
    const root = NodePath.resolve(import.meta.dirname, "..");
    const document = readJsonFile<ForkReleaseBootstrap>(
      NodePath.join(root, "scripts/fork-release-bootstrap.json"),
    );
    expect(() => verifyBootstrapPatch(root, document)).not.toThrow();
    expect(document.paths).toHaveLength(79);
  });

  it("rejects duplicate path inventories and adapted paths without invariants", () => {
    const valid = readJsonFile<ForkReleaseBootstrap>(
      NodePath.resolve(import.meta.dirname, "fork-release-bootstrap.json"),
    );
    expect(() => validateBootstrap({ ...valid, paths: [...valid.paths, valid.paths[0]!] })).toThrow(
      /79 bootstrap paths/,
    );
    const paths = valid.paths.map((entry, index) =>
      index === 0 ? { ...entry, invariant: undefined } : entry,
    );
    expect(() => validateBootstrap({ ...valid, paths } as ForkReleaseBootstrap)).toThrow(
      /has no invariant/,
    );
    expect(() =>
      validateBootstrap({
        ...valid,
        infrastructureReplayResolutions: [
          ...valid.infrastructureReplayResolutions,
          valid.infrastructureReplayResolutions[0]!,
        ],
      }),
    ).toThrow(/duplicate paths/);
  });
});

describe("release asset gate", () => {
  const assets = [
    "T3-Code-0.0.41-1-arm64.dmg",
    "T3-Code-0.0.41-1-arm64.zip",
    "T3-Code-0.0.41-1-x64.dmg",
    "T3-Code-0.0.41-1-x64.zip",
    "T3-Code-0.0.41-1-x86_64.AppImage",
    "T3-Code-Setup-0.0.41-1-x64.exe",
    "latest-mac.yml",
    "latest-linux.yml",
    "latest.yml",
    "SHA256SUMS.txt",
  ];

  it("requires the complete four-target matrix and merged manifests", () => {
    expect(() => requiredReleaseAssets(assets, "0.0.41-1")).not.toThrow();
    expect(() =>
      requiredReleaseAssets(
        assets.filter((name) => !name.endsWith(".AppImage")),
        "0.0.41-1",
      ),
    ).toThrow(/Linux x64/);
    expect(() => requiredReleaseAssets([...assets, "latest-mac-x64.yml"], "0.0.41-1")).toThrow(
      /must be merged/,
    );
  });
});

describe("Jenkins release pipeline", () => {
  it("hands the current Linux CLI archive to the Windows WSL runtime build", () => {
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "..", "Jenkinsfile"),
      "utf8",
    );

    expect(pipeline).toContain("node scripts/build-cli-archive.ts --platform linux --arch x64");
    expect(pipeline).toContain(
      "--wsl-runtime artifacts\\\\wsl-runtime\\\\t3-${version}-linux-x64.tar.gz",
    );
    expect(pipeline).not.toContain("--wsl-prebuild");
  });
});

describe("durable state", () => {
  it("atomically replaces JSON records", () => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "fork-release-state-test-"),
    );
    try {
      const filePath = NodePath.join(directory, "record.json");
      atomicWriteJson(filePath, { state: "first" });
      atomicWriteJson(filePath, { state: "second" });
      expect(readJsonFile(filePath)).toEqual({ state: "second" });
      expect(NodeFS.readdirSync(directory)).toEqual(["record.json"]);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
