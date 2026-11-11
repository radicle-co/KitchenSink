/**
 * The bulk import's view of a cook's private slots (ADR-0073), as the live count answers it.
 *
 * The import saves every private recipe PUBLISHED, so each one uses a real slot. The port must therefore read the count the
 * recipe service keeps, never answer "always free": with a stub, a free cook at 50 would be sent through one doomed save per
 * recipe and the view would never show the pause. These tests pin the adapter over `getPrivateSlotUsage` and the ONE reading
 * of the save path's denial.
 */
import { describe, expect, it, vi } from 'vitest';

import { privateSlotsFull, publishRequirementsUnmet } from '../../recipes/recipe.error.js';
import type { PrivateSlotUsage } from '../../recipes/recipes.schema.js';
import { isPrivateSlotsFull, privateSlotsOf } from '../privateSlots.port.js';
import { makePrincipal } from '../__fixtures__/importFixtures.js';

const COOK = makePrincipal();

const answering = (usage: PrivateSlotUsage) => {
    const getPrivateSlotUsage = vi.fn(async () => usage);

    return { port: privateSlotsOf({ getPrivateSlotUsage }), getPrivateSlotUsage };
};

describe('privateSlotsOf: the live count, read as the cook', () => {
    it('asks the recipe service for THIS cook, so Pro is read from their signed token', async () => {
        const { port, getPrivateSlotUsage } = answering({ kind: 'limited', used: 3, limit: 50 });

        await port.hasAvailable(COOK);

        expect(getPrivateSlotUsage).toHaveBeenCalledWith(COOK);
    });

    it.each([
        [49, true],
        [50, false],
        [61, false],
    ])('a free cook holding %i of 50 has a slot free: %s', async (used, free) => {
        await expect(answering({ kind: 'limited', used, limit: 50 }).port.hasAvailable(COOK)).resolves.toBe(free);
    });

    it('a Pro cook always has one', async () => {
        await expect(answering({ kind: 'unlimited' }).port.hasAvailable(COOK)).resolves.toBe(true);
    });
});

describe("isPrivateSlotsFull: the save path's denial, read from the domain error", () => {
    it('is the PRIVATE_SLOTS_FULL domain error', () => {
        expect(isPrivateSlotsFull(privateSlotsFull(50, 50))).toBe(true);
    });

    it('is not another domain error, and not a look-alike that merely carries the code', () => {
        expect(isPrivateSlotsFull(publishRequirementsUnmet('needs cuisine', ['cuisine']))).toBe(false);
        expect(isPrivateSlotsFull(Object.assign(new Error('full'), { code: 'PRIVATE_SLOTS_FULL' }))).toBe(false);
    });
});
