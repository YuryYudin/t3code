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
});
