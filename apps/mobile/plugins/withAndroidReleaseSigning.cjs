const { withAppBuildGradle } = require("expo/config-plugins");

// Signs fork release builds with a keystore read from env vars at Gradle
// execution time, so no path or password lands in generated files. A release
// task fails when any var is missing rather than falling back to the public
// debug key; debug builds keep working without them.

const MARKER = "T3CODE_ANDROID_KEYSTORE_FILE";

const ENV_VARS = [
  "T3CODE_ANDROID_KEYSTORE_FILE",
  "T3CODE_ANDROID_KEYSTORE_PASSWORD",
  "T3CODE_ANDROID_KEY_ALIAS",
  "T3CODE_ANDROID_KEY_PASSWORD",
];

const RELEASE_ENV_GUARD = `
// T3 Code fork: see apps/mobile/plugins/withAndroidReleaseSigning.cjs.
def t3codeReleaseEnvVars = [${ENV_VARS.map((name) => `"${name}"`).join(", ")}]
gradle.taskGraph.whenReady { taskGraph ->
    def runningReleaseTask = taskGraph.allTasks.any { it.name.toLowerCase().contains("release") }
    if (runningReleaseTask) {
        def missing = t3codeReleaseEnvVars.findAll { System.getenv(it) == null || System.getenv(it).isEmpty() }
        if (!missing.isEmpty()) {
            throw new GradleException(
                "Fork release signing is missing required env var(s): " + missing.join(", ") +
                ". Set them before running a release build (see docs/operations/fork-releases.md)."
            )
        }
    }
}
`;

const SIGNING_CONFIGS_DEBUG_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const RELEASE_SIGNING_CONFIG = `        release {
            def keystoreFile = System.getenv("T3CODE_ANDROID_KEYSTORE_FILE")
            if (keystoreFile) {
                storeFile file(keystoreFile)
            }
            storePassword System.getenv("T3CODE_ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("T3CODE_ANDROID_KEY_ALIAS")
            keyPassword System.getenv("T3CODE_ANDROID_KEY_PASSWORD")
        }
    }`;

const RELEASE_BUILD_TYPE_DEBUG_SIGNING = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const RELEASE_BUILD_TYPE_RELEASE_SIGNING = `        release {
            signingConfig signingConfigs.release`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    const contents = nextConfig.modResults.contents;

    if (contents.includes(MARKER)) {
      // Already applied (e.g. a second prebuild without --clean): no-op.
      return nextConfig;
    }

    if (!contents.includes(SIGNING_CONFIGS_DEBUG_BLOCK)) {
      throw new Error(
        "withAndroidReleaseSigning: could not find the expected signingConfigs.debug block in " +
          "android/app/build.gradle. The Expo Android template must have changed; update the " +
          "anchor text in withAndroidReleaseSigning.cjs.",
      );
    }

    if (!contents.includes(RELEASE_BUILD_TYPE_DEBUG_SIGNING)) {
      throw new Error(
        "withAndroidReleaseSigning: could not find the expected release buildType signingConfig " +
          "in android/app/build.gradle. The Expo Android template must have changed; update the " +
          "anchor text in withAndroidReleaseSigning.cjs.",
      );
    }

    let nextContents = contents.replace(
      SIGNING_CONFIGS_DEBUG_BLOCK,
      `${SIGNING_CONFIGS_DEBUG_BLOCK.slice(0, -"    }".length)}\n${RELEASE_SIGNING_CONFIG}`,
    );
    nextContents = nextContents.replace(
      RELEASE_BUILD_TYPE_DEBUG_SIGNING,
      RELEASE_BUILD_TYPE_RELEASE_SIGNING,
    );
    nextContents = `${RELEASE_ENV_GUARD}\n${nextContents}`;

    nextConfig.modResults.contents = nextContents;
    return nextConfig;
  });
};
