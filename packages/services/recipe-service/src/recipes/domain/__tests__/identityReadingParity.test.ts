/**
 * ADR-0071 §9: the paste view and a saved line's badge derive from ONE classifier, `identityReadingOf`. This table is
 * the whole of how the two surfaces may differ. A row here changes only with the ADR's paragraph on the difference:
 * asking the cook before a bind is cheap, badging a bound line is a warning.
 *
 * Each row is one stored verdict, run through BOTH real surfaces: `matchStateOf` for a lexical proposal, and
 * `resolveLineStatus` for a saved line whose catalog status is RESOLVED.
 */
import { describe, expect, it } from 'vitest';
import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import { identityReadingOf, IDENTITY_READINGS, resolveLineStatus, type IdentityReading } from '../lineVerification.js';
import { matchStateOf } from '../matchState.js';

const ASKED = ['identity', 'quantity'];

interface Row {
    readonly label: string;
    readonly verdict: Parameters<typeof identityReadingOf>[0];
    readonly reading: IdentityReading;
    readonly paste: string;
    readonly saved: FoodResolutionStatus;
}

const ROWS: readonly Row[] = [
    {
        label: 'itemized agree',
        verdict: { band: 'verified', certainty: 'high', identityVerdict: 'agree', aspects: ASKED },
        reading: 'agree',
        paste: 'confident',
        saved: FoodResolutionStatus.RESOLVED,
    },
    {
        label: 'high-certainty disagree',
        verdict: { band: 'contradicted', certainty: 'high', identityVerdict: 'disagree', aspects: ASKED },
        reading: 'contradict',
        paste: 'needsChoice',
        saved: FoodResolutionStatus.AMBIGUOUS,
    },
    {
        label: 'medium-certainty disagree',
        verdict: { band: 'contradicted', certainty: 'medium', identityVerdict: 'disagree', aspects: ASKED },
        reading: 'doubt',
        paste: 'needsChoice',
        saved: FoodResolutionStatus.NEEDS_REVIEW,
    },
    {
        label: 'low-certainty agree',
        verdict: { band: 'inconclusive', certainty: 'low', identityVerdict: 'agree', aspects: ASKED },
        reading: 'hedged',
        paste: 'needsChoice',
        saved: FoodResolutionStatus.RESOLVED,
    },
    {
        label: 'itemized abstain',
        verdict: { band: 'inconclusive', certainty: 'high', identityVerdict: 'abstain', aspects: ASKED },
        reading: 'abstain',
        paste: 'needsChoice',
        saved: FoodResolutionStatus.AMBIGUOUS,
    },
    {
        label: 'unreadable model reply',
        verdict: { band: 'inconclusive', certainty: 'low', identityVerdict: null, aspects: ASKED },
        reading: 'unreadable',
        paste: 'needsChoice',
        saved: FoodResolutionStatus.RESOLVED,
    },
    {
        label: 'old contradicted row with no itemization',
        verdict: { band: 'contradicted', certainty: 'high', identityVerdict: null, aspects: ASKED },
        reading: 'unreadable',
        paste: 'needsChoice',
        saved: FoodResolutionStatus.NEEDS_REVIEW,
    },
    {
        label: 'quantity-only verdict',
        verdict: { band: 'contradicted', certainty: 'high', identityVerdict: 'disagree', aspects: ['quantity'] },
        reading: 'unasked',
        paste: 'checking',
        saved: FoodResolutionStatus.NEEDS_REVIEW,
    },
];

describe('one classifier, two stated mappings', () => {
    it.each(ROWS)('$label reads $reading: paste $paste, saved $saved', ({ verdict, reading, paste, saved }) => {
        expect(identityReadingOf(verdict)).toBe(reading);

        expect(
            matchStateOf({
                proposal: { matchedBy: 'lexical', rung: 'head' },
                candidateCount: 2,
                defaultApplies: false,
                proposalIsDefault: false,
                verdict,
                review: 'asked',
            }).state,
        ).toBe(paste);

        expect(resolveLineStatus(verdict.band, FoodResolutionStatus.RESOLVED, reading)).toBe(saved);
    });

    it('covers every reading the classifier can return', () => {
        expect(new Set(ROWS.map((row) => row.reading))).toStrictEqual(new Set(IDENTITY_READINGS));
    });
});
