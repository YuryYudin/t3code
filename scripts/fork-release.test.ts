// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  allocateForkVersion,
  atomicWriteJson,
  failureCommandId,
  finalizeReleaseAssets,
  firstForkVersion,
  incidentKey,
  workflowIncidentKey,
  incidentMarker,
  isIncidentRecoverable,
  outboxRecordId,
  parseUpstreamStableRelease,
  publishedReleaseVersions,
  readJsonFile,
  recoveryCommandId,
  requiredReleaseAssets,
  targetIdentity,
  validateBootstrap,
  verifyBootstrapPatch,
  type ForkReleaseBootstrap,
} from "./lib/fork-release.ts";
import { parseUpdateManifest, serializeUpdateManifest } from "./lib/update-manifest.ts";

const fullSha = "0123456789abcdef0123456789abcdef01234567";

describe("fork release versions", () => {
  it("keeps the exact upstream stable version before the fork revision", () => {
    expect(firstForkVersion("v0.0.44")).toBe("0.0.44-1");
    expect(firstForkVersion("1.8.9")).toBe("1.8.9-1");
  });

  it("increments only matching numeric fork suffixes", () => {
    expect(
      allocateForkVersion({
        upstreamVersion: "0.0.40",
        existingVersions: ["v0.0.40-1", "0.0.40-3", "v0.0.41-8", "v0.0.40-nightly.9"],
      }),
    ).toBe("0.0.40-4");
  });

  it("does not treat draft or archived prereleases as stable release history", () => {
    expect(
      publishedReleaseVersions([
        { tagName: "v0.0.41-1", isDraft: true, isPrerelease: false },
        { tagName: "v0.0.45-3", isDraft: false, isPrerelease: true },
        { tagName: "v0.0.40-2", isDraft: false, isPrerelease: false },
      ]),
    ).toEqual(["v0.0.40-2"]);
  });

  it("reserves archived and draft tags without treating upstream 0.0.45 as released", () => {
    const releases = [
      { tagName: "v0.0.45-1", isDraft: false, isPrerelease: true },
      { tagName: "v0.0.45-2", isDraft: false, isPrerelease: true },
      { tagName: "v0.0.45-3", isDraft: false, isPrerelease: true },
      { tagName: "v0.0.45-4", isDraft: true, isPrerelease: false },
      { tagName: "v0.0.43-1", isDraft: false, isPrerelease: false },
    ];
    expect(
      allocateForkVersion({
        upstreamVersion: "0.0.45",
        existingVersions: releases.map(({ tagName }) => tagName),
      }),
    ).toBe("0.0.45-5");
    expect(publishedReleaseVersions(releases)).toEqual(["v0.0.43-1"]);
    expect(
      allocateForkVersion({
        upstreamVersion: "0.0.44",
        existingVersions: releases.map(({ tagName }) => tagName),
      }),
    ).toBe("0.0.44-1");
  });
});

describe("upstream stable releases", () => {
  it("accepts an official published stable release", () => {
    expect(
      parseUpstreamStableRelease({ tag_name: "v0.0.44", draft: false, prerelease: false }),
    ).toEqual({ tag: "v0.0.44", version: "0.0.44" });
  });

  it("rejects draft and prerelease releases even when their tags look stable", () => {
    expect(() =>
      parseUpstreamStableRelease({ tag_name: "v0.0.45", draft: true, prerelease: false }),
    ).toThrow(/official published/);
    expect(() =>
      parseUpstreamStableRelease({ tag_name: "v0.0.45", draft: false, prerelease: true }),
    ).toThrow(/official published/);
  });

  it("rejects nightly and preview version tags even when marked as full releases", () => {
    for (const tag of ["v0.0.45-nightly.20261001.1", "v0.0.45-preview.20261001.1"]) {
      expect(() =>
        parseUpstreamStableRelease({ tag_name: tag, draft: false, prerelease: false }),
      ).toThrow(/stable semantic version/);
    }
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

  it("keeps the same workflow incident across targets and separates integration from stable releases", () => {
    expect(workflowIncidentKey("YuryYudin/t3code", "nightly-integration")).toBe(
      "jenkins:YuryYudin/t3code:nightly-integration:workflow",
    );
    expect(workflowIncidentKey("YuryYudin/t3code", "nightly-integration")).not.toBe(
      workflowIncidentKey("YuryYudin/t3code", "automatic-stable-release"),
    );
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
    "T3-Code-Fork-0.0.41-1-android-arm64.apk",
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

  it("requires the Android arm64 APK", () => {
    expect(() =>
      requiredReleaseAssets(
        assets.filter((name) => !name.endsWith(".apk")),
        "0.0.41-1",
      ),
    ).toThrow(/Android arm64/);
  });

  function releaseFixture() {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fork-release-assets-"));
    for (const name of assets) NodeFS.writeFileSync(NodePath.join(directory, name), "artifact");
    for (const [name, files] of [
      ["latest-mac.yml", assets.slice(0, 4)],
      ["latest-linux.yml", assets.slice(4, 5)],
      ["latest.yml", assets.slice(5, 6)],
    ] as const) {
      NodeFS.writeFileSync(
        NodePath.join(directory, name),
        serializeUpdateManifest(
          {
            version: "0.0.41-1",
            releaseDate: "2026-10-01T00:00:00Z",
            files: files.map((url) => ({ url, size: 8, sha512: "old-hash" })),
            extras: { path: files[0]!, sha512: "old-hash" },
          },
          { platformLabel: name },
        ),
      );
    }
    return directory;
  }

  it("publishes manifest sizes and hashes from the final stapled artifacts", () => {
    const directory = releaseFixture();
    try {
      const dmg = assets[0]!;
      const bytes = "artifact with stapled notarization ticket";
      NodeFS.writeFileSync(NodePath.join(directory, dmg), bytes);
      const evidence = finalizeReleaseAssets(directory, "0.0.41-1");
      const manifest = parseUpdateManifest(
        NodeFS.readFileSync(NodePath.join(directory, "latest-mac.yml"), "utf8"),
        "latest-mac.yml",
        "macOS",
        { preserveLegacyFields: true },
      );
      const sha512 = NodeCrypto.createHash("sha512").update(bytes).digest("base64");
      expect(manifest.files.find(({ url }) => url === dmg)).toEqual({
        url: dmg,
        size: bytes.length,
        sha512,
      });
      expect(manifest.extras.sha512).toBe(sha512);
      expect(manifest.files).toHaveLength(4);
      const checksums = NodeFS.readFileSync(NodePath.join(directory, "SHA256SUMS.txt"), "utf8");
      expect(checksums).toContain(`${evidence.sha256[dmg]}  ${dmg}\n`);
      expect(checksums).toContain(`${evidence.sha256["latest-mac.yml"]}  latest-mac.yml\n`);
      expect(checksums).not.toContain("SHA256SUMS.txt");
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves AppImage block-map metadata while finalizing updater hashes", () => {
    const directory = releaseFixture();
    const manifestPath = NodePath.join(directory, "latest-linux.yml");
    try {
      const original = NodeFS.readFileSync(manifestPath, "utf8");
      NodeFS.writeFileSync(
        manifestPath,
        original.replace("    size: 8", "    size: 8\n    blockMapSize: 164951"),
      );
      const appImage = assets[4]!;
      const bytes = "AppImage with embedded block map";
      NodeFS.writeFileSync(NodePath.join(directory, appImage), bytes);
      finalizeReleaseAssets(directory, "0.0.41-1");
      const manifest = parseUpdateManifest(
        NodeFS.readFileSync(manifestPath, "utf8"),
        manifestPath,
        "Linux",
        { preserveLegacyFields: true },
      );
      const sha512 = NodeCrypto.createHash("sha512").update(bytes).digest("base64");
      expect(manifest.files).toEqual([
        { url: appImage, size: bytes.length, sha512, blockMapSize: 164951 },
      ]);
      expect(manifest.extras.sha512).toBe(sha512);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects inconsistent manifest versions and incomplete macOS architecture coverage", () => {
    const directory = releaseFixture();
    const path = NodePath.join(directory, "latest-mac.yml");
    try {
      const original = NodeFS.readFileSync(path, "utf8");
      NodeFS.writeFileSync(path, original.replace("0.0.41-1", "0.0.99-1"));
      expect(() => finalizeReleaseAssets(directory, "0.0.41-1")).toThrow(/has version/);
      const manifest = parseUpdateManifest(original, path, "macOS");
      NodeFS.writeFileSync(
        path,
        serializeUpdateManifest(
          { ...manifest, files: manifest.files.slice(0, 2) },
          { platformLabel: "macOS" },
        ),
      );
      expect(() => finalizeReleaseAssets(directory, "0.0.41-1")).toThrow(/missing artifact.*x64/);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Jenkins release pipeline", () => {
  it("hands the current Linux CLI archive to the Windows WSL runtime build", () => {
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "..", "Jenkinsfile"),
      "utf8",
    );

    expect(pipeline).toContain(
      "corepack pnpm exec node scripts/build-cli-archive.ts --platform linux --arch x64",
    );
    expect(pipeline).toContain("VP_SELF_SETUP_NO_MODIFY_PATH=1");
    expect(pipeline).toContain("VP_NODE_VERSION=26.8.2");
    expect(pipeline).toContain("node scripts/update-release-package-versions.ts ${version}");
    expect(pipeline).toContain("env exec node apps/server/scripts/cli.ts build-exe --verbose");
    expect(pipeline).toContain(
      "--wsl-runtime artifacts\\\\wsl-runtime\\\\t3-${version}-linux-x64.tar.gz",
    );
    expect(pipeline).not.toContain("--wsl-prebuild");
  });

  it("builds the fork Android APK alongside the desktop matrix", () => {
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "..", "Jenkinsfile"),
      "utf8",
    );

    expect(pipeline).toContain("android: { buildAndroid(slug, candidateRef, version) }");
    expect(pipeline).toContain("credentialsId: 't3code-android-keystore'");
    expect(pipeline).toContain("credentialsId: 't3code-android-keystore-password'");
    expect(pipeline).toContain('stash name: "artifacts-android-${slug}"');
    expect(pipeline).toContain('unstash "artifacts-android-${slug}"');
  });
});

describe("Jenkins release pipeline", () => {
  it("hands the current Linux CLI archive to the Windows WSL runtime build", () => {
    const pipeline = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "..", "Jenkinsfile"),
      "utf8",
    );

    expect(pipeline).toContain(
      "corepack pnpm exec node scripts/build-cli-archive.ts --platform linux --arch x64",
    );
    expect(pipeline).toContain("VP_SELF_SETUP_NO_MODIFY_PATH=1");
    expect(pipeline).toContain("VP_NODE_VERSION=26.8.2");
    expect(pipeline).toContain("node scripts/update-release-package-versions.ts ${version}");
    expect(pipeline).toContain("env exec node apps/server/scripts/cli.ts build-exe --verbose");
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
