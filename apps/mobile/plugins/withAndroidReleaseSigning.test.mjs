import { describe, expect, it } from "vitest";
import withAndroidReleaseSigning from "./withAndroidReleaseSigning.cjs";

// Trimmed from the real Expo bare Android template's android/app/build.gradle
// (captured via `expo prebuild --platform android`), keeping only the
// sections the plugin reads or edits.
const TEMPLATE = `apply plugin: "com.android.application"
apply plugin: "org.jetbrains.kotlin.android"
apply plugin: "com.facebook.react"

android {
    namespace 'com.t3tools.t3code'
    defaultConfig {
        applicationId 'com.t3tools.t3code'
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

async function transform(contents) {
  const config = withAndroidReleaseSigning({ name: "Test", slug: "test" });
  const result = await config.mods.android.appBuildGradle({
    ...config,
    modRequest: { platform: "android", modName: "appBuildGradle", introspect: false },
    modResults: { language: "groovy", contents },
  });
  return result.modResults.contents;
}

describe("Android release signing plugin", () => {
  it("points the release build type at a release signing config, not debug", async () => {
    const result = await transform(TEMPLATE);
    const releaseBuildType = result.slice(
      result.indexOf("release {", result.indexOf("buildTypes")),
    );
    expect(releaseBuildType).toContain("signingConfig signingConfigs.release");
    expect(releaseBuildType).not.toContain("signingConfig signingConfigs.debug");
  });

  it("leaves the debug build type signed with the debug config", async () => {
    const result = await transform(TEMPLATE);
    const buildTypes = result.slice(result.indexOf("buildTypes"));
    const debugBuildType = buildTypes.slice(0, buildTypes.indexOf("release {"));
    expect(debugBuildType).toContain("signingConfig signingConfigs.debug");
  });

  it("adds a release signingConfig that reads from env vars, with no secrets or paths baked in", async () => {
    const result = await transform(TEMPLATE);
    expect(result).toContain('System.getenv("T3CODE_ANDROID_KEYSTORE_FILE")');
    expect(result).toContain('System.getenv("T3CODE_ANDROID_KEYSTORE_PASSWORD")');
    expect(result).toContain('System.getenv("T3CODE_ANDROID_KEY_ALIAS")');
    expect(result).toContain('System.getenv("T3CODE_ANDROID_KEY_PASSWORD")');
    const releaseSigningConfig = result.slice(
      result.indexOf("release {", result.indexOf("signingConfigs")),
      result.indexOf("buildTypes"),
    );
    expect(releaseSigningConfig).not.toMatch(/storePassword\s+['"]/);
    expect(releaseSigningConfig).not.toContain("/Users/");
  });

  it("fails the build before a release task runs when env vars are missing", async () => {
    const result = await transform(TEMPLATE);
    expect(result).toContain("gradle.taskGraph.whenReady");
    expect(result).toContain("GradleException");
    expect(result).toContain("T3CODE_ANDROID_KEYSTORE_FILE");
  });

  it("does not duplicate the signing blocks on a second prebuild", async () => {
    const once = await transform(TEMPLATE);
    const twice = await transform(once);
    expect(twice).toBe(once);
    expect(once.match(/gradle\.taskGraph\.whenReady/g)).toHaveLength(1);
    expect(once.match(/release \{/g)).toHaveLength(2); // signingConfigs.release + buildTypes.release
  });

  it("fails visibly when the Expo template's signingConfigs anchor changes", async () => {
    await expect(transform("android {\n}\n")).rejects.toThrow("signingConfigs.debug");
  });

  it("fails visibly when the Expo template's release buildType anchor changes", async () => {
    const withoutReleaseBuildType = TEMPLATE.replace(
      `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }`,
      "",
    );
    await expect(transform(withoutReleaseBuildType)).rejects.toThrow("release buildType");
  });
});
