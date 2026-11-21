// The boundaries baseline: an import that leaves its package is a DELIBERATE exception only when its pair says why.
// A repo-root `scripts/*.mjs` module has no workspace to declare, so a guard that tests its pure functions cannot
// declare the dependency; the pair must carry the reason (the same one its siblings carry), or it reads as debt that
// somebody will try to "fix" by moving the import behind a package that the script cannot depend on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const baseline = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'boundariesBaseline.json'), 'utf8'),
);

describe('boundariesBaseline.json', () => {
    it('gives every imports-outside-package pair a reason', () => {
        const bare = baseline.pairs
            .filter((pair) => pair.rule === 'imports-outside-package')
            .filter((pair) => typeof pair.why !== 'string' || pair.why.trim() === '')
            .map((pair) => `${pair.package} ${pair.dependency}`);

        assert.deepEqual(bare, []);
    });
});
