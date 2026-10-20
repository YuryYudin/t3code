import { describe, expect, it } from "vitest";
import withAndroidPinnedFbjni from "./withAndroidPinnedFbjni.cjs";

// Trimmed from the real Expo bare Android template's root android/build.gradle.
const TEMPLATE = `// Top-level build file where you can add configuration options common to all sub-projects/modules.

buildscript {
  repositories {
    google()
    mavenCentral()
  }
}

allprojects {
  repositories {
    google()
    mavenCentral()
  }
}

apply plugin: "expo-root-project"
apply plugin: "com.facebook.react.rootproject"
`;

const TOML_WITH_FBJNI = `
[versions]
fbjni = "0.7.0"
soloader = "0.12.1"

[libraries]
fbjni = { module = "com.facebook.fbjni:fbjni", version.ref = "fbjni" }
`;

const TOML_WITHOUT_FBJNI = `
[versions]
soloader = "0.12.1"
`;

async function transform(contents, props) {
  const config = withAndroidPinnedFbjni({ name: "Test", slug: "test" }, props);
  const result = await config.mods.android.projectBuildGradle({
    ...config,
    modRequest: { platform: "android", modName: "projectBuildGradle", introspect: false },
    modResults: { language: "groovy", contents },
  });
  return result.modResults.contents;
}

describe("Android pinned fbjni plugin", () => {
  it("forces fbjni to the version read from react-native's version catalog", async () => {
    const result = await transform(TEMPLATE, { tomlContents: TOML_WITH_FBJNI });
    expect(result).toContain('resolutionStrategy.force "com.facebook.fbjni:fbjni:0.7.0"');
    expect(result).toContain("allprojects");
    expect(result).toContain("configurations.all");
  });

  it("does not duplicate the force block on a second prebuild", async () => {
    const once = await transform(TEMPLATE, { tomlContents: TOML_WITH_FBJNI });
    const twice = await transform(once, { tomlContents: TOML_WITH_FBJNI });
    expect(twice).toBe(once);
    expect(once.match(/resolutionStrategy\.force/g)).toHaveLength(1);
  });

  it("throws a clear error when the version catalog has no fbjni entry", async () => {
    await expect(transform(TEMPLATE, { tomlContents: TOML_WITHOUT_FBJNI })).rejects.toThrow(
      /fbjni/,
    );
  });

  it("reads the toml from a given path when contents are not injected directly", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const tmpToml = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "fbjni-")),
      "libs.versions.toml",
    );
    fs.writeFileSync(tmpToml, TOML_WITH_FBJNI);

    const result = await transform(TEMPLATE, { tomlPath: tmpToml });
    expect(result).toContain('resolutionStrategy.force "com.facebook.fbjni:fbjni:0.7.0"');
  });
});

describe("resolveFbjniVersionFromToml", () => {
  it("extracts the pinned version", () => {
    expect(withAndroidPinnedFbjni.resolveFbjniVersionFromToml(TOML_WITH_FBJNI)).toBe("0.7.0");
  });

  it("throws when the catalog has no fbjni entry", () => {
    expect(() => withAndroidPinnedFbjni.resolveFbjniVersionFromToml(TOML_WITHOUT_FBJNI)).toThrow(
      /fbjni/,
    );
  });
});
