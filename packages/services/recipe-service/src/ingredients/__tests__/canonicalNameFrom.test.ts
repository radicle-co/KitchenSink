/**
 * ⛔ THE ACCEPTANCE CRITERION for U3's naming decision — "may this status rename a row every user sees?"
 *
 * ## Why this is a function and not an `if` at the call site
 *
 * The `ingredients` table is ownerless and shared, so the display name a row carries is global state. The
 * question of whether a status result licenses overwriting it is a POLICY with four independent ways to
 * answer "no", and two call sites ask it (`refreshStatus` polls; `addByFoodId` admits). Inlined, each site
 * would carry its own copy of the four guards and they would drift.
 *
 * ## The four ways a `RESOLVED` status still carries no usable name
 *
 * The wire contract permits all four, and `ingredients.name` is `NOT NULL`:
 *
 *  1. the status is not `RESOLVED` at all — a `PENDING` food is being acquired BY the caller's text, and the
 *     owner ruling is that such a row stays visible in search under that text (U3);
 *  2. `statusResponseSchema.food` is OPTIONAL, so a `RESOLVED` envelope may carry no golden record;
 *  3. `foodResponseSchema.name` is `z.string().nullable()` — a resolved food may be nameless;
 *  4. the golden name may be present and yet sanitize to `''` (invisible characters only), which would blank
 *     a `NOT NULL` column and make the row unfindable by any query.
 *
 * Every one of those returns `undefined`, meaning "record the status, leave the name alone". Only a genuine
 * canonical string is returned, and it is returned already SANITIZED, because it is about to become the
 * label every other user sees.
 */
import { describe, expect, it } from 'vitest';
import { foodStatusSchema } from '@kitchensink/schema-food';

import { canonicalNameFrom } from '../foodStatusTranslation.js';
import { makeFoodView, makeStatusResult } from '../__fixtures__/ingredients.fixtures.js';

/**
 * U+200B ZERO WIDTH SPACE, U+00A0 NO-BREAK SPACE and U+FEFF BOM — written as escapes rather than pasted,
 * because a reviewer cannot check a case they cannot see.
 */
const ZWSP = '\u200B';
const NBSP = '\u00A0';
const BOM = '\uFEFF';

describe('canonicalNameFrom', () => {
    it('returns the golden record`s name when the food RESOLVED with one', () => {
        const status = makeStatusResult({
            status: 'RESOLVED',
            food: makeFoodView({ name: 'Flour, wheat, all-purpose' }),
        });

        expect(canonicalNameFrom(status)).toBe('Flour, wheat, all-purpose');
    });

    it('sanitizes the golden name — food-service is a separate deploy, not a trusted transform', () => {
        // `sanitizeFoodName` is idempotent, so a name food already canonicalized survives unchanged. What
        // this guards is the OTHER direction: an older/newer food deploy, or a source that bypassed it,
        // cannot plant a zero-width character in a name recipe-service then indexes and displays.
        const status = makeStatusResult({
            status: 'RESOLVED',
            food: makeFoodView({ name: `  Bro${ZWSP}ccoli,${NBSP} raw ` }),
        });

        expect(canonicalNameFrom(status)).toBe('Broccoli, raw');
    });

    it('⛔ returns undefined for EVERY non-RESOLVED status food can emit', () => {
        // Enumerated from food's own published union rather than restated, so a status food ADDS is a
        // failure here rather than a silent rename of a row that never resolved.
        const notResolved = foodStatusSchema.options.filter((status) => status !== 'RESOLVED');

        expect(notResolved.length).toBeGreaterThan(0);

        for (const status of notResolved) {
            expect(
                canonicalNameFrom(makeStatusResult({ status, food: makeFoodView({ name: 'Should not be used' }) })),
            ).toBeUndefined();
        }
    });

    it('returns undefined when a RESOLVED envelope carries no golden record at all', () => {
        expect(canonicalNameFrom(makeStatusResult({ status: 'RESOLVED' }))).toBeUndefined();
    });

    it('returns undefined when the golden record`s name is null', () => {
        expect(
            canonicalNameFrom(makeStatusResult({ status: 'RESOLVED', food: makeFoodView({ name: null }) })),
        ).toBeUndefined();
    });

    it('returns undefined when the golden name sanitizes away to nothing', () => {
        // `''` would violate `ingredients.name NOT NULL`'s intent — a row with no findable, displayable label.
        expect(
            canonicalNameFrom(
                makeStatusResult({ status: 'RESOLVED', food: makeFoodView({ name: `${ZWSP}${ZWSP}${BOM}` }) }),
            ),
        ).toBeUndefined();
        expect(
            canonicalNameFrom(makeStatusResult({ status: 'RESOLVED', food: makeFoodView({ name: '   ' }) })),
        ).toBeUndefined();
    });
});
