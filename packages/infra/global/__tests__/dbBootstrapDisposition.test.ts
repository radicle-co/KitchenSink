// @vitest-environment node
/**
 * The role-split bootstrap's two pure decisions: whether the one-shot legacy recreate is ARMED for this stage, and
 * what to do with a service's base database given who owns it.
 *
 * ⛔ These are the decisions that stand between a deploy and `DROP DATABASE`. Each refusal below is a case where
 * the wrong answer destroys a database nobody meant to destroy, so every branch is pinned — including the ones that
 * look impossible.
 */
import { describe, expect, it } from 'vitest';

import { DATABASE_ROLES } from '@kitchensink/db-schema-guard';

import {
    LEGACY_RECREATE_TOKEN_PREFIX,
    decideDisposition,
    isLegacyRecreateTokenError,
    legacyOwnersOf,
    legacyRecreateArmed,
    type DispositionInput,
} from '../src/db-bootstrap/disposition.js';

const MASTER = 'identity_app';

describe('legacyRecreateArmed', () => {
    it('is not armed when no token is supplied — the default, and the state after the disarm commit', () => {
        expect(legacyRecreateArmed(undefined, 'sandbox')).toBe(false);
        expect(legacyRecreateArmed('', 'prod')).toBe(false);
    });

    it('is armed only by the token naming THIS stage', () => {
        expect(legacyRecreateArmed(`${LEGACY_RECREATE_TOKEN_PREFIX}:sandbox`, 'sandbox')).toBe(true);
        expect(legacyRecreateArmed(`${LEGACY_RECREATE_TOKEN_PREFIX}:prod`, 'prod')).toBe(true);
    });

    it("⛔ THROWS on another stage's token — a mis-wired token is a fault to surface, never a quiet 'not armed'", () => {
        let caught: unknown;

        try {
            legacyRecreateArmed(`${LEGACY_RECREATE_TOKEN_PREFIX}:sandbox`, 'prod');
        } catch (error) {
            caught = error;
        }

        expect(isLegacyRecreateTokenError(caught)).toBe(true);
        expect(String(caught)).toContain('prod');
    });

    it.each([
        'role-split-2026-09',
        'role-split-2026-09:',
        'role-split-2026-10:sandbox',
        'sandbox',
        `${LEGACY_RECREATE_TOKEN_PREFIX}:sandbox:extra`,
        ` ${LEGACY_RECREATE_TOKEN_PREFIX}:sandbox`,
    ])('throws on a malformed token %j', (token) => {
        expect(() => legacyRecreateArmed(token, 'sandbox')).toThrow(/legacy recreate/u);
    });
});

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
        armed: false,
        ...overrides,
    });

    it('absent → create, owned by the owner role', () => {
        expect(decideDisposition(base())).toEqual({ kind: 'create' });
    });

    it('owned by the owner role → ready: nothing to do, which is what makes a re-run (armed or not) a no-op', () => {
        for (const armed of [false, true]) {
            expect(decideDisposition(base({ armed, row: { owner: 'food_owner', draining: false } }))).toEqual({
                kind: 'ready',
            });
        }
    });

    it('owned by the legacy owner and ARMED → recreate', () => {
        expect(decideDisposition(base({ armed: true, row: { owner: 'food_app', draining: false } }))).toEqual({
            kind: 'recreate',
            legacyOwner: 'food_app',
        });
    });

    it('⛔ owned by the legacy owner and NOT armed → refuse: after the disarm commit a legacy stage fails loudly', () => {
        const decision = decideDisposition(base({ row: { owner: 'food_app', draining: false } }));

        expect(decision.kind).toBe('refuse');
        expect(decision.kind === 'refuse' && decision.reason).toMatch(/food_app.*not armed/su);
    });

    it('⛔ owned by anyone else → refuse, armed or not: the recreate drops only what it can name', () => {
        for (const armed of [false, true]) {
            const decision = decideDisposition(base({ armed, row: { owner: 'somebody_else', draining: false } }));

            expect(decision.kind).toBe('refuse');
            expect(decision.kind === 'refuse' && decision.reason).toContain('somebody_else');
        }
    });

    it('⛔ a database mid-DROP (datconnlimit = -2) → refuse by name, whoever owns it', () => {
        for (const owner of ['food_app', 'food_owner', MASTER]) {
            const decision = decideDisposition(base({ armed: true, row: { owner, draining: true } }));

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

        it('EMPTY → adopt, even when armed: re-owning an empty database destroys nothing, so it is preferred', () => {
            for (const armed of [false, true]) {
                expect(
                    decideDisposition(identity({ armed, empty: true, row: { owner: MASTER, draining: false } })),
                ).toEqual({ kind: 'adopt' });
            }
        });

        it('NOT empty and armed → recreate', () => {
            expect(
                decideDisposition(identity({ armed: true, empty: false, row: { owner: MASTER, draining: false } })),
            ).toEqual({ kind: 'recreate', legacyOwner: MASTER });
        });

        it('⛔ NOT empty and not armed → refuse', () => {
            expect(decideDisposition(identity({ empty: false, row: { owner: MASTER, draining: false } })).kind).toBe(
                'refuse',
            );
        });

        it('⛔ emptiness NOT MEASURED counts as not empty — an unasked question never licenses an adopt', () => {
            expect(
                decideDisposition(identity({ armed: false, empty: undefined, row: { owner: MASTER, draining: false } }))
                    .kind,
            ).toBe('refuse');
        });
    });

    it('⛔ a master-owned FOOD database is not adoptable-by-recreate: the master is not food’s legacy owner', () => {
        expect(
            decideDisposition(base({ armed: true, empty: false, row: { owner: MASTER, draining: false } })).kind,
        ).toBe('refuse');
    });
});
