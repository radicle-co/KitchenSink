/**
 * Unit coverage for the DB bootstrap POSTCONDITION check — the guard that turns "CloudFormation said
 * CREATE_COMPLETE" into actual proof that the role and database exist.
 *
 * ## Why this exists
 *
 * The bootstrap custom resources shipped for four weeks as a 101-byte placeholder that returned success
 * without touching the database. CloudFormation recorded CREATE_COMPLETE, so every signal said the
 * `food_app` role had been provisioned; it had not, and the first food migration in prod failed with
 * `password authentication failed for user "food_app"` — weeks later, in a different service.
 *
 * The placeholder is now loud, but that only closes the one route to a silent no-op. This check closes the
 * class: after the DDL runs, the handler READS BACK what it just claimed to create and throws if any
 * postcondition is missing. A bootstrap that cannot prove its own effect is a failed bootstrap.
 *
 * That is also what makes the provisioning REPRODUCIBLE. Before this, "does sandbox's `recipe_app` come from
 * this code?" was unanswerable — the roles existed, the handler was a stub, and their provenance was a
 * guess. With the read-back, every deploy of every stage either proves the roles came from here or fails.
 *
 * Each postcondition maps 1:1 onto a statement `bootstrap()` issues, so a statement that silently stops
 * taking effect (a permissions change, a Postgres upgrade, a typo'd role name) fails the deploy that
 * introduced it rather than a migration weeks downstream.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';

import { assertBootstrapPostconditions, isBootstrapPostconditionError } from '../src/db-bootstrap/postconditions.js';

interface CatalogState {
    /** The role row, or `undefined` when no such role exists. */
    readonly role?: { readonly rolcanlogin: boolean; readonly rolcreatedb: boolean };
    /** Whether the role is a member of `rds_iam`. */
    readonly inRdsIam?: boolean;
    /** Whether the base database exists. */
    readonly databaseExists?: boolean;
}

/**
 * Fake pool that answers each catalog probe from `state`, routed on the catalog the query names.
 *
 * Routing on catalog name rather than call order matters: it keeps these tests from silently passing if the
 * implementation reorders its probes, and it makes an unrecognized query an explicit failure instead of a
 * default-shaped empty result that would look like "postcondition absent".
 */
function fakePool(state: CatalogState): pg.Pool {
    const query = vi.fn((text: string) => {
        if (text.includes('pg_auth_members')) {
            return Promise.resolve({
                rowCount: state.inRdsIam === true ? 1 : 0,
                rows: state.inRdsIam === true ? [{}] : [],
            });
        }

        if (text.includes('pg_database')) {
            return Promise.resolve({
                rowCount: state.databaseExists === true ? 1 : 0,
                rows: state.databaseExists === true ? [{}] : [],
            });
        }

        if (text.includes('pg_roles')) {
            const rows = state.role === undefined ? [] : [state.role];

            return Promise.resolve({ rowCount: rows.length, rows });
        }

        throw new Error(`fakePool received an unrecognized query: ${text}`);
    });

    return { query } as unknown as pg.Pool;
}

/** Every postcondition satisfied, for a non-prod stage (which additionally requires CREATEDB). */
const HEALTHY: CatalogState = {
    role: { rolcanlogin: true, rolcreatedb: true },
    inRdsIam: true,
    databaseExists: true,
};

describe('assertBootstrapPostconditions', () => {
    it('resolves when the role, its rds_iam membership, and the database all exist', async () => {
        await expect(
            assertBootstrapPostconditions(fakePool(HEALTHY), {
                role: 'food_app',
                databaseName: 'kitchensink_food',
                requireCreateDb: true,
            }),
        ).resolves.toBeUndefined();
    });

    it('resolves on prod, where the role deliberately has no CREATEDB', async () => {
        // Prod has no per-PR databases, so its role must NOT carry CREATEDB (ADR-0006). Asserting CREATEDB
        // unconditionally would fail every prod deploy — the check has to track the same stage rule the DDL does.
        await expect(
            assertBootstrapPostconditions(
                fakePool({ role: { rolcanlogin: true, rolcreatedb: false }, inRdsIam: true, databaseExists: true }),
                { role: 'food_app', databaseName: 'kitchensink_food', requireCreateDb: false },
            ),
        ).resolves.toBeUndefined();
    });

    it('throws when the role does not exist — the exact placeholder-stub outcome', async () => {
        // This is the case that shipped: DDL never ran, so nothing exists. Before this check the handler
        // returned success here.
        await expect(
            assertBootstrapPostconditions(fakePool({ inRdsIam: false, databaseExists: false }), {
                role: 'recipe_app',
                databaseName: 'kitchensink_recipes',
                requireCreateDb: true,
            }),
        ).rejects.toThrow(/recipe_app.*does not exist/is);
    });

    it('throws when the role exists but cannot log in', async () => {
        await expect(
            assertBootstrapPostconditions(
                fakePool({ role: { rolcanlogin: false, rolcreatedb: true }, inRdsIam: true, databaseExists: true }),
                { role: 'food_app', databaseName: 'kitchensink_food', requireCreateDb: true },
            ),
        ).rejects.toThrow(/LOGIN/i);
    });

    it('throws when the role is not a member of rds_iam', async () => {
        // The failure mode with real teeth: the role exists, so a naive "does the role exist" check passes,
        // but without rds_iam the service authenticates by PASSWORD and its IAM token is rejected as a bad
        // password (SQLSTATE 28P01) — which reads like a credentials problem, not a provisioning one.
        await expect(
            assertBootstrapPostconditions(
                fakePool({ role: { rolcanlogin: true, rolcreatedb: true }, inRdsIam: false, databaseExists: true }),
                { role: 'food_app', databaseName: 'kitchensink_food', requireCreateDb: true },
            ),
        ).rejects.toThrow(/rds_iam/);
    });

    it('throws when the base database is missing', async () => {
        await expect(
            assertBootstrapPostconditions(fakePool({ ...HEALTHY, databaseExists: false }), {
                role: 'food_app',
                databaseName: 'kitchensink_food',
                requireCreateDb: true,
            }),
        ).rejects.toThrow(/kitchensink_food/);
    });

    it('throws when a non-prod role lacks CREATEDB, which per-PR databases need', async () => {
        await expect(
            assertBootstrapPostconditions(
                fakePool({ role: { rolcanlogin: true, rolcreatedb: false }, inRdsIam: true, databaseExists: true }),
                { role: 'recipe_app', databaseName: 'kitchensink_recipes', requireCreateDb: true },
            ),
        ).rejects.toThrow(/CREATEDB/);
    });

    it('reports EVERY unmet postcondition at once, not just the first', async () => {
        // A deploy that fails one probe at a time costs one deploy cycle per fault. When the placeholder
        // shipped, all four were unmet simultaneously — the operator should see that in one message.
        const error = await assertBootstrapPostconditions(fakePool({ inRdsIam: false, databaseExists: false }), {
            role: 'food_app',
            databaseName: 'kitchensink_food',
            requireCreateDb: true,
        }).catch((thrown: unknown) => thrown);

        expect(isBootstrapPostconditionError(error)).toBe(true);

        if (!isBootstrapPostconditionError(error)) {
            throw new Error('expected a BootstrapPostconditionError');
        }

        // Three, not two: the role is absent, the rds_iam membership is absent, and the database is absent.
        // CREATEDB is NOT additionally reported — it is a property of a role that does not exist, so
        // claiming it would be noise on top of the real fault.
        expect(error.unmet).toHaveLength(3);
        expect(error.unmet.join('; '), 'must not report CREATEDB for a nonexistent role').not.toMatch(/CREATEDB/);
        expect(error.message).toMatch(/food_app/);
        // The message has to point at the likely cause, or the next operator repeats this investigation.
        expect(error.message, 'name the placeholder, which is how this failed in prod').toMatch(/placeholder|bundle/i);
    });

    it('is identifiable by its type guard, and rejects unrelated errors', async () => {
        expect(isBootstrapPostconditionError(new Error('nope'))).toBe(false);
        expect(isBootstrapPostconditionError(undefined)).toBe(false);
        expect(isBootstrapPostconditionError({ unmet: [] })).toBe(false);
    });
});

describe('both bootstrap handlers actually run the read-back', () => {
    // The check is only worth anything if it is WIRED. A handler that stops calling it silently returns to
    // reporting success for a bootstrap that did nothing — the original defect. Asserted at the source, since
    // the handlers open a real pool and cannot be unit-invoked.
    it.each([
        ['food', 'food_app'],
        ['recipe', 'recipe_app'],
    ])('%s-db-bootstrap verifies %s after the DDL', (service, role) => {
        const source = readFileSync(
            fileURLToPath(new URL(`../src/${service}-db-bootstrap/handler.ts`, import.meta.url)),
            'utf8',
        );

        expect(source, 'must import the shared postcondition check').toMatch(
            /import \{ assertBootstrapPostconditions \} from '\.\.\/db-bootstrap\/postconditions\.js';/,
        );
        expect(source, 'must await it after bootstrap()').toMatch(/await assertBootstrapPostconditions\(pool, \{/);
        expect(source, `must verify the ${role} role`).toMatch(new RegExp(`role: '${role}'`));
        // Prod must NOT require CREATEDB (ADR-0006) — hardcoding `true` would fail every prod deploy, and
        // hardcoding `false` would stop catching a sandbox role that cannot create per-PR databases.
        expect(source, 'CREATEDB expectation must track the stage').toMatch(/requireCreateDb: !isProd,/);
    });
});
