# Fork operations

This branch holds the Jenkins pipeline and release automation for the `YuryYudin/t3code` fork. It shares no history with the product branches: fork `main` carries the product, and this branch carries only the tooling that tracks upstream, repairs replays, builds, and publishes fork releases.

Start with [docs/operations/fork-releases.md](docs/operations/fork-releases.md).

The scripts import product modules such as `scripts/lib/update-manifest.ts`, so they run from a product checkout with these files laid on top, as each Jenkins stage does. To test a change locally, copy the files into a product worktree that has its dependencies installed, run `vp test run scripts/fork-release.test.ts scripts/fork-integration.test.ts` and `vp run --filter ./scripts typecheck`, then delete the copies.
