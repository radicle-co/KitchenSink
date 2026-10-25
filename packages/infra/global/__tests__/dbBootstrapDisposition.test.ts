// @vitest-environment node
/**
 * The role-split bootstrap's pure decision: what to do with a service's base database given who owns it.
 *
 * ⛔ This is the decision that stands between a deploy and a database nobody meant to touch. ADR-0039's one-shot
 * legacy recreate ran on sandbox and prod and the disarm commit deleted it, so no ownership state leads to a drop: a
 * database still on its pre-role-split owner is REFUSED, and the deploy fails loudly. Every branch is pinned,
 * including the ones that look impossible.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import { decideDisposition, legacyOwnersOf, type DispositionInput } from '../src/db-bootstrap/disposition.js';

const MASTER = 'identity_app';

describe('legacyOwnersOf', () => {
    it('identity: the master created it (RDS `databaseName`), so the master is its legacy owner', () => {
        expect(legacyOwnersOf('identity', DATABASE_ROLES.identity, MASTER)).toEqual([MASTER]);
    });

    it('food and recipe: their old single role owned them — the same name the service role keeps', () => {
        expect(legacyOwnersOf('food', DATABASE_ROLES.food, MASTER)).toEqual(['food_app']);
        expect(legacyOwnersOf('recipe', DATABASE_ROLES.recipe, MASTER)).toEqual(['recipe_app']);
    });
});

describe('decideDisposition', () => {
    const base = (overrides: Partial<DispositionInput> = {}): DispositionInput => ({
        service: 'food',
        roles: DATABASE_ROLES.food,
        master: MASTER,
        database: 'kitchensink_food',
        row: undefined,
        empty: undefined,
        ...overrides,
    });

    it('absent → create, owned by the owner role', () => {
        expect(decideDisposition(base())).toEqual({ kind: 'create' });
    });

    it('owned by the owner role → ready: nothing to do, which is what makes a re-run a no-op', () => {
        expect(decideDisposition(base({ row: { owner: 'food_owner', draining: false } }))).toEqual({ kind: 'ready' });
    });

    it('⛔ owned by the legacy owner → refuse: the recreate is gone, so a legacy stage fails loudly', () => {
        const decision = decideDisposition(base({ row: { owner: 'food_app', draining: false } }));

        expect(decision.kind).toBe('refuse');
        expect(decision.kind === 'refuse' && decision.reason).toMatch(/food_app.*before the role split/su);
    });

    it('⛔ owned by anyone else → refuse, naming the owner', () => {
        const decision = decideDisposition(base({ row: { owner: 'somebody_else', draining: false } }));

        expect(decision.kind).toBe('refuse');
        expect(decision.kind === 'refuse' && decision.reason).toContain('somebody_else');
    });

    it('⛔ a database mid-DROP (datconnlimit = -2) → refuse by name, whoever owns it', () => {
        for (const owner of ['food_app', 'food_owner', MASTER]) {
            const decision = decideDisposition(base({ row: { owner, draining: true } }));

            expect(decision.kind).toBe('refuse');
            expect(decision.kind === 'refuse' && decision.reason).toMatch(/kitchensink_food.*-2/su);
        }
    });

    describe('identity — master-owned', () => {
        const identity = (overrides: Partial<DispositionInput>): DispositionInput =>
            base({
                service: 'identity',
                roles: DATABASE_ROLES.identity,
                database: 'kitchensink_identity',
                ...overrides,
            });

        it('EMPTY → adopt: re-owning an empty database destroys nothing', () => {
            expect(decideDisposition(identity({ empty: true, row: { owner: MASTER, draining: false } }))).toEqual({
                kind: 'adopt',
            });
        });

        it('⛔ NOT empty → refuse as legacy-owned', () => {
            const decision = decideDisposition(identity({ empty: false, row: { owner: MASTER, draining: false } }));

            expect(decision.kind).toBe('refuse');
            expect(decision.kind === 'refuse' && decision.reason).toMatch(/identity_app.*before the role split/su);
        });

        it('⛔ emptiness NOT MEASURED counts as not empty — an unasked question never licenses an adopt', () => {
            expect(
                decideDisposition(identity({ empty: undefined, row: { owner: MASTER, draining: false } })).kind,
            ).toBe('refuse');
        });
    });

    it('⛔ a non-empty master-owned FOOD database → refuse: the master is not food’s legacy owner', () => {
        const decision = decideDisposition(base({ empty: false, row: { owner: MASTER, draining: false } }));

        expect(decision.kind).toBe('refuse');
        expect(decision.kind === 'refuse' && decision.reason).toMatch(/neither food_owner nor a legacy owner/u);
    });
});
