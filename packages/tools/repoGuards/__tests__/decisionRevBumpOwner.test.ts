// @vitest-environment node
/**
 * Repo-wide guard: ONE module moves a bulk-import item's `decision_rev` (GATE on #220).
 *
 * Moving `decision_rev` is a decision of the cook, and a decision does two things at once: it lifts a hold, and it starts the
 * count of unrecognised save failures again (`save_failures`, migration 0084). Three writes moved it, each spelling the bump
 * inline, and one of them (the review mark) forgot the reset: an item at four failures whose review the cook marked was held
 * after ONE more. So the bump is one constant, `BUMP_DECISION_REV` in `src/import/dal/decisionRev.ts`, and every write that
 * moves the revision spreads it.
 *
 * Every tracked TypeScript file of recipe-service is scanned with its comments blanked, for the bump spelled in a Drizzle
 * template (`${...decisionRev} + 1`) or in raw SQL (`decision_rev + 1`). Only the owner may hold it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot, trackedFiles } from './serviceSources.js';
import { withoutComments } from './sourceComments.js';

const SERVICE = 'packages/services/recipe-service';

/** The one module that spells the bump. */
const OWNER = `${SERVICE}/src/import/dal/decisionRev.ts`;

/** The bump, in a Drizzle template or in raw SQL. */
const INLINE_BUMP = /decisionRev\}\s*\+\s*1|decision_rev\s*\+\s*1/u;

/** Every tracked recipe-service TypeScript file that spells the bump, outside comments. */
function bumpSites(): readonly string[] {
    return trackedFiles(SERVICE)
        .filter((file) => file.endsWith('.ts'))
        .filter((file) => INLINE_BUMP.test(withoutComments(file, readFileSync(path.join(repoRoot, file), 'utf8'))));
}

describe('one module moves an import item’s decision_rev, and resets the failure count with it', () => {
    it('⛔ finds the bump only in its owner: every other write spreads BUMP_DECISION_REV', () => {
        expect(bumpSites()).toEqual([OWNER]);
    });

    it('has a real subject: the owner spells the bump and resets save_failures beside it', () => {
        const owner = withoutComments(OWNER, readFileSync(path.join(repoRoot, OWNER), 'utf8'));

        expect(owner).toMatch(INLINE_BUMP);
        expect(owner).toMatch(/saveFailures:\s*0/u);
    });
});
