import { describe, expect, it } from "@effect/vitest";
import { resolveForkDistribution } from "./forkDistribution.ts";

describe("resolveForkDistribution", () => {
  it("returns null when unset, leaving upstream behavior unchanged", () => {
    expect(resolveForkDistribution(undefined, "production")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveForkDistribution("", "production")).toBeNull();
  });

  it("returns fork overrides with the tapnetix identifier, and scheme", () => {
    const overrides = resolveForkDistribution("fork", "production");
    expect(overrides).toMatchObject({
      appName: "T3 Code Fork",
      scheme: "t3code-fork",
      androidPackage: "com.tapnetix.t3code",
      iosBundleIdentifier: "com.tapnetix.t3code",
    });
    expect(overrides?.signingPlugin).toBeTruthy();
  });

  it("throws on an unrecognized distribution value", () => {
    expect(() => resolveForkDistribution("nightly", "production")).toThrow(
      /T3CODE_MOBILE_DISTRIBUTION/,
    );
  });

  it("throws when fork distribution is requested for a non-production variant", () => {
    expect(() => resolveForkDistribution("fork", "development")).toThrow(/production/);
    expect(() => resolveForkDistribution("fork", "preview")).toThrow(/production/);
  });

  it("omits androidVersionName/versionCode when T3CODE_MOBILE_FORK_VERSION is unset", () => {
    const overrides = resolveForkDistribution("fork", "production");
    expect(overrides?.androidVersionName).toBeUndefined();
    expect(overrides?.androidVersionCode).toBeUndefined();
  });

  it("maps a stable fork version to a monotonic versionCode", () => {
    const overrides = resolveForkDistribution("fork", "production", "0.0.45-2");
    expect(overrides?.androidVersionName).toBe("0.0.45-2");
    expect(overrides?.androidVersionCode).toBe(4502);
  });

  it("keeps versionCode monotonic across a patch bump", () => {
    const earlier = resolveForkDistribution("fork", "production", "0.0.45-9")?.androidVersionCode;
    const later = resolveForkDistribution("fork", "production", "0.0.46-1")?.androidVersionCode;
    expect(earlier).toBeDefined();
    expect(later).toBeDefined();
    expect(later!).toBeGreaterThan(earlier!);
  });

  it("keeps versionCode monotonic across a minor bump", () => {
    const earlier = resolveForkDistribution("fork", "production", "0.9.999-99")?.androidVersionCode;
    const later = resolveForkDistribution("fork", "production", "1.0.0-1")?.androidVersionCode;
    expect(earlier).toBeDefined();
    expect(later).toBeDefined();
    expect(later!).toBeGreaterThan(earlier!);
  });

  it("maps an integration/nightly version to versionCode 1", () => {
    const overrides = resolveForkDistribution("fork", "production", "0.0.0-nightly.123");
    expect(overrides?.androidVersionName).toBe("0.0.0-nightly.123");
    expect(overrides?.androidVersionCode).toBe(1);
  });

  it("throws when the fork revision exceeds 99", () => {
    expect(() => resolveForkDistribution("fork", "production", "0.0.45-100")).toThrow(/revision/);
  });

  it("throws when minor or patch exceeds 999", () => {
    expect(() => resolveForkDistribution("fork", "production", "0.1000.0-1")).toThrow(/minor/);
    expect(() => resolveForkDistribution("fork", "production", "0.0.1000-1")).toThrow(/patch/);
  });

  it("throws when the resulting versionCode exceeds Android's limit", () => {
    expect(() => resolveForkDistribution("fork", "production", "999.999.999-99")).toThrow(
      /exceeds Android's limit/,
    );
  });

  it("throws on an unrecognized fork version shape", () => {
    expect(() => resolveForkDistribution("fork", "production", "not-a-version")).toThrow(
      /T3CODE_MOBILE_FORK_VERSION/,
    );
  });

  it("throws when T3CODE_MOBILE_FORK_VERSION is set without the fork distribution", () => {
    expect(() => resolveForkDistribution(undefined, "production", "0.0.45-2")).toThrow(
      /T3CODE_MOBILE_DISTRIBUTION=fork/,
    );
  });
});
