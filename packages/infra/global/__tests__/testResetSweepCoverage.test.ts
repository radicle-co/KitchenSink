// @vitest-environment node
/**
 * Every table in the recipe database that carries a person's identifier must be MUTATED by the test-principal purge
 * (`purgeTestPrincipalRows`, ADR-0040), or be EXEMPT from it for a written reason.
 *
 * ## Why a second gate, beside `erasureSweepCoverage.test.ts`
 *
 * The purge and the GDPR erasure answer different questions about the same tables, so neither gate can stand in for
 * the other. Erasure is SCOPED and one-shot: it keeps truly-public recipes pseudonymized, and it deliberately retains
 * the two ingredient-correction tables by owner ruling (ADR-0027). The purge is TOTAL and repeatable: a test-pool slot
 * must start its next run from an empty world, so a test principal's truly-public recipe, its corrections and its
 * analytics all have to go. A user-bearing table added tomorrow therefore needs TWO decisions — how erasure treats it
 * and how the purge treats it — and a gate that only asks the first lets the second default to "leave it", which is
 * exactly the leak the test pool exists to prevent: a stale fixture from run N silently shaping run N+1, or a test
 * principal's data surviving into a real user's search results.
 *
 * ## What is asserted, and why it is bidirectional
 *
 * The user-bearing tables are DISCOVERED by the same migration fold the erasure gate uses (`sweepCoverageReaders.ts`)
 * — never enumerated here — and the purged tables are DISCOVERED from the mutating statements `purgeTestPrincipalRows`
 * actually issues, read from the TypeScript AST so its docstring contributes nothing. Then:
 *
 *  * every discovered user-bearing table is mutated by the purge or exempted with its reason — never neither;
 *  * every exemption names a table that still EXISTS and still carries a user column, so it cannot outlive the thing
 *    it excused and silently cover a future table that reuses the name;
 *  * no exemption names a table the purge mutates, so a closed gap is reported rather than left standing as a claim
 *    that the purge does not touch it;
 *  * the discovered count is pinned EXACTLY, so a fold that spuriously drops a table goes red instead of green.
 *
 * ⚠️ "Mutated" is read from `UPDATE`, `DELETE FROM` and `INSERT INTO`, exactly as the erasure gate reads it. That is
 * a claim about the statement SET, not about which rows each statement reaches: whether the purge's predicates find
 * every row of the principal's is proven against a real database by recipe-workers'
 * `__tests__/integration/erasure/testPrincipalReset.integration.test.ts`, which this gate does not replace.
 *
 * DESIGN PATTERN: Specification module — the same pure readers as `erasureSweepCoverage.test.ts`, over a different
 * sweep and its own exemption map.
 */
import { describe, expect, it } from 'vitest';

import {
    migrationsOf,
    readSource,
    sweptTablesIn,
    userBearingTablesAfter,
    userBearingTablesEver,
} from './sweepCoverageReaders.js';

/** Repo-relative directory holding the recipe database's migrations. */
const RECIPE_MIGRATIONS = 'packages/services/recipe-service/src/database/migrations';

/** Repo-relative source declaring the purge. */
const PURGE_FILE = 'packages/services/recipe-workers/src/handlers/accountErasureWorker.ts';

/**
 * The declaration whose statements ARE the purge. ⛔ It must stay a `const` bound to an arrow function: the reader
 * descends into `VariableDeclaration`s only, so a `function` declaration would yield zero statements and the
 * non-vacuity assertion below — not the coverage assertion — would be what reports it.
 */
const PURGE_FUNCTION = 'purgeTestPrincipalRows';

/**
 * Tables that carry a user column and are DELIBERATELY not mutated by the purge.
 *
 * ⛔ Each entry is a claim that leaving the table alone is CORRECT for a test-pool reset, and it is checked in both
 * directions below. "It seemed fine" is not an entry.
 */
const EXEMPT_FROM_TEST_RESET: ReadonlyMap<string, string> = new Map([
    [
        'account_erasure_jobs',
        'the GDPR erasure LEGAL RECORD; a purge that deleted it would make an erasure look like it never happened, ' +
            'and containment already refuses erasure for a test principal, so no row should exist to purge',
    ],
    [
        'test_principals',
        'the registry the purge is AUTHORIZED by (ADR-0040: the signed claim AND this row); deleting it would make ' +
            'the NEXT reset of the same pool slot refuse, so the purge must leave it agreeing with the claim',
    ],
    [
        'test_reset_jobs',
        'the job row the running purge is accountable for: the worker claims it before the purge and marks it ' +
            'completed after the S3 sweep and CDN purge, so deleting it inside the purge would erase the proof of ' +
            'the reset and let a redelivery read as misrouted',
    ],
    [
        'recipe_versions',
        '`created_by` is reached by the ON DELETE CASCADE from `recipes`, which the purge deletes owner-wide; ' +
            'recipe mutations are owner-only, so a version created by the principal belongs to one of its own ' +
            'recipes and cannot survive that delete',
    ],
]);

/**
 * The user-bearing tables a working discovery finds in the recipe database — EXACT, compared with `toBe`.
 *
 * ⚠️ The same number `erasureSweepCoverage.test.ts` pins for the same database, and deliberately a second copy
 * rather than an import: each gate must go red on its own when the schema moves, so that the change adding a
 * user-bearing table is forced to make BOTH decisions. Measured at 13 on 2026-09-13 (ADR-0040's 0044 and 0045 took
 * it from 11). Red on a legitimate addition is the accepted cost — raise it in that same change.
 */
const EXPECTED_USER_BEARING_TABLES = 13;

describe('test-principal purge coverage (ADR-0040)', () => {
    it('mutates every user-bearing table, or exempts it for a written reason', () => {
        const owned = userBearingTablesAfter(migrationsOf(RECIPE_MIGRATIONS));
        const purged = new Set(sweptTablesIn(readSource(PURGE_FILE), PURGE_FUNCTION));

        expect(
            owned.length,
            'the user-bearing table count moved — raise the pin in the migration’s own change, or discovery has ' +
                'broken and is finding fewer tables than the schema has',
        ).toBe(EXPECTED_USER_BEARING_TABLES);
        expect(
            purged.size,
            `${PURGE_FUNCTION} mutates no tables — the reader has lost the declaration`,
        ).toBeGreaterThan(0);

        // ⛔ A table here is a test principal's data that a reset leaves behind with no decision about it. Add a
        // statement to the purge, or an exemption SAYING why a test-pool reset must leave it — never neither.
        expect(owned.filter((table) => !purged.has(table) && !EXEMPT_FROM_TEST_RESET.has(table))).toEqual([]);
    });

    it('carries no exemption for a table that no longer bears a user column', () => {
        const owned = new Set(userBearingTablesAfter(migrationsOf(RECIPE_MIGRATIONS)));

        expect([...EXEMPT_FROM_TEST_RESET.keys()].filter((table) => !owned.has(table))).toEqual([]);
    });

    it('carries no exemption for a table the purge already mutates', () => {
        const purged = new Set(sweptTablesIn(readSource(PURGE_FILE), PURGE_FUNCTION));

        // An exemption for a mutated table reads as "a reset leaves this alone", the opposite of the truth. For
        // `test_principals` and `test_reset_jobs` it is worse: a purge statement against either would be the defect
        // the exemption exists to forbid.
        expect([...EXEMPT_FROM_TEST_RESET.keys()].filter((table) => purged.has(table))).toEqual([]);
    });

    it('states a real reason for every exemption', () => {
        // Non-vacuity FIRST: the registry, the job row and the legal record are real, standing exemptions, so an
        // emptied map means a decision was dropped rather than settled.
        expect(EXEMPT_FROM_TEST_RESET.size, 'the exemptions have been emptied').toBeGreaterThan(0);

        for (const [table, why] of EXEMPT_FROM_TEST_RESET) {
            expect(why.trim().length, `the exemption for ${table} must say why a reset leaves it`).toBeGreaterThan(40);
        }
    });

    it('⛔ never REMOVES a table the union found — a fold may only ever subtract', () => {
        const migrations = migrationsOf(RECIPE_MIGRATIONS);
        const ever = new Set(userBearingTablesEver(migrations));

        expect(ever.size, 'the union found nothing — the reader has broken').toBeGreaterThanOrEqual(
            EXPECTED_USER_BEARING_TABLES,
        );
        expect(userBearingTablesAfter(migrations).filter((table) => !ever.has(table))).toEqual([]);
    });

    it('⛔ FAILS a user-bearing table the purge never mutates and no exemption names', () => {
        // Drives the SAME readers at a deliberately-violating fake, so the coverage verdict above is proven able to
        // fire rather than assumed to.
        const migration = {
            file: 'fake/0099_new_table.sql',
            contents: `
                -- A purge for "widgets" is described in this comment and nowhere else.
                CREATE TABLE "widgets" ("id" uuid PRIMARY KEY, "user_id" varchar(255), "payload" jsonb NOT NULL);
            `,
        };
        const purge = {
            file: 'fake/purge.ts',
            contents: `
                /** Purges recipes and widgets. */
                export const purgeTestPrincipalRows = async (tx) => {
                    await tx.execute(sql\`SELECT id FROM widgets WHERE user_id = \${ownerId}\`);
                    await tx.execute(sql\`DELETE FROM recipes WHERE owner_id = \${ownerId}\`);
                };
            `,
        };

        const owned = userBearingTablesAfter([migration]);
        const purged = new Set(sweptTablesIn(purge, PURGE_FUNCTION));

        expect(owned).toEqual(['widgets']);
        expect(owned.filter((table) => !purged.has(table) && !EXEMPT_FROM_TEST_RESET.has(table))).toEqual(['widgets']);
    });

    it('⛔ reads NOTHING from a `function` declaration — the shape the non-vacuity assertion exists for', () => {
        const purge = {
            file: 'fake/purge.ts',
            contents: `
                export async function purgeTestPrincipalRows(tx) {
                    await tx.execute(sql\`DELETE FROM recipes WHERE owner_id = \${ownerId}\`);
                }
            `,
        };

        expect(sweptTablesIn(purge, PURGE_FUNCTION)).toEqual([]);
    });
});
