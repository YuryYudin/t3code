// Kept out of app.config.ts so upstream replays only gain call sites. A fork binary must never
// take an upstream OTA: its JS is native-compatible with upstream fingerprints, so an update would
// silently replace it. app.config.ts therefore disables expo-updates for fork builds.

export type ForkAppVariant = "development" | "preview" | "production";

export const FORK_IDENTIFIER = "com.tapnetix.t3code";
export const FORK_RELEASE_SIGNING_PLUGIN = "./plugins/withAndroidReleaseSigning.cjs";
// expo-observe's native module throws at startup without an EAS project ID. Fork builds have no
// EAS project; with no relay, crash reports stay off and nothing is sent under this ID.
const FORK_EAS_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

// Matches scripts/lib/fork-release.ts' FORK_VERSION: a stable fork version is
// the upstream MAJOR.MINOR.PATCH plus a 1-based fork revision suffix.
const STABLE_FORK_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-([1-9]\d*)$/;
// The pipeline's integration/validation builds use 0.0.0-nightly.<BUILD_NUMBER>.
// These are never published, so they don't need a distinct versionCode.
const NIGHTLY_FORK_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.(.+)$/;

const MAX_MINOR_OR_PATCH = 999;
const MAX_REVISION = 99;
// Android rejects a versionCode above this value.
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

export interface ForkDistributionOverrides {
  readonly appName: string;
  readonly scheme: string;
  readonly androidPackage: string;
  readonly iosBundleIdentifier: string;
  readonly signingPlugin: string;
  readonly easProjectId: string;
  readonly androidVersionName?: string;
  readonly androidVersionCode?: number;
}

// Stable `MAJOR.MINOR.PATCH-N` maps to ((MAJOR*1000 + MINOR)*1000 + PATCH)*100 + N, so versionCode
// rises across upstream bumps and fork revisions alike. Nightlies get 1: they are never installed
// over each other.
function resolveAndroidVersion(forkVersion: string): { versionName: string; versionCode: number } {
  const nightlyMatch = NIGHTLY_FORK_VERSION.exec(forkVersion);
  if (nightlyMatch) {
    return { versionName: forkVersion, versionCode: 1 };
  }

  const stableMatch = STABLE_FORK_VERSION.exec(forkVersion);
  if (!stableMatch) {
    throw new Error(
      `T3CODE_MOBILE_FORK_VERSION must be a stable fork version (MAJOR.MINOR.PATCH-N) or an integration version (MAJOR.MINOR.PATCH-nightly.<build>), got "${forkVersion}".`,
    );
  }

  const major = Number(stableMatch[1]);
  const minor = Number(stableMatch[2]);
  const patch = Number(stableMatch[3]);
  const revision = Number(stableMatch[4]);

  if (minor > MAX_MINOR_OR_PATCH) {
    throw new Error(
      `T3CODE_MOBILE_FORK_VERSION minor version ${minor} exceeds ${MAX_MINOR_OR_PATCH}.`,
    );
  }
  if (patch > MAX_MINOR_OR_PATCH) {
    throw new Error(
      `T3CODE_MOBILE_FORK_VERSION patch version ${patch} exceeds ${MAX_MINOR_OR_PATCH}.`,
    );
  }
  if (revision > MAX_REVISION) {
    throw new Error(
      `T3CODE_MOBILE_FORK_VERSION fork revision ${revision} exceeds ${MAX_REVISION}.`,
    );
  }

  const versionCode = ((major * 1000 + minor) * 1000 + patch) * 100 + revision;
  if (versionCode > MAX_ANDROID_VERSION_CODE) {
    throw new Error(
      `T3CODE_MOBILE_FORK_VERSION "${forkVersion}" produces versionCode ${versionCode}, which exceeds Android's limit of ${MAX_ANDROID_VERSION_CODE}.`,
    );
  }

  return { versionName: forkVersion, versionCode };
}

// Unset returns null (upstream behavior); "fork" requires APP_VARIANT=production; anything else
// throws so a typo can't ship an unbranded build. A fork version without "fork" also throws.
export function resolveForkDistribution(
  distributionEnvValue: string | undefined,
  appVariant: ForkAppVariant,
  forkVersionEnvValue?: string,
): ForkDistributionOverrides | null {
  if (distributionEnvValue === undefined || distributionEnvValue === "") {
    if (forkVersionEnvValue !== undefined && forkVersionEnvValue !== "") {
      throw new Error("T3CODE_MOBILE_FORK_VERSION requires T3CODE_MOBILE_DISTRIBUTION=fork.");
    }
    return null;
  }

  if (distributionEnvValue !== "fork") {
    throw new Error(
      `T3CODE_MOBILE_DISTRIBUTION must be unset or "fork", got "${distributionEnvValue}".`,
    );
  }

  if (appVariant !== "production") {
    throw new Error(
      `T3CODE_MOBILE_DISTRIBUTION=fork requires APP_VARIANT=production, got "${appVariant}".`,
    );
  }

  const androidVersion =
    forkVersionEnvValue !== undefined && forkVersionEnvValue !== ""
      ? resolveAndroidVersion(forkVersionEnvValue)
      : null;

  return {
    appName: "T3 Code Fork",
    scheme: "t3code-fork",
    androidPackage: FORK_IDENTIFIER,
    iosBundleIdentifier: FORK_IDENTIFIER,
    signingPlugin: FORK_RELEASE_SIGNING_PLUGIN,
    easProjectId: FORK_EAS_PROJECT_ID,
    ...(androidVersion
      ? {
          androidVersionName: androidVersion.versionName,
          androidVersionCode: androidVersion.versionCode,
        }
      : {}),
  };
}
