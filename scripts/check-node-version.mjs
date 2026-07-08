#!/usr/bin/env node
/**
 * Enforce the repo's required Node major version (from `.nvmrc`) at install-time (`preinstall`) and
 * commit-time (husky `pre-commit`). Fails fast with a clear, actionable message instead of the cryptic
 * downstream errors a too-old Node produces (e.g. Prettier `Unexpected token 'with'` on the config's
 * import attributes, or vitest 4 refusing to start). Uses only Node built-ins so it runs before any
 * dependency is installed.
 */
import { readFileSync } from 'node:fs';

const nvmrc = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
const requiredMajor = Number.parseInt(nvmrc, 10);
const currentMajor = Number.parseInt(process.versions.node, 10);

if (Number.isNaN(requiredMajor)) {
    console.error(`check-node-version: could not parse a major version from .nvmrc ("${nvmrc}")`);
    process.exit(1);
}

if (currentMajor < requiredMajor) {
    console.error(
        `\n✖ This repository requires Node ${requiredMajor} (.nvmrc: ${nvmrc}). You are on ${process.version}.\n` +
            `  Fix: run \`nvm install && nvm use\` in the repo root, or make it your default:\n` +
            `       \`nvm alias default ${requiredMajor}\`\n`,
    );
    process.exit(1);
}
