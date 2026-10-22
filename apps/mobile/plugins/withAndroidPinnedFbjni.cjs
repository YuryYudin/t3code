const fs = require("node:fs");
const path = require("node:path");
const { withProjectBuildGradle } = require("expo/config-plugins");

// react-native-shiki-engine declares com.facebook.fbjni:fbjni:+, a dynamic
// version that now resolves to fbjni 0.8.1 (built against a newer libc++ ABI
// than the libc++_shared.so the NDK React Native builds with packages),
// crashing every release APK at launch. Force the whole build to React
// Native's own pinned fbjni version instead.

const MARKER = "T3CODE_PINNED_FBJNI";
const FBJNI_VERSION_PATTERN = /^\s*fbjni\s*=\s*"([^"]+)"/m;

function resolveFbjniVersionFromToml(tomlContents) {
  const match = FBJNI_VERSION_PATTERN.exec(tomlContents);
  if (!match) {
    throw new Error(
      'withAndroidPinnedFbjni: could not find an `fbjni = "..."` entry in react-native\'s ' +
        "gradle/libs.versions.toml. react-native's version catalog must have changed; update " +
        "withAndroidPinnedFbjni.cjs.",
    );
  }
  return match[1];
}

function defaultTomlPath() {
  const reactNativePackageJson = require.resolve("react-native/package.json");
  return path.join(path.dirname(reactNativePackageJson), "gradle", "libs.versions.toml");
}

module.exports = function withAndroidPinnedFbjni(config, props = {}) {
  return withProjectBuildGradle(config, (nextConfig) => {
    const contents = nextConfig.modResults.contents;

    if (contents.includes(MARKER)) {
      // Already applied (e.g. a second prebuild without --clean): no-op.
      return nextConfig;
    }

    const tomlContents =
      props.tomlContents ?? fs.readFileSync(props.tomlPath ?? defaultTomlPath(), "utf8");
    const fbjniVersion = resolveFbjniVersionFromToml(tomlContents);

    nextConfig.modResults.contents = `${contents}

// ${MARKER}: see apps/mobile/plugins/withAndroidPinnedFbjni.cjs.
allprojects {
  configurations.all {
    resolutionStrategy.force "com.facebook.fbjni:fbjni:${fbjniVersion}"
  }
}
`;

    return nextConfig;
  });
};

module.exports.resolveFbjniVersionFromToml = resolveFbjniVersionFromToml;
