// @vitest-environment node
/**
 * ⛔ THE SECURITY BOUNDARY OF A `DROP DATABASE` CAPABILITY. Fired at deliberately violating fakes, not only
 * at the names this repository happens to generate today.
 *
 * ## What this predicate authorises, and why it needs its own file
 *
 * `PerPrDatabaseReaperFunction` (ADR-0031) connects to the shared sandbox RDS **as the master user** and
 * drops logical databases. It is the only thing standing between a `pr-{N}` token and
 * `kitchensink_identity` — the database every preview signs in against — so it lives in one module with a
 * regression suite that executes it, exactly like `.github/scripts/pr-scope.sh` and
 * `packages/infra/global/__tests__/prScope.test.ts`.
 *
 * ## The rule, in one line
 *
 * A database is reapable for a token **iff** the token is exactly `pr-{digits}` AND the database name is not
 * one of the explicitly protected names AND the name is EXACTLY a name this repository's own derivation
 * produces for that token.
 *
 * ⛔ **Exact equality, never a prefix or a `LIKE '%_pr_%'`.** `kitchensink_food_pr_15` must not answer a
 * request for `pr-1`, and that is structural here rather than something a delimiter has to catch — the same
 * argument `pr_scope_environment_belongs` makes for GitHub Environments. The `pr_scope_belongs` PREFIX rule
 * is the weaker form and is deliberately not reused: an AWS stack legitimately carries `pr-{N}-…` suffixes,
 * a logical database never does.
 *
 * ⛔ **Two INDEPENDENT checks authorise every drop**, and neither is sufficient alone:
 *
 *  - **The refusal** ({@link isProtectedDatabase}) is a denylist of exact names — every base database plus
 *    PostgreSQL's own catalogue. It is a statement about the DATABASE and survives any change to the
 *    derivation.
 *  - **The derivation** ({@link perPrDatabaseNamesFor}) is an allowlist of exact names built from the token
 *    and the registered bases. It is a statement about the TOKEN × DATABASE pair.
 *
 * A single check is one edit away from authorising destruction. Two differently-shaped ones are not, and the
 * handler re-runs the whole verdict at the point of destruction on top of that — the same belt-and-braces
 * `teardown-sandbox-pr.sh` applies to GitHub Environments ("the scope predicate let it through, which is a
 * bug in pr-scope.sh").
 *
 * ## The census direction
 *
 * {@link perPrTokenOfDatabase} answers the inverse question — "whose is this?" — because the reaper must be
 * able to COUNT stranded databases with no token in hand (ADR-0031: the Phase 0 census cannot fire on an
 * ordinary deploy, since both bootstrap Lambdas are custom-resource-backed and CloudFormation only re-invokes
 * them when their properties change). The two directions are separate implementations, so the invariant that
 * keeps them from drifting is asserted rather than assumed.
 */
import { describe, expect, it } from 'vitest';

import {
    PER_PR_DATABASE_BASES,
    PER_PR_DATABASE_BASE_BY_PRODUCER,
    PROTECTED_DATABASES,
    PerPrScopeViolationError,
    isPerPrScopeViolationError,
    isPerPrToken,
    isProtectedDatabase,
    isReapablePerPrDatabase,
    perPrDatabaseNamesFor,
    perPrTokenOfDatabase,
} from '../src/db-reaper/perPrDatabaseScope.js';

/** Tokens that are NOT `pr-{digits}`. Every one of these reaches a derived name if it gets through. */
const MALFORMED_TOKENS: readonly string[] = [
    '',
    'pr-',
    'pr',
    'PR-1',
    'pr-1 ',
    ' pr-1',
    'pr-1a',
    'pr-1.2',
    'pr-1_2',
    'pr-1;DROP DATABASE kitchensink_identity',
    'pr-*',
    '*',
    '%',
    'pr-1%',
    '_',
    'sandbox',
    'prod',
    'global',
    '../pr-1',
    'pr-1\n',
    'pr--1',
    '-1',
    '1',
];

describe('isPerPrToken — the gate every other predicate stands behind', () => {
    it('accepts exactly `pr-` followed by digits', () => {
        for (const token of ['pr-1', 'pr-15', 'pr-100', 'pr-0', 'pr-01']) {
            expect(isPerPrToken(token), token).toBe(true);
        }
    });

    it.each(MALFORMED_TOKENS)('refuses %j', (token) => {
        expect(isPerPrToken(token)).toBe(false);
    });
});

describe('isProtectedDatabase — the refusal that is independent of any derivation', () => {
    it('refuses every base logical database, INCLUDING the one with no per-PR children', () => {
        // ⛔ `kitchensink_identity` has no per-PR databases at all (ADR-0006), so no derivation could ever
        // produce it — which is precisely why it is named here. The refusal must not depend on the
        // derivation being right.
        for (const base of ['kitchensink_identity', 'kitchensink_food', 'kitchensink_recipes']) {
            expect(isProtectedDatabase(base), base).toBe(true);
        }
    });

    it("refuses PostgreSQL's own catalogue and the RDS maintenance database", () => {
        for (const name of ['postgres', 'template0', 'template1', 'rdsadmin']) {
            expect(isProtectedDatabase(name), name).toBe(true);
        }
    });

    it('names every base the derivation register knows, so the two cannot drift apart', () => {
        for (const base of PER_PR_DATABASE_BASES) {
            expect(PROTECTED_DATABASES).toContain(base);
        }
    });

    it('does not refuse a genuine per-PR name (or the refusal would refuse everything)', () => {
        expect(isProtectedDatabase('kitchensink_food_pr_73')).toBe(false);
    });

    it('⛔ is LOAD-BEARING: it still refuses when the DERIVATION is the thing that broke', () => {
        // ⚠️ The whole point of a second check is that it is only observable once the first one is wrong, so
        // asserting `isReapablePerPrDatabase` alone can never demonstrate it — every base name is refused by
        // the derivation too, today. This composes the verdict with a deliberately WIDENED derivation (the
        // mutation an empty suffix would produce) and shows which half does the refusing.
        const widenedDerivation = (token: string): readonly string[] => [
            ...PER_PR_DATABASE_BASES,
            ...perPrDatabaseNamesFor(token),
        ];

        for (const base of PER_PR_DATABASE_BASES) {
            expect(widenedDerivation('pr-1'), 'the mutation must really reach the base name').toContain(base);
            expect(isProtectedDatabase(base), `${base} must still be refused`).toBe(true);
        }
    });
});

describe('perPrDatabaseNamesFor — the derivation, and its refusal to run on a bad token', () => {
    it('derives exactly one name per registered base, in the `_pr_{N}` shape the stacks produce', () => {
        expect([...perPrDatabaseNamesFor('pr-73')].sort()).toEqual(
            ['kitchensink_food_pr_73', 'kitchensink_recipes_pr_73'].sort(),
        );
    });

    it.each(MALFORMED_TOKENS)('THROWS rather than deriving anything from %j', (token) => {
        // ⛔ Not "returns an empty list". A caller that skipped the gate must fail loudly, the way
        // `pr_scope_belongs` returns 2 on a malformed token instead of answering "no".
        expect(() => perPrDatabaseNamesFor(token)).toThrow(PerPrScopeViolationError);
    });

    it('carries a type guard, per the repository error convention', () => {
        try {
            perPrDatabaseNamesFor('nope');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(isPerPrScopeViolationError(error)).toBe(true);
        }

        expect(isPerPrScopeViolationError(new Error('other'))).toBe(false);
    });
});

describe('isReapablePerPrDatabase — the verdict that authorises a DROP', () => {
    it('accepts the two names, and ONLY the two names, this repository derives for the token', () => {
        expect(isReapablePerPrDatabase('pr-73', 'kitchensink_food_pr_73')).toBe(true);
        expect(isReapablePerPrDatabase('pr-73', 'kitchensink_recipes_pr_73')).toBe(true);
    });

    it('⛔ refuses pr-1 the database of pr-15, pr-100 and pr-01', () => {
        // The delimiter trap `pr-scope.sh` was written around, arriving here as a SUFFIX rather than a
        // prefix. A `LIKE 'kitchensink_food_pr_1%'` — the obvious implementation — matches all three.
        for (const other of ['kitchensink_food_pr_15', 'kitchensink_food_pr_100', 'kitchensink_food_pr_01']) {
            expect(isReapablePerPrDatabase('pr-1', other), other).toBe(false);
        }
    });

    it('⛔ refuses the reverse direction too — pr-15 may not claim pr-1', () => {
        expect(isReapablePerPrDatabase('pr-15', 'kitchensink_food_pr_1')).toBe(false);
    });

    it('⛔ refuses EVERY protected database, for every token', () => {
        for (const base of PROTECTED_DATABASES) {
            expect(isReapablePerPrDatabase('pr-1', base), base).toBe(false);
        }
    });

    it('⛔ refuses a name that merely CONTAINS a derived name', () => {
        for (const near of [
            'kitchensink_food_pr_73_backup',
            'kitchensink_food_pr_73 ',
            'xkitchensink_food_pr_73',
            'kitchensink_food_pr_73_old',
            'kitchensink_foodx_pr_73',
            'kitchensink_food__pr_73',
        ]) {
            expect(isReapablePerPrDatabase('pr-73', near), near).toBe(false);
        }
    });

    it('⛔ refuses a non-PR per-stage database — `dev`/`test`/`local` stages own one too', () => {
        // `recipeDatabaseNameForStage('dev', …)` is `kitchensink_recipes_dev`. It is not a preview's, so no
        // `pr-{N}` teardown may touch it, and a shape-based rule that keyed on "has a suffix" would.
        for (const name of ['kitchensink_recipes_dev', 'kitchensink_food_test', 'kitchensink_food_local']) {
            expect(isReapablePerPrDatabase('pr-73', name), name).toBe(false);
        }
    });

    it('⛔ refuses a name differing only by CASE', () => {
        // PostgreSQL identifiers are case-sensitive once quoted, and every name this repository derives is
        // lowercase — so an upper-case one was created by somebody else.
        expect(isReapablePerPrDatabase('pr-73', 'KITCHENSINK_FOOD_PR_73')).toBe(false);
        expect(isReapablePerPrDatabase('pr-73', 'Kitchensink_Food_Pr_73')).toBe(false);
    });

    it.each(MALFORMED_TOKENS)('refuses everything for the malformed token %j', (token) => {
        for (const name of ['kitchensink_food_pr_1', 'kitchensink_food', 'kitchensink_identity', 'postgres']) {
            expect(isReapablePerPrDatabase(token, name), `${token} / ${name}`).toBe(false);
        }
    });

    it('never authorises a name carrying a character `DROP DATABASE "…"` could not safely quote', () => {
        // The verdict is what makes quoting the identifier safe, so state the property it must guarantee.
        for (const token of ['pr-0', 'pr-7', 'pr-73', 'pr-1234567890']) {
            for (const name of perPrDatabaseNamesFor(token)) {
                expect(isReapablePerPrDatabase(token, name)).toBe(true);
                expect(name).toMatch(/^[a-z0-9_]+$/);
            }
        }
    });
});

describe('perPrTokenOfDatabase — the census direction', () => {
    it('names the owner of a per-PR database', () => {
        expect(perPrTokenOfDatabase('kitchensink_food_pr_73')).toBe('pr-73');
        expect(perPrTokenOfDatabase('kitchensink_recipes_pr_1')).toBe('pr-1');
    });

    it('answers null for every protected database', () => {
        for (const base of PROTECTED_DATABASES) {
            expect(perPrTokenOfDatabase(base), base).toBeNull();
        }
    });

    it('answers null for a per-stage database that is not a preview', () => {
        expect(perPrTokenOfDatabase('kitchensink_recipes_dev')).toBeNull();
        expect(perPrTokenOfDatabase('kitchensink_food_pr_x')).toBeNull();
        expect(perPrTokenOfDatabase('kitchensink_billing_pr_1')).toBeNull();
    });

    it('⛔ AGREES with the drop verdict, over every base × token × neighbour combination', () => {
        // The two directions are separate implementations on purpose (one is a denylist + allowlist verdict,
        // the other a parse), so the invariant that keeps them from drifting is asserted rather than assumed:
        // a database is reapable for a token IFF the census says that token owns it.
        const tokens = ['pr-0', 'pr-1', 'pr-01', 'pr-15', 'pr-100', 'pr-73'];
        const names = [
            ...tokens.flatMap((token) => perPrDatabaseNamesFor(token)),
            ...PROTECTED_DATABASES,
            'kitchensink_recipes_dev',
            'kitchensink_food_pr_73_backup',
            'kitchensink_billing_pr_1',
        ];

        for (const token of tokens) {
            for (const name of names) {
                expect(isReapablePerPrDatabase(token, name), `${token} / ${name}`).toBe(
                    perPrTokenOfDatabase(name) === token,
                );
            }
        }
    });
});

describe('the base register is keyed by the derivation each base comes from', () => {
    it('maps every producing function to the base it produces', () => {
        // Keyed by the `*DatabaseNameForStage` function name so `perPrDatabaseDropDoors.test.ts` can compare
        // this register against the functions DISCOVERED in the infra tree — a third service's per-PR
        // database cannot be silently unreapable.
        expect(PER_PR_DATABASE_BASE_BY_PRODUCER).toEqual({
            foodDatabaseNameForStage: 'kitchensink_food',
            recipeDatabaseNameForStage: 'kitchensink_recipes',
        });
        expect([...PER_PR_DATABASE_BASES].sort()).toEqual(
            [...new Set(Object.values(PER_PR_DATABASE_BASE_BY_PRODUCER))].sort(),
        );
    });
});
