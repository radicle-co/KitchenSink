/**
 * ⛔ THE ACCEPTANCE CRITERION for the food→recipe status crossing — a boundary that was a CAST, and was
 * wrong at the moment it was written down as safe.
 *
 * ## The defect this exists to prevent, which shipped
 *
 * `toResolutionStatus` was `return status as FoodResolutionStatus`, carrying a comment asserting the two
 * unions "are the SAME UPPER_SNAKE union by design (they mirror each other)". That was true when written.
 * Plan U9 then added `AWAITING_RETRY` to FOOD's `food_status` enum and did not touch recipe, so:
 *
 *   - food's `FoodStatus` is 6 members, recipe's `FoodResolutionStatus` is 5;
 *   - `ingredients.food_resolution_status` carries a CHECK admitting only the 5 (`0001_initial.sql`);
 *   - and because the crossing is a CAST, `tsc` reports nothing.
 *
 * The result is a check-constraint violation — a production `500` — on any ingredient whose food is
 * mid-retry. A cast is not an adapter; it is a promise that the compiler will stop checking, and this file
 * is what checks instead.
 *
 * ## Why `AWAITING_RETRY` MAPS to `PENDING` rather than widening recipe's union
 *
 * Recipe's union is a UX vocabulary, not a mirror of food's lifecycle. Its own docstring divides it into
 * "not ready yet, will transition" (`PENDING`/`UNRESOLVED`) and "terminal, offer the freeform fallback"
 * (`NOT_FOUND`/`FAILED`). `AWAITING_RETRY` means a source call failed and a retry is scheduled — food's
 * `LEGAL_PRIORS` make it a legal prior for every other state, and budget exhaustion moves it to `FAILED`.
 * So it is exactly "not ready yet, will transition": the poller must keep polling, and the badge must not
 * claim failure.
 *
 * Adopting it instead would cost a migration widening the CHECK, a `recipe-core` change, a zod change, a
 * `CONTRACT_HASH` regeneration, and new localized badge copy on BOTH platforms — to express a distinction
 * recipe's UI has no use for. That is the trade recorded here so nobody re-derives it as an oversight.
 */
import { describe, expect, it } from 'vitest';
import { foodStatusSchema, type FoodStatus } from '@kitchensink/schema-food';
import { foodResolutionStatusSchema } from '@kitchensink/recipe-core';

import { toResolutionStatus } from '../ingredients.service.js';

describe('toResolutionStatus', () => {
    it('⛔ maps EVERY status food can emit to one recipe can persist', () => {
        // The assertion that would have caught the shipped defect. It enumerates food's union from food's
        // OWN published schema rather than a local list, so food adding a seventh member reds here instead
        // of at an INSERT in production.
        for (const status of foodStatusSchema.options) {
            const mapped = toResolutionStatus(status);

            expect(
                foodResolutionStatusSchema.safeParse(mapped).success,
                `food status '${status}' mapped to '${mapped}', which recipe's CHECK constraint rejects`,
            ).toBe(true);
        }
    });

    it('carries the five shared members through unchanged', () => {
        // The identity half the original cast got right, kept explicit so a future edit cannot quietly
        // remap e.g. RESOLVED and still satisfy the test above.
        for (const status of ['PENDING', 'UNRESOLVED', 'RESOLVED', 'NOT_FOUND', 'FAILED'] as const) {
            expect(toResolutionStatus(status)).toBe(status);
        }
    });

    it('⛔ maps AWAITING_RETRY to PENDING — non-terminal, so the picker keeps polling', () => {
        // Not FAILED. A retry is scheduled and the food can still resolve; reporting failure would strand
        // the ingredient in the picker's terminal branch, which offers a freeform fallback and removal.
        // When the retry budget IS exhausted food moves the food to FAILED, and recipe sees that instead.
        expect(toResolutionStatus('AWAITING_RETRY')).toBe('PENDING');
    });

    it('⛔ never returns a terminal status for a food that can still resolve', () => {
        // The invariant behind the mapping, stated independently of the mapping. `AWAITING_RETRY` is a
        // legal prior for RESOLVED in food's own transition table, so treating it as terminal here would
        // contradict the service on the other side of the boundary.
        const terminal = ['NOT_FOUND', 'FAILED'];

        expect(terminal).not.toContain(toResolutionStatus('AWAITING_RETRY'));
        expect(terminal).not.toContain(toResolutionStatus('PENDING'));
        expect(terminal).not.toContain(toResolutionStatus('UNRESOLVED'));
    });

    it('is total over food`s published union — no status falls through to undefined', () => {
        for (const status of foodStatusSchema.options as readonly FoodStatus[]) {
            expect(toResolutionStatus(status), `no mapping for '${status}'`).toBeDefined();
        }
    });
});
