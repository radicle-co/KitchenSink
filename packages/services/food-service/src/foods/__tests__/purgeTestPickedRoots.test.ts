/**
 * The picked-root half of the test purge (ADR-0040; owner ruling 2026-10-16), over a fake attribution table: it asks the
 * DAO for the caller's attributed roots, lets the policy choose, and deletes exactly the chosen ones. The rule's own
 * truth table is `domain/__tests__/testPickedRootPolicy.test.ts`; the SQL is `tests/e2e/testPickedRoots.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { AttributedRoot } from '../dao/testPickedRoot.dao.js';
import { purgeTestPickedRoots } from '../purgeTestPickedRoots.js';

const POOL_ULID = '01J9ZK8N7QF3B2X4M6T0V5C3AA';

/** An attributed root that is deletable unless a case changes it. */
function rootOf(foodId: string, facts: Partial<AttributedRoot['facts']> = {}): AttributedRoot {
    return {
        foodId,
        facts: {
            createdBy: POOL_ULID,
            heldByRealUser: false,
            authorId: null,
            seedOwned: false,
            hasVariants: false,
            forwardTarget: false,
            status: 'RESOLVED',
            ...facts,
        },
    };
}

/** A fake DAO that answers the given roots and records what it was asked to delete. */
function fakeDao(roots: readonly AttributedRoot[]): {
    readonly dao: Parameters<typeof purgeTestPickedRoots>[0];
    readonly asked: string[];
    readonly deleted: AttributedRoot[][];
} {
    const asked: string[] = [];
    const deleted: AttributedRoot[][] = [];

    return {
        asked,
        deleted,
        dao: {
            lockCreatedBy: async (createdBy) => {
                asked.push(createdBy);

                return [...roots];
            },
            deleteRoots: async (chosen) => {
                deleted.push([...chosen]);

                return chosen.length;
            },
        },
    };
}

describe('purgeTestPickedRoots', () => {
    it("asks for the caller's own attributed roots, and deletes the ones the rule chooses", async () => {
        const { dao, asked, deleted } = fakeDao([rootOf('R-mine')]);

        await expect(purgeTestPickedRoots(dao, POOL_ULID)).resolves.toBe(1);
        expect(asked).toStrictEqual([POOL_ULID]);
        expect(deleted.map((chosen) => chosen.map((root) => root.foodId))).toStrictEqual([['R-mine']]);
    });

    it('⛔ keeps a root a real cook holds, a seed-owned root, an authored food and a root with variants and a forward target', async () => {
        const { dao, deleted } = fakeDao([
            rootOf('R-mine'),
            rootOf('R-held', { heldByRealUser: true }),
            rootOf('R-seed', { seedOwned: true }),
            rootOf('R-authored', { authorId: POOL_ULID }),
            rootOf('R-variants', { hasVariants: true }),
            rootOf('R-forwarded', { forwardTarget: true }),
            rootOf('R-deleting', { status: 'DELETING' }),
        ]);

        await expect(purgeTestPickedRoots(dao, POOL_ULID)).resolves.toBe(1);
        expect(deleted.map((chosen) => chosen.map((root) => root.foodId))).toStrictEqual([['R-mine']]);
    });

    it('never deletes a root another test principal created, even if the DAO returned it', async () => {
        const { dao, deleted } = fakeDao([rootOf('R-theirs', { createdBy: '01J9ZK8N7QF3B2X4M6T0V5C3AC' })]);

        await expect(purgeTestPickedRoots(dao, POOL_ULID)).resolves.toBe(0);
        expect(deleted.flat()).toStrictEqual([]);
    });

    it('is idempotent: a caller with nothing attributed deletes nothing', async () => {
        const { dao } = fakeDao([]);

        await expect(purgeTestPickedRoots(dao, POOL_ULID)).resolves.toBe(0);
    });
});
