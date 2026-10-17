/**
 * Which variant a search query names, after retrieval (curated catalog plan U8 S3, R15, R16, AE3).
 *
 * The leftovers are the query's ranking tokens minus those of the ONE name or synonym that matches it best. A variant
 * attaches only when exactly one live variant's part tokens contain every leftover.
 */
import { describe, expect, it } from 'vitest';

import { leftoverTokens, matchVariant, namesOf, type VariantCandidate } from '../variantQueryMatch.js';

const FLAT: VariantCandidate = { id: 'V-flat', parts: [{ text: 'flat' }] };
const POINT: VariantCandidate = { id: 'V-point', parts: [{ text: 'point' }] };
const FLAT_BRAISED: VariantCandidate = { id: 'V-flat-braised', parts: [{ text: 'flat' }, { text: 'braised' }] };

describe('leftoverTokens', () => {
    it('is empty when the query is exactly the name', () => {
        expect(leftoverTokens('beef brisket', ['beef brisket'])).toStrictEqual([]);
    });

    it('is the query’s tokens the name does not hold', () => {
        expect(leftoverTokens('beef brisket flat', ['beef brisket'])).toStrictEqual(['flat']);
    });

    it('subtracts the synonym that matches best, not the name', () => {
        expect(leftoverTokens('first cut brisket point', ['beef brisket', 'first cut brisket'])).toStrictEqual([
            'point',
        ]);
    });

    it('⛔ subtracts ONE name or synonym, never every synonym — that would delete the variant’s own word', () => {
        // `beef brisket` and `brisket point` tie on two matched tokens and none unmatched; the name wins the tie, so
        // `point` survives. Subtracting both would leave nothing and the point cut could never be named.
        expect(leftoverTokens('beef brisket point', ['beef brisket', 'brisket point'])).toStrictEqual(['point']);
    });

    it('prefers the tighter of two names that match the same tokens', () => {
        // Both hold `brisket`; `brisket` alone leaves no word of its own unmatched, so it is the better match.
        expect(leftoverTokens('brisket flat', ['brisket of beef', 'brisket'])).toStrictEqual(['flat']);
    });

    it('folds and singularizes, as ranking does', () => {
        expect(leftoverTokens('Beef Briskets FLATS', ['beef brisket'])).toStrictEqual(['flat']);
    });
});

describe('matchVariant', () => {
    it('AE3: a query naming one variant attaches that variant', () => {
        expect(matchVariant('beef brisket flat', ['beef brisket'], [FLAT, POINT])).toBe(FLAT);
    });

    it('AE3: a query naming two variants attaches neither', () => {
        expect(matchVariant('beef brisket flat point', ['beef brisket'], [FLAT, POINT])).toBeUndefined();
    });

    it('AE3: a query naming no variant attaches none', () => {
        expect(matchVariant('beef brisket', ['beef brisket'], [FLAT, POINT])).toBeUndefined();
    });

    it('attaches nothing when two live variants both contain the leftovers', () => {
        expect(matchVariant('beef brisket flat', ['beef brisket'], [FLAT, FLAT_BRAISED])).toBeUndefined();
    });

    it('matches a variant whose parts together contain every leftover', () => {
        expect(matchVariant('beef brisket flat braised', ['beef brisket'], [FLAT, FLAT_BRAISED])).toBe(FLAT_BRAISED);
    });

    it('matches a multi-word part by its tokens', () => {
        const trimmed: VariantCandidate = { id: 'V-trim', parts: [{ text: 'trimmed to 0" fat' }] };

        expect(matchVariant('beef brisket trimmed', ['beef brisket'], [FLAT, trimmed])).toBe(trimmed);
    });

    it('attaches nothing when a leftover is in no variant', () => {
        expect(matchVariant('beef brisket smoked', ['beef brisket'], [FLAT, POINT])).toBeUndefined();
    });

    it('attaches nothing for a root with no variants', () => {
        expect(matchVariant('beef brisket flat', ['beef brisket'], [])).toBeUndefined();
    });
});

describe('namesOf', () => {
    it('lists the name, then each stored synonym', () => {
        expect(namesOf('beef brisket', 'first cut brisket; packer brisket')).toStrictEqual([
            'beef brisket',
            'first cut brisket',
            'packer brisket',
        ]);
    });

    it('lists nothing for a nameless row with no synonyms', () => {
        expect(namesOf(null, null)).toStrictEqual([]);
    });
});
