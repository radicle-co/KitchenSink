// @vitest-environment node
/**
 * The reaper's request parsing, census and plan — and the RE-ASSERTION at the point of destruction.
 *
 * ## What this file is protecting
 *
 * `PerPrDatabaseReaperFunction` (ADR-0031) is master-connected and issues `DROP DATABASE`. Its scope
 * predicate has its own suite (`perPrDatabaseScope.test.ts`); this one covers everything AROUND the
 * predicate, where a destructive capability is just as easy to get wrong:
 *
 *  - **The default action is `count`.** An empty payload — the shape a mis-wired caller, a retry with no
 *    body, or a hand-typed `aws lambda invoke` produces — must COUNT, never drop. A default of `drop` is one
 *    keystroke away from reaping whatever token happened to be in scope.
 *  - **`drop` without a token is a refusal, not a no-op**, and a malformed token is a refusal too. Both fail
 *    loudly rather than silently doing nothing, so a broken teardown is visible.
 *  - **Counting drops nothing.** Asserted by executing the real code against a fake pool and reading the
 *    statements it issued — an assertion on the RESULT would pass for a function that dropped and then
 *    reported a census.
 *  - **The plan is re-asserted at the destruction site.** {@link executeReap} re-runs the scope verdict on
 *    every name immediately before quoting it into SQL, and refuses a poisoned plan. This is the same
 *    belt-and-braces `teardown-sandbox-pr.sh` applies to GitHub Environments, and it is tested by handing
 *    `executeReap` a plan that the predicate would never have produced.
 *  - **`prod` is refused at RUNTIME**, even though the function is not deployed there.
 *
 * ## Why a fake pool rather than a mocked module
 *
 * The statements issued ARE the assertion surface — the same reasoning `ecsQuiesce.integration.test.ts` and
 * the teardown suite give for asserting on a call log. A test that checked only the returned object would
 * pass a reaper that dropped the base database and reported success. The real database behaviour (that
 * `DROP DATABASE … WITH (FORCE)` drops, that an absent name is a no-op, that the base survives) is a
 * boundary a fake cannot answer, and lives in `tests/perPrDatabaseReaper.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import type pg from 'pg';

import {
    ReapRequestError,
    censusOfPerPrDatabases,
    isReapRequestError,
    parseReapRequest,
    planReap,
    type PerPrDatabaseCatalogRow,
} from '../src/db-reaper/reapPlan.js';
import { executeReap, handler, reapDropStatement } from '../src/db-reaper/handler.js';

/** A catalogue as the shared sandbox instance might report it, with two PRs and one stranded neighbour. */
const CATALOG: readonly PerPrDatabaseCatalogRow[] = [
    { datname: 'kitchensink_food_pr_73', datconnlimit: -1 },
    { datname: 'kitchensink_recipes_pr_73', datconnlimit: -1 },
    { datname: 'kitchensink_food_pr_91', datconnlimit: -1 },
    { datname: 'kitchensink_recipes_pr_15', datconnlimit: -2 },
    { datname: 'kitchensink_recipes_dev', datconnlimit: -1 },
];

/** A `pg.Pool` stand-in that records every statement and answers nothing. */
function fakePool(): { pool: pg.Pool; statements: string[] } {
    const statements: string[] = [];
    const query = vi.fn(async (text: string) => {
        statements.push(text);

        return { rows: [], rowCount: 0 };
    });

    return { pool: { query } as unknown as pg.Pool, statements };
}

describe('parseReapRequest — the payload is a wire boundary', () => {
    it('defaults to COUNT, so an empty or absent payload can never drop anything', () => {
        // ⛔ The single most important default in this module. `aws lambda invoke` with no payload, a retry
        // that lost its body, a caller that forgot the action — all of them must count.
        expect(parseReapRequest({})).toEqual({ action: 'count' });
        expect(parseReapRequest(undefined)).toEqual({ action: 'count' });
        expect(parseReapRequest(null)).toEqual({ action: 'count' });
    });

    it('accepts a well-formed drop request', () => {
        expect(parseReapRequest({ action: 'drop', pr: 'pr-73' })).toEqual({ action: 'drop', pr: 'pr-73' });
    });

    it('REFUSES a drop with no token', () => {
        expect(() => parseReapRequest({ action: 'drop' })).toThrow(ReapRequestError);
    });

    it.each(['pr-', 'PR-1', 'pr-1a', '*', '', 'sandbox', 'pr-1;DROP DATABASE kitchensink_identity'])(
        'REFUSES a drop with the malformed token %j',
        (pr) => {
            expect(() => parseReapRequest({ action: 'drop', pr })).toThrow(ReapRequestError);
        },
    );

    it('REFUSES an unknown action rather than falling back to a default', () => {
        // A typo (`{"action":"dropall"}`) must not silently become a census either — a caller that asked for
        // something this function does not implement got no answer, and should be told.
        for (const action of ['dropall', 'DROP', 'reap', 'count ', 1, true, {}]) {
            expect(() => parseReapRequest({ action })).toThrow(ReapRequestError);
        }
    });

    it('REFUSES a `pr` on a count request, because it would read as a scoped count that it is not', () => {
        expect(() => parseReapRequest({ action: 'count', pr: 'pr-73' })).toThrow(ReapRequestError);
    });

    it('carries a type guard, per the repository error convention', () => {
        try {
            parseReapRequest({ action: 'drop' });
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(isReapRequestError(error)).toBe(true);
        }

        expect(isReapRequestError(new Error('other'))).toBe(false);
    });
});

describe('censusOfPerPrDatabases — the count that needs no token', () => {
    it('groups every per-PR database under the PR that owns it', () => {
        expect(censusOfPerPrDatabases(CATALOG).byToken).toEqual({
            'pr-15': ['kitchensink_recipes_pr_15'],
            'pr-73': ['kitchensink_food_pr_73', 'kitchensink_recipes_pr_73'],
            'pr-91': ['kitchensink_food_pr_91'],
        });
    });

    it('counts databases, not PRs — the number the pg18 runbook asks for is objects', () => {
        expect(censusOfPerPrDatabases(CATALOG).total).toBe(4);
    });

    it('splits out the ones PostgreSQL is ALREADY dropping (datconnlimit = -2)', () => {
        // The pg18 runbook §A3 halts an upgrade precheck on these, and reporting one as an ordinary leak
        // sends an operator to drop a database that is already going away. Same split
        // `summarizePerPrDatabases` makes, for the same reason.
        expect(censusOfPerPrDatabases(CATALOG).draining).toEqual(['kitchensink_recipes_pr_15']);
    });

    it('reports a suffixed database it does NOT claim, rather than hiding it', () => {
        // `kitchensink_recipes_dev` is a real per-stage database that belongs to no PR. Silence here would
        // make the census read as "everything on this instance is accounted for", which it is not.
        expect(censusOfPerPrDatabases(CATALOG).unrecognized).toEqual(['kitchensink_recipes_dev']);
    });

    it('sorts every list, so two runs are diffable', () => {
        const census = censusOfPerPrDatabases([...CATALOG].reverse());

        expect(census.byToken['pr-73']).toEqual(['kitchensink_food_pr_73', 'kitchensink_recipes_pr_73']);
    });

    it('answers an empty census on an empty catalogue', () => {
        expect(censusOfPerPrDatabases([])).toEqual({ total: 0, byToken: {}, draining: [], unrecognized: [] });
    });
});

describe('planReap — what will actually be dropped', () => {
    it('plans NOTHING for a count', () => {
        expect(planReap(CATALOG, { action: 'count' }).drop).toEqual([]);
    });

    it("plans exactly the token's own databases", () => {
        expect(planReap(CATALOG, { action: 'drop', pr: 'pr-73' }).drop).toEqual([
            'kitchensink_food_pr_73',
            'kitchensink_recipes_pr_73',
        ]);
    });

    it('⛔ plans nothing belonging to a NEIGHBOURING pr number', () => {
        // pr-1 exists nowhere in the catalogue; pr-15 and pr-91 do. A prefix rule would claim them.
        expect(planReap(CATALOG, { action: 'drop', pr: 'pr-1' }).drop).toEqual([]);
        expect(planReap(CATALOG, { action: 'drop', pr: 'pr-9' }).drop).toEqual([]);
    });

    it('⛔ never plans a base, a system database or another stage', () => {
        const noisy: readonly PerPrDatabaseCatalogRow[] = [
            ...CATALOG,
            { datname: 'kitchensink_identity', datconnlimit: -1 },
            { datname: 'kitchensink_food', datconnlimit: -1 },
            { datname: 'kitchensink_recipes', datconnlimit: -1 },
            { datname: 'postgres', datconnlimit: -1 },
            { datname: 'template1', datconnlimit: -1 },
        ];

        for (const token of ['pr-0', 'pr-1', 'pr-15', 'pr-73', 'pr-91']) {
            for (const planned of planReap(noisy, { action: 'drop', pr: token }).drop) {
                expect(planned).toMatch(/^kitchensink_(?:food|recipes)_pr_[0-9]+$/);
            }
        }
    });

    it('reports the names the PR could own but does NOT, so a partial teardown is visible', () => {
        // pr-91 has a food database and no recipe one — a web-or-food-only PR, or a recipe deploy that
        // failed. Saying so distinguishes "already reclaimed" from "never existed" for an operator.
        expect(planReap(CATALOG, { action: 'drop', pr: 'pr-91' })).toMatchObject({
            drop: ['kitchensink_food_pr_91'],
            absent: ['kitchensink_recipes_pr_91'],
        });
    });

    it('carries the full census alongside the plan, so one invocation answers both questions', () => {
        expect(planReap(CATALOG, { action: 'drop', pr: 'pr-73' }).census.total).toBe(4);
    });
});

describe('reapDropStatement — the only place an identifier is quoted into SQL', () => {
    it('uses IF EXISTS and FORCE, because a preview leaves sessions behind', () => {
        expect(reapDropStatement('kitchensink_food_pr_73')).toBe(
            'DROP DATABASE IF EXISTS "kitchensink_food_pr_73" WITH (FORCE)',
        );
    });
});

describe('executeReap — the re-assertion at the point of destruction', () => {
    it('issues one DROP per planned database, and nothing else', async () => {
        const { pool, statements } = fakePool();

        await executeReap(pool, planReap(CATALOG, { action: 'drop', pr: 'pr-73' }), { action: 'drop', pr: 'pr-73' });

        expect(statements).toEqual([
            'DROP DATABASE IF EXISTS "kitchensink_food_pr_73" WITH (FORCE)',
            'DROP DATABASE IF EXISTS "kitchensink_recipes_pr_73" WITH (FORCE)',
        ]);
    });

    it('⛔ COUNTING ISSUES NO STATEMENT AT ALL', async () => {
        // Asserted on the statements, not the result: a reaper that dropped and then reported a census
        // would satisfy any assertion about the returned object.
        const { pool, statements } = fakePool();

        await executeReap(pool, planReap(CATALOG, { action: 'count' }), { action: 'count' });

        expect(statements).toEqual([]);
    });

    it('⛔ REFUSES a plan the scope predicate could not have produced, and drops nothing before it', async () => {
        // The poisoned plan: the base database, smuggled in behind a valid token. `planReap` cannot produce
        // this — reaching it means the predicate regressed, and that must fail loudly rather than proceed.
        // The base is FIRST so a refusal that came after the loop had begun would still have dropped it.
        const { pool, statements } = fakePool();
        const poisoned = {
            census: censusOfPerPrDatabases(CATALOG),
            drop: ['kitchensink_identity', 'kitchensink_food_pr_73'],
            absent: [],
        };

        await expect(executeReap(pool, poisoned, { action: 'drop', pr: 'pr-73' })).rejects.toThrow(
            /scope predicate let it through/i,
        );
        expect(statements).toEqual([]);
    });

    it('⛔ REFUSES a plan naming ANOTHER pr’s database', async () => {
        const { pool, statements } = fakePool();
        const poisoned = { census: censusOfPerPrDatabases(CATALOG), drop: ['kitchensink_food_pr_91'], absent: [] };

        await expect(executeReap(pool, poisoned, { action: 'drop', pr: 'pr-73' })).rejects.toThrow(
            /scope predicate let it through/i,
        );
        expect(statements).toEqual([]);
    });
});

describe('⛔ the handler REFUSES the prod stage at runtime, whatever it was asked to do', () => {
    // ⛔ The second half of "sandbox only", and the half that is not a synth-time property. `DataStack` does
    // not create this function at the prod stage, so reaching the handler on prod means something deployed
    // it there — and a master-credentialed `DROP DATABASE` in production is not a risk this repository
    // accepts. Asserted here because a guard nobody exercises is a comment.
    //
    // The refusal is the FIRST thing the handler does, before the payload is parsed and before any AWS
    // client is constructed, which is why these cases need no Secrets Manager or `pg` stub at all — and
    // that ordering is itself the assertion: a refusal placed after `readMasterCredentials` would fetch the
    // master password on prod before deciding not to use it.
    const withStage = async (stage: string | undefined, event: unknown): Promise<unknown> => {
        const previous = process.env['STAGE'];

        if (stage === undefined) {
            delete process.env['STAGE'];
        } else {
            process.env['STAGE'] = stage;
        }

        try {
            return await handler(event);
        } finally {
            if (previous === undefined) {
                delete process.env['STAGE'];
            } else {
                process.env['STAGE'] = previous;
            }
        }
    };

    it('refuses a DROP on prod', async () => {
        await expect(withStage('prod', { action: 'drop', pr: 'pr-73' })).rejects.toThrow(
            /refuses to run at the prod stage/i,
        );
    });

    it('⛔ refuses a COUNT on prod too, not just a drop', async () => {
        // Deliberately NOT a drop-only guard. Leaving a prod census reachable makes the drop guard the only
        // thing standing, and "just let it count in prod" is exactly how that erodes.
        await expect(withStage('prod', { action: 'count' })).rejects.toThrow(/refuses to run at the prod stage/i);
        await expect(withStage('prod', {})).rejects.toThrow(/refuses to run at the prod stage/i);
    });

    it('refuses before it reads ANY other configuration — no secret ARN, no endpoint', async () => {
        // None of DB_SECRET_ARN / DB_ENDPOINT / DB_PORT is set in this process. A handler that read them
        // first would fail with "Missing required environment variable" instead, which is a different
        // (and much later) refusal.
        await expect(withStage('prod', { action: 'drop', pr: 'pr-73' })).rejects.toThrow(/ADR-0031/);
    });

    it('fails loudly when STAGE is unset rather than assuming a stage', async () => {
        // An unset STAGE is not "probably sandbox". The function cannot know which instance it is pointed
        // at, and guessing is how a capability ends up running somewhere nobody chose.
        await expect(withStage(undefined, {})).rejects.toThrow(/Missing required environment variable: STAGE/);
    });
});
