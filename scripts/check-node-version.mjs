#!/usr/bin/env node
/**
 * Enforce the repo's required Node major version (from `.nvmrc`) at **commit time** (husky `pre-commit`),
 * complementing the `engine-strict=true` in `.npmrc` that already blocks `npm install` on the wrong Node
 * (git hooks are not npm, so engine-strict cannot gate them). Fails fast with a clear, actionable message
 * instead of the cryptic downstream errors a too-old Node produces inside the hook — e.g. Prettier
 * `Unexpected token 'with'` loading its import-attribute config, which would otherwise fail lint-staged
 * and revert the working tree from its stash. Uses only Node built-ins.
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
