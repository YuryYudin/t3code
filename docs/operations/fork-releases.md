# Fork releases

The `YuryYudin/t3code` Jenkins multibranch job follows upstream stable releases while continuously testing development updates from upstream `main`. Its nightly schedule validates and promotes a non-release candidate to `integration/upstream-main`. Independently, when a new upstream stable release appears, the same build prepares the stable candidate, builds the complete desktop matrix, advances fork `main`, and publishes a stable fork release.

Use **Build with Parameters** for these manual actions:

- `validate-only` checks an exact `UPSTREAM_REF` without changing GitHub, T3 Code, or release branches.
- `out-of-cycle` publishes the current fork source on the latest upstream stable base with the next numeric suffix. To release a reviewed maintenance branch before moving `main`, run that branch's job with `SOURCE_REF=HEAD`; Jenkins validates the full artifact set before promoting its candidate to `main`.
- `sync-upstream` immediately merges current upstream `main` into the persistent integration branch, tests all platforms, and advances only `integration/upstream-main`. An optional `SOURCE_REF` selects a reviewed fork source branch commit; the default remains stable fork `main`.

`apple-account-check` is a diagnostic action: it checks notarization access using the existing Jenkins Apple API credentials without building, signing, submitting, publishing, or promoting. Stable releases also perform this check before their platform build matrix. Integration and `validate-only` build macOS artifacts without release signing or notarization, so Apple account availability cannot block source synchronization. These validation artifacts are archived in Jenkins and never published to the stable updater. Both paths verify the complete artifact set, manifests, and checksums.

`DRY_RUN` builds and validates everything but never pushes, publishes, or reports incidents.
Scheduled `auto` builds perform release work only on the `main` job. The repository's Jenkinsfile guards other current branches. Reindex the multibranch project when branch jobs or their Jenkinsfiles are stale; indexing can queue builds for every changed discovered branch, so watch the queue and stop redundant builds by their exact job/build ID.

## Fork version policy

New fork builds should retain the exact official upstream stable version and add a numeric fork revision: upstream `v0.0.44` becomes fork `v0.0.44-1`, followed by `v0.0.44-2` for another build on that base. Select the official published, non-prerelease GitHub release and resolve its tag from the upstream remote; a stable-looking local tag alone is insufficient. Archived prereleases and drafts reserve their tag numbers but do not satisfy stable-release coverage.

On 2026-10-01, `v0.0.45-1`, `v0.0.45-2`, and `v0.0.45-3` were withdrawn from the stable update feed and retained as clearly labeled archived prereleases. All three were built on official stable `v0.0.44`, commit `451afcb22d93f06cb24f9bc16703404564952553`; their installer download counts were zero at withdrawal. `v0.0.43-1` was restored as latest while versioning was corrected. That older installed release retains the historical version offset and is based on upstream `v0.0.42`.

Keep the original tags and artifacts for the withdrawn releases. Renaming their GitHub tags or files would not change the version embedded in the signed apps or updater manifests. The corrected allocator reserves these archived tags but requires a published stable fork release on the exact upstream version before treating that upstream release as covered.

## Building the fork Android APK by hand

Jenkins does not yet publish a fork Android release. To build one locally so it installs side-by-side with the upstream Play Store app (`com.t3tools.t3code`), from `apps/mobile`:

```sh
export T3CODE_MOBILE_DISTRIBUTION=fork
export T3CODE_ANDROID_KEYSTORE_FILE=/absolute/path/to/release.keystore
export T3CODE_ANDROID_KEYSTORE_PASSWORD=...
export T3CODE_ANDROID_KEY_ALIAS=...
export T3CODE_ANDROID_KEY_PASSWORD=...
APP_VARIANT=production EXPO_NO_GIT_STATUS=1 npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
```

The APK lands at `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. `T3CODE_MOBILE_DISTRIBUTION=fork` points the app at `com.tapnetix.t3code`, names it "T3 Code Fork", and disables expo-updates so the binary never takes an upstream OTA. The four `T3CODE_ANDROID_*` env vars are read by Gradle at build time and never written to a generated file; `assembleRelease` fails before signing if any are missing instead of falling back to the debug key.

Back up the release keystore and its passwords permanently, outside this repository. A lost key cannot be replaced: Android refuses to install an update signed with a different key, so every user would have to uninstall and reinstall to get a future release.

## Access from the maintainer workspace

Jenkins is at `http://kubuntu:8080`. `curl --netrc` uses the existing local `~/.netrc` login. Check authenticated `/api/json` before concluding that an anonymous HTTP 403 requires a new credential. Keep `~/.netrc`, Jenkins crumbs, cookies, and API tokens out of logs, commits, and replies.

Authenticated POSTs require a crumb from `/crumbIssuer/api/json` **and the same session cookie** on the POST. Store both in private temporary files (`umask 077`), use `--netrc` on both requests, and dispose of the files afterward. Use `--data-urlencode` for build parameters. Branch names containing `/` are encoded in Jenkins job URLs: the reviewed release branch appears as `/job/tcoder%252Ffork-release-automation/`. Query the multibranch project's `/api/json` to find current job URLs instead of guessing them.

The existing maintainer login can read jobs, scan the multibranch project, and start authorized builds. It lacks `Job/Configure`; that permission is needed to change Jenkins job configuration, not to build or sign a release. Do not bypass that boundary through controller files. The global `$jenkins` skill records the access workflow for future sessions.

## One-time Jenkins setup

Create a GitHub multibranch Pipeline for `git@github.com:YuryYudin/t3code.git`, using `github-pockeo-ssh`, and discover `main`. The current project discovers every branch with a Jenkinsfile; only `main` should perform scheduled release work. The pipeline uses these labels and nodes:

- controller and durable state: `built-in` on kubuntu;
- Linux x64: `linux` (`ggnode*`);
- macOS arm64 and cross-built x64: `macos` (`mbook`);
- Windows x64: `pockeo-windows-3`, the provisioned member of the `pockeo-windows` pool. `pockeo-windows-1` lacked Python 3 and Visual Studio C++ prerequisites during the 2026-09-30 nightly build. Do not widen the selection until other workers pass the Windows preflight.

macOS packaging needs at least 8 GiB of free space. Below 12 GiB, Jenkins prunes regenerable pnpm and pip download caches before installing dependencies; if space remains insufficient, it stops before packaging.

Install `libsecret-1-dev`, `pkg-config`, ImageMagick, and `clang-15` once on every Linux agent. The pipeline selects Clang 15 for Electron native modules without changing the host defaults. The Jenkins account does not need sudo after that provisioning step.

Create `/var/lib/jenkins/t3code-fork-release` on kubuntu, owned and writable only by Jenkins, and include it in controller backups. It holds the durable incident, repair, lock, and verification journals plus validated Git rerere resolutions. It contains no credentials.

Configure the credential IDs referenced by `Jenkinsfile`:

- Git/GitHub: `github-pockeo-ssh`, `github-release-token` for release contents, and `github-incident-token` with Issues write access;
- existing Apple credentials: `apple-certificate`, `apple-certificate-password`, `apple-api-issuer`, `apple-api-key-id`, and `apple-api-key-p8`;
- public production configuration copied from the upstream stable desktop build: `t3code-clerk-publishable-key`, `t3code-clerk-jwt-template`, `t3code-clerk-cli-oauth-client-id`, and `t3code-relay-url`;
- the immutable full SHA of the originally reviewed bootstrap source commit: `t3code-bootstrap-source-sha`. Do not replace it with the current `bootstrap/0.0.41-1-source` branch HEAD; that branch later received Jenkinsfile maintenance;
- incident delivery: `t3code-jenkins-base-url`, `t3code-jenkins-project-id`, `t3code-jenkins-token`, and `t3code-jenkins-model-selection`. The model-selection credential is the selected project's current default model JSON and is used for automatic repairs and the v0.0.40 incident compatibility path.

Issue the T3 credential once on kubuntu and paste its output directly into the secret-text credential:

```sh
npx t3 auth session issue \
  --scope orchestration:operate \
  --ttl 3650d \
  --label "Jenkins fork maintenance" \
  --subject jenkins-fork-maintenance \
  --token-only
```

The selected T3 project must exist and have a default model. Automatic repair uses the existing `orchestration:operate` token and model selection; no broader token or Jenkins administrator permission is required. The T3 environment and Jenkins controller must share this machine. `FORK_REPAIR_PROJECT_ROOT` identifies the existing project directory so Jenkins can grant its owner access to isolated repair checkouts with `setfacl`. Jenkins creates these under its own private temporary root, retains them across build retries, and reuses one durable worker thread for integration and stable repairs, binding it to the selected checkout. It does not modify the user's project directory or directly open live T3 state for writing.

The worker returns a request-specific completion file; command acceptance alone is not completion. Jenkins checks the frozen HEAD, unresolved paths, staged changes, input ancestry, and protected automation files before creating a commit. Integration candidates merge stable fork `main` and upstream into the last verified integration tip, preserving prior resolutions. Stable candidates replay every canonical fork patch onto the exact official stable tag with linear history. A source/upstream/integration tuple receives at most two agent attempts, including test feedback. Jenkins restarts reuse pending requests and candidate state. Only candidates which pass quality, native compatibility when applicable, the desktop matrix, and asset verification may populate the shared resolution cache or be promoted.

Fast quality checks run before packaging. Mobile dependency or native changes additionally compile an Android development APK on `ggnode2`, using its provisioned Java and Android SDK. No emulator is launched or app installed. The current macOS worker has Xcode 15.4 and no CocoaPods, so it cannot compile current upstream iOS native clients; desktop macOS packaging and mobile TypeScript/tests remain required. Provision a compatible iOS worker before adding an iOS native compile gate.

The macOS stage signs `com.tapnetix.t3code` with the existing Developer ID certificate and notarizes it with the existing App Store Connect API key. Fork builds explicitly disable Clerk passkeys, so they do not request Associated Domains and do not need an App ID or provisioning profile. The regular Electron hardened-runtime entitlements continue to come from the signing tool's defaults.

The macOS stage also runs `scripts/ensure-apple-developer-id-g2.py`, which fetches Apple's **public** Developer ID G2 intermediate, verifies its pinned SHA-256, and makes it visible in the Jenkins user's keychain search list. This is separate from the private Developer ID identity in `apple-certificate`; do not rotate that credential merely because `security find-identity -v` reports zero valid identities. Compare a failing build with a known signed build and inspect the certificate chain and keychain search list first.

An Apple notarization HTTP 403 reporting a missing or expired agreement is an Apple response, not proof of an unsigned agreement. Before requesting account changes, run `ACTION=apple-account-check`: it reads the Notary API directly from kubuntu and macOS with the existing credential bindings, reports clock skew and a public key fingerprint, and uploads nothing. Compare both responses with `notarytool` and Apple's service status. If account inspection identifies pending terms or a membership issue, the [Account Holder](https://developer.apple.com/help/account/access/roles) must resolve it; the Jenkins API key cannot accept legal terms. Developer ID notarization is separate from App Store submission. On 2026-10-01, code-signature verification succeeded with the existing setup, but Apple returned this agreement error at 09:54 UTC. The last confirmed accepted notarization was earlier that same day at 02:57 UTC in [main build #5](http://kubuntu:8080/job/t3code/job/main/5/), which completed at 03:02 UTC and promoted the tested upstream snapshot to `integration/upstream-main`. This narrows the observed authorization failure window to 02:57–09:54 UTC. Do not rotate Jenkins credentials or rebuild all platforms merely to retry this account check. The [direct API diagnostic build #8](http://kubuntu:8080/job/t3code/job/fix%252Ffork-release-versioning/8/) at 2026-10-01 10:52 UTC received `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` from both hosts. The public key fingerprints matched, locally verified JWT signatures passed, clock skew was 0–1 seconds, no proxy environment was configured, and TLS verification was enabled. Apple listed no Developer ID Notary Service incident at the time. These checks isolate the rejection to Apple authorization rather than a Mac-only tool failure; they cannot distinguish a real pending agreement from stale Apple account state. Neither probe submitted software or changed any release. A read-only [Redrafter diagnostic build #36](http://kubuntu:8080/job/redrafter/job/main/36/) at 11:46 UTC reproduced the same HTTP 403 using Redrafter's own job context and existing credentials. It used Jenkins Replay to replace that run with only `notarytool history`; the repository pipeline, app, signing keychain, and releases were unchanged. This confirms the rejection affects both apps, rather than T3-specific build configuration.

### Checking whether stored Apple credentials changed

Matching credential IDs alone is insufficient. The Jenkins credential metadata API exposes a fingerprint whose calculation includes a hash of the encrypted secret; its usage record associates that stored credential version with build numbers. On 2026-10-01, all three current API credentials (`apple-api-key-p8`, `apple-api-key-id`, `apple-api-issuer`) matched the versions recorded for accepted T3 builds #35 and #52, failed T3 build #2 and diagnostic #8, accepted Redrafter build #35, and failed Redrafter diagnostic #36. The current certificate and password also matched accepted T3 #52 and failed T3 #2. No secret values were retrieved for this comparison. This establishes that the failed runs used the same stored credentials as the accepted runs; it is not a complete audit of every administrative action.

The G2 helper changes the Jenkins user's shared macOS keychain search list and installs a public intermediate into its dedicated local keychain. It does not update the Jenkins credential store. The Linux Notary API rejection is independent of that macOS state. Relative to the September 19 successful build's `buildMac` function, the G2 helper invocation is the only change; the Apple credential bindings and submit/staple commands are identical. Today's read-only preflight and diagnostics were added after the first agreement rejection.

## Bootstrap release

The first release is the one-time normalization from upstream `v0.0.40` to fork `v0.0.41-1`:

1. Create the bootstrap branch at the exact reviewed source commit.
2. Store that full SHA as `t3code-bootstrap-source-sha`.
3. Keep the credential pinned to that commit even if the branch later receives Jenkinsfile maintenance.
4. Run the job with `ACTION=auto` once.
5. Manually install the published `0.0.41-1` package over the upstream application. Later fork releases update normally from `YuryYudin/t3code`.

The checked-in Collections patch is executable release input, not documentation. `node scripts/fork-release.ts verify-bootstrap` checks its SHA-256 and 79-path manifest before use. The first candidate applies it only to the pinned `v0.0.40` tree, checks the exact result tree, makes one deterministic Collections commit, and then replays every infrastructure commit from the protected source range. No file or upstream change is skipped.

## Promotion and failure behavior

Releases fail closed. Jenkins verifies the complete artifact set and merged updater manifests while the GitHub release is still a draft, updates `main` with an observed-SHA `--force-with-lease`, then makes the draft non-prerelease and latest. Windows artifacts are intentionally unsigned; both macOS architectures must be Developer ID signed and notarized.

Updater manifest sizes and SHA-512 hashes are finalized from the completed artifacts after notarization tickets are stapled. SHA-256 checksums are regenerated afterward, so they describe the exact files published by the release transaction.

Configure a linear-history ruleset for `main`: require pull requests, allow only squash/rebase merging, block merge commits and direct human pushes, and grant the Jenkins Git actor the only promotion bypass. `integration/upstream-main` and `main` are always moved with an observed lease; a stale lease is an incident, never an unconditional force push.

One permanent T3 notification thread serves each fork across integration, stable, and out-of-cycle failures, including failures after a previous recovery. Its durable binding adopts an existing incident thread and keeps that thread's original external-alert owner. GitHub issues still track individual workflow episodes. Recovering integration keeps the notification failing while a release failure remains outstanding. Recovery links point to the successful build. The durable outbox is written before either service is contacted. Retries reuse the same deterministic command IDs, and recovery is appended to T3 before Jenkins closes GitHub. Do not delete outbox files manually; retain them for audit and let subsequent serialized runs reconcile them.

A workflow lock spans all branch jobs, using Jenkins run IDs and `waitForBuild` to wait for the previous owner rather than guessing whether a timed lease has expired. Promotion uses the branch SHA observed before preparation. If a different actor moves a branch, promotion fails closed. Unchanged integration inputs with matching verified branch evidence skip rebuilding. Failed integration work does not prevent the independent stable-release attempt, and an Apple account rejection does not block integration.

If both automatic repair attempts fail, the existing incident retains the target, conflict paths, attempt count, and build evidence. Before a feedback repair, Jenkins installs dependencies in the shared checkout so the worker can run the failing focused tests and discover follow-on errors within the same attempt. Integration and stable repairs reuse the existing automatic maintenance worker thread. A later input may trigger another bounded repair; retries of the same failed input do not start duplicate agents. A successful rerun records recovery in the permanent notification thread. Inspect the durable journal and Jenkins logs before taking over a repair; do not drop mobile, server, web, or desktop changes to make a candidate pass.

## What happened on 2026-09-30

The previous fork release, `v0.0.43-1`, came from a successful Jenkins `out-of-cycle` build [#35](http://kubuntu:8080/job/t3code/job/tcoder%252Ffork-release-automation/35/). Its macOS apps were signed with the existing YBY Consulting Developer ID identity and accepted by Apple notarization. A subsequent scheduled `auto` build [#37](http://kubuntu:8080/job/t3code/job/tcoder%252Ffork-release-automation/37/) succeeded. The later automated replay failed on upstream source conflicts; this was a source-resolution failure, not a missing Jenkins login.

The fork's 25 commits were replayed onto upstream stable `v0.0.44` for the next release. [Build #49](http://kubuntu:8080/job/t3code/job/tcoder%252Ffork-release-automation/49/) imported the same signing identities but found zero _valid_ code-signing identities on macOS. Its app was ad hoc signed, Apple rejected notarization, and the pipeline stopped before promoting or publishing. The old build had found valid identities. The missing piece was Apple's Developer ID G2 intermediate: an unrelated keychain present in the old Mac search path had disappeared. What removed that keychain is unknown. Redrafter explicitly imports the public intermediate; T3 had implicitly depended on the other keychain. After restoring the public certificate, [build #50](http://kubuntu:8080/job/t3code/job/tcoder%252Ffork-release-automation/50/) signed and notarized both architectures and published `v0.0.45-1`. No private Jenkins credential was changed.

Upstream `main` then changed `pnpm-lock.yaml` with its Vite+ update. The nightly replay stopped on that generated-file conflict. `scripts/fork-release.ts` now keeps the target lockfile and regenerates it with the fork's manifests when the lockfile is the _only_ conflict; other unexpected conflicts still stop the replay. [Build #51](http://kubuntu:8080/job/t3code/job/tcoder%252Ffork-release-automation/51/) published `v0.0.45-2` with this repair and the automatic G2 setup. The first repaired `main` auto run then landed on `pockeo-windows-1` and failed its Windows prerequisites. Pinning the provisioned worker yielded [build #52](http://kubuntu:8080/job/t3code/job/tcoder%252Ffork-release-automation/52/) and the `v0.0.45-3` release, subsequently withdrawn as described above.

Finally, [the `main` auto build #3](http://kubuntu:8080/job/t3code/job/main/3/) replayed upstream commit `35be904f2fc40aa6d7a42778b6895e8274f3097f`, passed quality and all platform artifacts, and promoted `integration/upstream-main` to `b7e10569884236d12a0c240200d087a100c2e4e0`. It closed the original [nightly incident](https://github.com/YuryYudin/t3code/issues/21). The multibranch scan used during recovery also exposed four historical branch jobs with old cron triggers. Their Jenkinsfiles now exit on `ACTION=auto` and have no cron trigger; the reindex builds verified the no-op behavior. The current release and integration branches retain the main-only `auto` guard.
