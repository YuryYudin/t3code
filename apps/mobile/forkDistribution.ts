// Fork distribution profile (T3CODE_MOBILE_DISTRIBUTION=fork), kept out of
// app.config.ts so the upstream file only gains call sites when the fork is
// replayed onto upstream. A fork binary installs beside the Play Store app and
// must never take an upstream OTA: fork JS is native-compatible with upstream
// fingerprints, so an upstream update would silently replace it. app.config.ts
// therefore disables expo-updates and drops upstream's EAS linkage.

export type ForkAppVariant = "development" | "preview" | "production";

export const FORK_IDENTIFIER = "com.tapnetix.t3code";
export const FORK_RELEASE_SIGNING_PLUGIN = "./plugins/withAndroidReleaseSigning.cjs";

export interface ForkDistributionOverrides {
  readonly appName: string;
  readonly scheme: string;
  readonly androidPackage: string;
  readonly iosBundleIdentifier: string;
  readonly signingPlugin: string;
}

/**
 * Resolves the fork distribution env value into config overrides.
 *
 * - `undefined` (or `""`) returns `null`: today's upstream behavior, unchanged.
 * - `"fork"` returns the fork overrides, and requires `appVariant === "production"`.
 * - Any other non-empty value throws, since a typo should fail loudly rather
 *   than silently ship an unbranded build.
 */
export function resolveForkDistribution(
  distributionEnvValue: string | undefined,
  appVariant: ForkAppVariant,
): ForkDistributionOverrides | null {
  if (distributionEnvValue === undefined || distributionEnvValue === "") {
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

  return {
    appName: "T3 Code Fork",
    scheme: "t3code-fork",
    androidPackage: FORK_IDENTIFIER,
    iosBundleIdentifier: FORK_IDENTIFIER,
    signingPlugin: FORK_RELEASE_SIGNING_PLUGIN,
  };
}
