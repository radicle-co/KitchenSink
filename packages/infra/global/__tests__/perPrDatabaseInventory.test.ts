// @vitest-environment node
/**
 * The per-PR logical-database CENSUS — the only thing in this repository that can currently answer
 * "how many stale `pr-{N}` databases are on the shared instance?"
 *
 * ## Why a census, and why it lives in the bootstrap
 *
 * ADR-0006 gives each preview its own LOGICAL database on the shared instance
 * (`kitchensink_food_pr_{N}`, `kitchensink_recipes_pr_{N}`). ADR-0005's teardown is supposed to drop it,
 * and for half of them it never did: `teardown-sandbox-pr.sh` hardcoded food's migration-runner output, so
 * every reaped recipe preview left `kitchensink_recipes_pr_{N}` behind. Nothing noticed, because a leaked
 * logical database emits no signal at all — the same shape as the DELETE_FAILED stacks and the dangling
 * CNAMEs, and invisible for the same reason.
 *
 * `docs/runbooks/pg18-upgrade.md` §A4 asks an operator to run this exact query by hand before a major
 * upgrade, because the dump-and-restore window scales with the number of databases and objects. There has
 * never been a mechanism that runs it.
 *
 * The two DB bootstrap Lambdas are the ONLY code in the system that connects as the MASTER user, is already
 * VPC-attached (ADR-0004), already reads `pg_database`, and runs on every `DataStack` deploy. So the census
 * is emitted from there: no new function, no new IAM, no new NAT consumer, no ADR-0004 amendment.
 *
 * ## What is asserted, and why each direction matters
 *
 * 1. **The LIKE pattern is anchored to the base name and escapes its own underscores.** `_` is a
 *    single-character wildcard in SQL LIKE, so an unescaped `kitchensink_food_%` also matches
 *    `kitchensinkXfoodY…`. Escaping is the difference between a census and a guess.
 * 2. **The base database itself is never counted.** The census reports what teardown should have removed;
 *    including the shared base would report a permanent leak on every deploy and train the reader to ignore
 *    the number.
 * 3. **A census failure NEVER fails the bootstrap.** This is observability bolted to a resource whose job is
 *    provisioning. If the query throws — a catalogue change, a database mid-drop, a permission shift — the
 *    deploy must still succeed on its own merits. Reporting is not a postcondition, and turning it into one
 *    would mean an unrelated read could block every `DataStack` deploy.
 *
 * DESIGN PATTERN: pure formatter + thin impure reader — {@link perPrLikePattern} and
 * {@link summarizePerPrDatabases} are total functions over their inputs, so the interesting cases are fired
 * at them directly rather than through a fake pool.
 */
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { perPrLikePattern, reportPerPrDatabases, summarizePerPrDatabases } from '../src/db-bootstrap/perPrInventory.js';

describe('perPrLikePattern', () => {
    it('matches the per-PR suffix shape and nothing else', () => {
        expect(perPrLikePattern('kitchensink_food')).toBe('kitchensink\\_food\\_%');
    });

    it('escapes every LIKE metacharacter in the base name, not only the underscore', () => {
        // Not reachable from today's two base names, and that is the point: the escape must be a property of
        // the function, not a coincidence of its current callers. A base name acquiring a `%` later must not
        // silently widen the census to the whole catalogue.
        expect(perPrLikePattern('a_b%c\\d')).toBe('a\\_b\\%c\\\\d\\_%');
    });
});

describe('summarizePerPrDatabases', () => {
    it('counts the per-PR databases and names them, sorted', () => {
        const summary = summarizePerPrDatabases('kitchensink_food', [
            { datname: 'kitchensink_food_pr_91', datconnlimit: -1 },
            { datname: 'kitchensink_food_pr_7', datconnlimit: -1 },
        ]);

        expect(summary.count).toBe(2);
        expect(summary.databases).toEqual(['kitchensink_food_pr_7', 'kitchensink_food_pr_91']);
        expect(summary.base).toBe('kitchensink_food');
    });

    it('reports zero without inventing a database when nothing leaked', () => {
        const summary = summarizePerPrDatabases('kitchensink_recipes', []);

        expect(summary.count).toBe(0);
        expect(summary.databases).toEqual([]);
        expect(summary.draining).toEqual([]);
    });

    it('separates a database already being dropped from a live leak', () => {
        // `datconnlimit = -2` is PostgreSQL's marker for a database mid-DROP. The pg18 runbook (§A3) makes
        // an operator hunt for exactly these, because they HALT an upgrade precheck. Counting one as an
        // ordinary leak would send someone to drop a database that is already going away.
        const summary = summarizePerPrDatabases('kitchensink_food', [
            { datname: 'kitchensink_food_pr_1', datconnlimit: -1 },
            { datname: 'kitchensink_food_pr_2', datconnlimit: -2 },
        ]);

        expect(summary.count).toBe(2);
        expect(summary.draining).toEqual(['kitchensink_food_pr_2']);
    });
});

/** A pool that answers the census query with `rows`, or rejects with `failWith` when given. */
function censusPool(rows: readonly unknown[], failWith?: Error): pg.Pool {
    const query = vi.fn(() =>
        failWith === undefined ? Promise.resolve({ rowCount: rows.length, rows }) : Promise.reject(failWith),
    );

    return { query } as unknown as pg.Pool;
}

describe('reportPerPrDatabases', () => {
    it('emits ONE structured line naming the leaked databases', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await reportPerPrDatabases(
                censusPool([{ datname: 'kitchensink_food_pr_91', datconnlimit: -1 }]),
                'kitchensink_food',
            );

            expect(log).toHaveBeenCalledTimes(1);
            const emitted = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>;

            expect(emitted['count']).toBe(1);
            expect(emitted['databases']).toEqual(['kitchensink_food_pr_91']);
        } finally {
            log.mockRestore();
        }
    });

    it('parameterises the pattern rather than splicing the base name into the SQL', async () => {
        const pool = censusPool([]);
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            await reportPerPrDatabases(pool, 'kitchensink_food');

            const [text, values] = (pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
                string,
                readonly string[],
            ];

            expect(text).not.toContain('kitchensink_food');
            expect(values).toEqual(['kitchensink\\_food\\_%']);
            // Without an explicit ESCAPE clause PostgreSQL still defaults to backslash, but a default is a
            // setting-shaped assumption and this pattern is the census's whole basis. State it.
            expect(text).toContain("ESCAPE '\\'");
        } finally {
            log.mockRestore();
        }
    });

    it('SWALLOWS a query failure — a census is not a postcondition', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        try {
            await expect(
                reportPerPrDatabases(
                    censusPool([], new Error('relation "pg_database" does not exist')),
                    'kitchensink_food',
                ),
            ).resolves.toBeUndefined();

            expect(warn).toHaveBeenCalledTimes(1);
            expect(String(warn.mock.calls[0]?.[0])).toContain('pg_database');
        } finally {
            warn.mockRestore();
        }
    });
});
