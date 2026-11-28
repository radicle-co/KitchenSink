/**
 * Integration (heldPublicSave U2): the seam and the policy composed as the sheet will use them. The wrapper turns an
 * adapter's raw answer into the typed answer, and `waysOutOf` places it in the ways. A unit test of either half cannot
 * see that the checked link, and a refused link, survive the hand-off between them.
 */
import { describe, expect, it } from 'vitest';

import { failClosedRewriteWay, rewriteWay, type RewriteWayInput } from '../../src/editor/rewriteWay.js';
import { waysOutOf } from '../../src/editor/waysOut.js';

const INPUT: RewriteWayInput = { recipeId: 'rcp_1', door: 'save', cause: { kind: 'heldSource' } };
const signal = (): AbortSignal => new AbortController().signal;

async function waysFor(raw: unknown, rewrite = failClosedRewriteWay({ answer: () => Promise.resolve(raw) })) {
    const answer = await rewrite.answer(INPUT, signal());

    return waysOutOf({
        cause: INPUT.cause,
        door: INPUT.door,
        slots: 'free',
        plan: 'pro',
        subscriptionEntryPointsOn: false,
        rewrite: answer,
    }).ways;
}

describe('the production binding feeding the policy', () => {
    it('offers Discard and Make private, and no rewrite way', async () => {
        expect(await waysFor(undefined, rewriteWay)).toStrictEqual([{ kind: 'discard' }, { kind: 'makePrivate' }]);
    });
});

describe('an adapter that offers the way, through the wrapper and the policy', () => {
    const offered = { kind: 'available', wayLineKey: 'keepPublicInOwnWords' };

    it('puts the rewrite way first with the checked link', async () => {
        const ways = await waysFor({ ...offered, sourceUrl: 'https://example.com/recipe' });
        expect(ways).toStrictEqual([
            {
                kind: 'rewrite',
                wayLineKey: 'keepPublicInOwnWords',
                link: { href: 'https://example.com/recipe', host: 'example.com' },
            },
            { kind: 'discard' },
            { kind: 'makePrivate' },
        ]);
    });

    it('keeps the way and drops a refused link', async () => {
        const ways = await waysFor({ ...offered, sourceUrl: 'javascript:alert(1)' });
        expect(ways[0]).toStrictEqual({ kind: 'rewrite', wayLineKey: 'keepPublicInOwnWords' });
    });

    it('drops the way when the adapter answers outside the contract', async () => {
        expect(await waysFor({ kind: 'available', wayLineKey: 'free text' })).toStrictEqual([
            { kind: 'discard' },
            { kind: 'makePrivate' },
        ]);
    });
});
