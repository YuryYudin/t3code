#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const result = spawnSync("effect-tsgo", ["tsrs", ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error !== undefined) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
