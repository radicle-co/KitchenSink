/**
 * `hiddenReasonOf` decides what the owner of a hidden recipe is told. Whether a reason exists comes ONLY from the read
 * function's own answer (`heldFromReaders`); the terms pick the line. Every table row states `heldFromReaders`, so a
 * deleted owner gate or audience gate cannot pass for the wrong reason (qse decision, hiddenViews U1).
 */
import { describe, expect, it } from 'vitest';

import { RecipeSourceType, RecipeVisibility, recipeSchema } from '../recipe.types.js';
import { hiddenReasonOf, knownHiddenReasonOf, type HiddenReasonFacts } from '../recipeState/hiddenReason.js';

const PRIVATE_ONLY_ORIGIN = { sourceType: RecipeSourceType.IMPORTED_PHYSICAL, sourceKind: 'book' } as const;
const OPEN_ORIGIN = { sourceType: RecipeSourceType.USER_CREATED, sourceKind: null } as const;

const facts = (overrides: Partial<HiddenReasonFacts> = {}): HiddenReasonFacts => ({
    viewerIsOwner: true,
    visibility: RecipeVisibility.PUBLIC,
    heldFromReaders: true,
    sourceCorrected: false,
    hasCookSourceEvidence: false,
    ...OPEN_ORIGIN,
    ...overrides,
});

describe('hiddenReasonOf: the owner of a public recipe the read rule holds', () => {
    it.each([
        ['the correction hold alone (AE1)', { sourceCorrected: true }, 'sourceCorrected'],
        [
            'the correction hold and a book label (AE2)',
            { sourceCorrected: true, ...PRIVATE_ONLY_ORIGIN },
            'sourceCorrected',
        ],
        [
            'the correction hold and cook evidence (AE2)',
            { sourceCorrected: true, hasCookSourceEvidence: true },
            'sourceCorrected',
        ],
        ['a book label with no hold', { ...PRIVATE_ONLY_ORIGIN }, 'heldSource'],
        ['cook evidence on an own-label recipe', { hasCookSourceEvidence: true }, 'heldSource'],
        // The read rule holds it for a term this function does not map (a from-person recipe after a staff clear, AE4 owner
        // view): the chip shows and no line does. Never `sourceCorrected`, never `heldSource`.
        ['held with no mapped term', {}, 'other'],
    ] as const)('says %s: %s', (_name, overrides, expected) => {
        expect(hiddenReasonOf(facts(overrides))).toBe(expected);
    });

    it('says nothing when the read rule does not hold it, whatever the terms say (a later exemption cannot disagree with readers)', () => {
        expect(
            hiddenReasonOf(
                facts({
                    heldFromReaders: false,
                    sourceCorrected: true,
                    hasCookSourceEvidence: true,
                    ...PRIVATE_ONLY_ORIGIN,
                }),
            ),
        ).toBeUndefined();
        expect(hiddenReasonOf(facts({ heldFromReaders: false }))).toBeUndefined();
    });

    it('says nothing for a private audience, with the hold set (AE4)', () => {
        expect(hiddenReasonOf(facts({ visibility: RecipeVisibility.PRIVATE, sourceCorrected: true }))).toBeUndefined();
    });
});

describe('hiddenReasonOf: a viewer who is not the owner never gets a reason (AE3)', () => {
    const rows = [RecipeVisibility.PUBLIC, RecipeVisibility.PRIVATE].flatMap((visibility) =>
        [false, true].flatMap((sourceCorrected) =>
            [false, true].flatMap((hasCookSourceEvidence) =>
                [OPEN_ORIGIN, PRIVATE_ONLY_ORIGIN].map((origin) => ({
                    visibility,
                    sourceCorrected,
                    hasCookSourceEvidence,
                    ...origin,
                })),
            ),
        ),
    );

    it('covers every audience x hold x evidence x label combination', () => {
        expect(rows).toHaveLength(16);
    });

    it.each(rows)('is undefined for %j, with the read rule holding it', (row) => {
        expect(hiddenReasonOf(facts({ ...row, viewerIsOwner: false, heldFromReaders: true }))).toBeUndefined();
    });
});

describe('knownHiddenReasonOf', () => {
    it.each([
        ['sourceCorrected', 'sourceCorrected'],
        ['heldSource', 'heldSource'],
        // `other` is a real reason with no line, so a client gets no line key for it.
        ['other', undefined],
        ['tooClose', undefined],
        ['', undefined],
        ['SourceCorrected', undefined],
        [undefined, undefined],
    ] as const)('maps %j to %j', (wire, expected) => {
        expect(knownHiddenReasonOf(wire)).toBe(expected);
    });
});

describe('recipeSchema.hiddenReason (AE3c)', () => {
    const base = {
        id: '01HZX0000000000000000000AA',
        ownerId: '01HZX0000000000000000000BB',
        title: 'Soup',
        prepTimeMinutes: 1,
        cookTimeMinutes: 1,
        totalTimeMinutes: 2,
        servings: 2,
        visibility: 'public',
        status: 'published',
        sourceType: 'user_created',
        hasSubstantiveEdit: false,
        dietaryFlags: [],
        tags: [],
        currentVersion: 1,
        ratingCount: 0,
        usesPremiumCapability: false,
        createdAt: '2026-11-28T00:00:00.000Z',
        updatedAt: '2026-11-28T00:00:00.000Z',
    };

    it('parses an item with a reason this build does not know, and keeps it', () => {
        expect(recipeSchema.parse({ ...base, hiddenReason: 'futureReason' }).hiddenReason).toBe('futureReason');
    });

    it('parses an item with no reason', () => {
        expect(recipeSchema.parse(base).hiddenReason).toBeUndefined();
    });
});
