/**
 * A snapshot line read back as the paste matcher's `ParseJobMatch` (ADR-0072 §4), so the import projects it through the very
 * function the paste screen uses and the two cannot disagree about what a verdict means.
 *
 * The mutations: a variant read as a root (the food is asked about under the wrong kind and the line shows unreachable), a
 * `refused` review read as `owed` (a line that can never be reviewed would read `checking` forever), and a proposal-less line
 * given a review.
 */
import { describe, expect, it } from 'vitest';

import { makeLine } from '../../__fixtures__/importFixtures.js';
import { matchOfSnapshotLine } from '../snapshotMatch.js';

describe('matchOfSnapshotLine', () => {
    it('reads a proposed root food, its tier, rung and margin, and the review owed under its key', () => {
        const match = matchOfSnapshotLine(makeLine());

        expect(match).toMatchObject({
            lineIndex: 0,
            foodIndex: 0,
            judgementDigest: 'jd-0',
            proposal: { matchedBy: 'lexical', food: { kind: 'root', id: 'F-whole' }, rung: 'head', margin: 0.2 },
            verificationKey: 'v1:proposal',
            review: 'owed',
            enqueuedAt: null,
        });
        expect(match.candidates).toEqual([{ kind: 'root', id: 'F-whole', rung: 'head' }]);
    });

    it('⛔ reads a proposed VARIANT as a variant', () => {
        const match = matchOfSnapshotLine(makeLine({ foodId: null, foodVariantId: 'V-flat' }));

        expect(match.proposal?.food).toEqual({ kind: 'variant', id: 'V-flat' });
    });

    it('⛔ reads a refused review as refused, with no key', () => {
        const match = matchOfSnapshotLine(makeLine({ review: 'refused', verificationKey: null }));

        expect(match).toMatchObject({ review: 'refused', verificationKey: null });
        expect(match.proposal).not.toBeNull();
    });

    it('reads a line that found nothing as no proposal, no key and no review', () => {
        const match = matchOfSnapshotLine(
            makeLine({
                matchedBy: null,
                foodId: null,
                foodVariantId: null,
                rung: null,
                margin: null,
                review: null,
                verificationKey: null,
            }),
        );

        expect(match).toMatchObject({ proposal: null, verificationKey: null, review: null });
    });

    it('keeps every candidate in order, each with its own kind and rung; a rung this build does not know reads as none', () => {
        const match = matchOfSnapshotLine(
            makeLine({
                candidates: [
                    { kind: 'variant', id: 'V1', rung: 'head', isDefault: false },
                    { kind: 'root', id: 'R2', rung: 'a-rung-from-a-newer-build', isDefault: false },
                ],
            }),
        );

        expect(match.candidates).toEqual([
            { kind: 'variant', id: 'V1', rung: 'head' },
            { kind: 'root', id: 'R2', rung: null },
        ]);
    });

    it('is a defect, thrown, when the stored candidates are not the shape the importer wrote', () => {
        expect(() => matchOfSnapshotLine(makeLine({ candidates: [{ nope: 1 }] }))).toThrow();
    });

    it('is a defect, thrown, when a proposal has no review (the table’s CHECK forbids it)', () => {
        expect(() => matchOfSnapshotLine(makeLine({ review: null, verificationKey: null }))).toThrow();
    });
});
