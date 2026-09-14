# Fork releases

The `YuryYudin/t3code` Jenkins multibranch job follows upstream stable releases while continuously proving that the fork remains replayable on upstream `main`. Its nightly schedule first validates and promotes a non-release candidate to `integration/upstream-main`. When a new upstream stable tag appears, the same build prepares the stable candidate, builds the complete desktop matrix, advances fork `main`, and publishes a stable fork release.

Use **Build with Parameters** only for two exceptions:

- `validate-only` checks an exact `UPSTREAM_REF` without changing GitHub, T3 Code, or release branches.
- `out-of-cycle` publishes the current fork source on the latest upstream stable base with the next numeric suffix.

`DRY_RUN` builds and validates everything but never pushes, publishes, or reports incidents.

## One-time Jenkins setup

Create a GitHub multibranch Pipeline for `git@github.com:YuryYudin/t3code.git`, using `github-pockeo-ssh`, and discover `main`. The pipeline uses these labels:

- controller and durable state: `built-in` on kubuntu;
- Linux x64: `linux` (`ggnode*`);
- macOS arm64 and cross-built x64: `macos` (`mbook`);
- Windows x64: `pockeo-windows`.

Install `libsecret-1-dev`, `pkg-config`, ImageMagick, and `clang-15` once on every Linux agent. The pipeline selects Clang 15 for Electron native modules without changing the host defaults. The Jenkins account does not need sudo after that provisioning step.

Create `/var/lib/jenkins/t3code-fork-release` on kubuntu, owned and writable only by Jenkins, and include it in controller backups. It is the durable incident/promotion journal and contains no credentials.

Configure the credential IDs referenced by `Jenkinsfile`:

- Git/GitHub: `github-pockeo-ssh`, `github-release-token` for release contents, and `github-incident-token` with Issues write access;
- existing Apple credentials: `apple-certificate`, `apple-certificate-password`, `apple-api-issuer`, `apple-api-key-id`, and `apple-api-key-p8`;
- public production configuration copied from the upstream stable desktop build: `t3code-clerk-publishable-key`, `t3code-clerk-jwt-template`, `t3code-clerk-cli-oauth-client-id`, and `t3code-relay-url`;
- the immutable full SHA of `origin/bootstrap/0.0.41-1-source`: `t3code-bootstrap-source-sha`;
- incident delivery: `t3code-jenkins-base-url`, `t3code-jenkins-project-id`, `t3code-jenkins-token`, and `t3code-jenkins-model-selection`. The model-selection credential is the selected project's current default model JSON and is used only by the v0.0.40 compatibility path.

Issue the T3 credential once on kubuntu and paste its output directly into the secret-text credential:

```sh
npx t3 auth session issue \
  --scope orchestration:operate \
  --ttl 3650d \
  --label "Jenkins fork maintenance" \
  --subject jenkins-fork-maintenance \
  --token-only
```

The selected T3 project must exist and have a default model. Jenkins only creates passive incident threads; it never starts a turn or settles them.

The macOS stage signs `com.tapnetix.t3code` with the existing Developer ID certificate and notarizes it with the existing App Store Connect API key. Fork builds explicitly disable Clerk passkeys, so they do not request Associated Domains and do not need an App ID or provisioning profile. The regular Electron hardened-runtime entitlements continue to come from the signing tool's defaults.

## Bootstrap release

The first release is the one-time normalization from upstream `v0.0.40` to fork `v0.0.41-1`:

1. Create the protected branch `bootstrap/0.0.41-1-source` at the exact reviewed source commit.
2. Store that full SHA as `t3code-bootstrap-source-sha`.
3. Protect the bootstrap branch from changes.
4. Run the job with `ACTION=auto` once.
5. Manually install the published `0.0.41-1` package over the upstream application. Later fork releases update normally from `YuryYudin/t3code`.

The checked-in Collections patch is executable release input, not documentation. `node scripts/fork-release.ts verify-bootstrap` checks its SHA-256 and 79-path manifest before use. The first candidate applies it only to the pinned `v0.0.40` tree, checks the exact result tree, makes one deterministic Collections commit, and then replays every infrastructure commit from the protected source range. No file or upstream change is skipped.

## Promotion and failure behavior

Releases fail closed. Jenkins verifies the complete artifact set and merged updater manifests while the GitHub release is still a draft, updates `main` with an observed-SHA `--force-with-lease`, then makes the draft non-prerelease and latest. Windows artifacts are intentionally unsigned; both macOS architectures must be Developer ID signed and notarized.

Configure a linear-history ruleset for `main`: require pull requests, allow only squash/rebase merging, block merge commits and direct human pushes, and grant the Jenkins Git actor the only promotion bypass. `integration/upstream-main` and `main` are always moved with an observed lease; a stale lease is an incident, never an unconditional force push.

One open GitHub issue and one passive T3 thread represent each repository/job/mode/target/failure-class incident. The durable outbox is written before either service is contacted. Retries reuse the same deterministic command IDs, and recovery is appended to T3 before Jenkins closes GitHub. Do not delete outbox files manually; retain them for audit and let subsequent serialized runs reconcile them.

If a nightly replay fails, resolve every upstream conflict in a normal reviewed PR. Do not drop mobile, server, web, or desktop changes to make the replay pass. After merging the fix, rerun the job; the successful run records recovery in the existing incident thread.
