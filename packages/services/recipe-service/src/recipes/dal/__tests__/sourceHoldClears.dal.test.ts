/**
 * Unit tests for {@link SourceHoldClearsDal} over the shared fake Drizzle client (ADR-0106).
 *
 * What a fake CAN pin: the TEXT and ORDER of the statements (the record before the release, the lock before the derive) and the
 * bound parameters. What it cannot: that the walk finds the right rows or that the database accepts the order. That is
 * `tests/e2e/recipes/holdClear.e2e.test.ts`, against a real database.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RecipeDrizzle } from '../../../database/client.js';
import type { RecipeTx } from '../../../database/unitOfWork.js';
import { makeFakeDrizzle, methodsOf, type FakeDrizzle } from '../../../__testing__/makeFakeDrizzle.js';
import { SourceHoldClearsDal } from '../sourceHoldClears.dal.js';

const dialect = new PgDialect();
const ROOT = '11111111-1111-4111-8111-111111111111';
const OWNER = '01JHOLDCLEAROWNER000000001';

function rendered(argument: unknown): { text: string; params: unknown[] } {
    const { sql: text, params } = dialect.sqlToQuery(argument as SQL);

    return { text: text.replace(/\s+/g, ' ').trim(), params };
}

let control: FakeDrizzle<RecipeDrizzle>;
let dal: SourceHoldClearsDal;
const tx = (): RecipeTx => control.db as unknown as RecipeTx;
const statements = (): string[] =>
    control.calls.filter((c) => c.method === 'execute').map((c) => rendered(c.args[0]).text);

beforeEach(() => {
    control = makeFakeDrizzle<RecipeDrizzle>();
    dal = new SourceHoldClearsDal(control.db);
});

describe('SourceHoldClearsDal.lockHoldFacts', () => {
    it('reads the owner and the hold of an active recipe under FOR UPDATE', async () => {
        control.enqueue([{ ownerId: 'o', held: true }]);

        expect(await dal.lockHoldFacts(tx(), ROOT)).toEqual({ ownerId: 'o', held: true });
        expect(methodsOf(control)).toContain('for');
        expect(control.calls.find((c) => c.method === 'for')?.args).toEqual(['update']);
    });

    it('answers undefined when no active recipe has that id', async () => {
        control.enqueue([]);

        expect(await dal.lockHoldFacts(tx(), ROOT)).toBeUndefined();
    });
});

describe('SourceHoldClearsDal.readCorrectionChain', () => {
    it('walks cloned_from_id with a CYCLE clause and no depth cap, newest and nearest first', async () => {
        await dal.readCorrectionChain(ROOT);

        const [text] = statements();

        expect(text).toContain('WITH RECURSIVE chain');
        expect(text).toContain('CYCLE id SET is_cycle USING path');
        expect(text).toContain('ORDER BY c.depth ASC, k.recorded_at DESC, k.id DESC');
        expect(text).not.toMatch(/depth\s*<|LIMIT/i);
    });
});

describe('SourceHoldClearsDal.readLatestCorrectionId', () => {
    it('takes the newest row across the WHOLE chain, ordered by recorded_at then id, not the nearest node', async () => {
        await dal.readLatestCorrectionId(ROOT);

        const [text] = statements();

        expect(text).toContain('CYCLE id SET is_cycle USING path');
        expect(text).toContain('ORDER BY k.recorded_at DESC, k.id DESC');
        expect(text).toContain('LIMIT 1');
        expect(text).not.toMatch(/ORDER BY.*depth/);
    });

    it('answers null when no recipe in the chain was ever corrected', async () => {
        await expect(dal.readLatestCorrectionId(ROOT)).resolves.toBeNull();
    });
});

describe('SourceHoldClearsDal.lockOwnersDescendants', () => {
    it("locks the owner's live descendants in ascending id", async () => {
        await dal.lockOwnersDescendants(tx(), ROOT, OWNER);

        const call = rendered(control.calls[0]?.args[0]);

        expect(call.text).toContain('ORDER BY r.id FOR UPDATE');
        expect(call.text).toContain('r.deleted_at IS NULL');
        expect(call.params).toEqual([ROOT, OWNER]);
    });
});

describe('SourceHoldClearsDal.releasableDescendants', () => {
    it('stops a branch at a clone with its own correction row, and is transparent to an unheld clone', async () => {
        const out = await dal.releasableDescendants(tx(), ROOT, OWNER);
        const [text] = statements();

        expect(out).toEqual([]);
        expect(text).toContain('NOT EXISTS (SELECT 1 FROM recipe_source_corrections k WHERE k.recipe_id = c.id)');
        expect(text).toContain('NOT c.source_correction_hold OR (c.owner_id =');
        expect(text).toContain('r.id <>');
    });
});

describe('SourceHoldClearsDal.recordClears and releaseHolds', () => {
    it('writes the record, and names neither xact_id nor recorded_at (the trigger owns them)', async () => {
        await dal.recordClears(tx(), { recipeIds: [ROOT], cause: 'staff', actorAccountId: 'staff01', reason: 'why' });

        const call = rendered(control.calls[0]?.args[0]);

        expect(call.text).toContain(
            'INSERT INTO recipe_source_hold_clears (recipe_id, cause, actor_account_id, reason)',
        );
        expect(call.text).not.toContain('xact_id');
        expect(call.text).not.toContain('recorded_at');
        expect(call.params).toContain('why');
    });

    it('does nothing for an empty id list', async () => {
        await dal.recordClears(tx(), { recipeIds: [], cause: 'staff', actorAccountId: 'staff01', reason: 'why' });
        await dal.releaseHolds(tx(), []);

        expect(control.calls).toEqual([]);
    });

    it('releases by id and bumps updated_at, and never touches visibility', async () => {
        await dal.releaseHolds(tx(), [ROOT]);

        const call = rendered(control.calls[0]?.args[0]);

        expect(call.text).toContain('UPDATE recipes SET source_correction_hold = false, updated_at = now()');
        expect(call.text).not.toContain('visibility');
    });
});
