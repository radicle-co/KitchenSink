/**
 * The transcription-disclosure Specification: who may be shown the line a cook pasted or imported.
 *
 * The rule is TWO conditions, both required: the viewer owns the recipe, AND the line records that its owner
 * supplied the text (`source_line_transcribed_by_owner`, ADR-0090). The table pins every cell. The undefined-viewer
 * row is the fail-closed one (a signed-out or system read is a reader), and the owner-with-an-unflagged-line row is
 * the clone case: a cook who cloned another cook's recipe owns the copy, and the verbatim text in it is not theirs.
 */
import { describe, expect, it } from 'vitest';

import { disclosedSourceLine, transcriptionAudienceOf } from '../transcriptionDisclosure.js';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const TEXT = '2 cups flour, sifted';

describe('transcriptionAudienceOf', () => {
    it.each([
        ['the owner', OWNER, 'owner'],
        ['another cook', OTHER, 'reader'],
        ['no viewer at all', undefined, 'reader'],
        ['an empty viewer id', '', 'reader'],
    ] as const)('classifies %s as a %s', (_label, viewerId, kind) => {
        expect(transcriptionAudienceOf({ ownerId: OWNER }, viewerId).kind).toBe(kind);
    });
});

describe('disclosedSourceLine', () => {
    const ownerAudience = transcriptionAudienceOf({ ownerId: OWNER }, OWNER);
    const reader = transcriptionAudienceOf({ ownerId: OWNER }, OTHER);
    const anonymous = transcriptionAudienceOf({ ownerId: OWNER }, undefined);
    const own = { sourceLine: TEXT, sourceLineTranscribedByOwner: true };
    const copied = { sourceLine: TEXT, sourceLineTranscribedByOwner: false };

    it('gives the owner the text of a line they transcribed', () => {
        expect(disclosedSourceLine(ownerAudience, own)).toBe(TEXT);
    });

    it('⛔ gives the owner NOTHING for a line whose text another cook supplied (a clone of their recipe)', () => {
        expect(disclosedSourceLine(ownerAudience, copied)).toBeUndefined();
    });

    it('gives the owner nothing for a line with no transcription', () => {
        expect(
            disclosedSourceLine(ownerAudience, { sourceLine: null, sourceLineTranscribedByOwner: false }),
        ).toBeUndefined();
    });

    it.each([
        ['another cook', reader],
        ['an undefined viewer', anonymous],
    ] as const)('never gives the text to %s, whether or not the owner transcribed it', (_label, audience) => {
        expect(disclosedSourceLine(audience, own)).toBeUndefined();
        expect(disclosedSourceLine(audience, copied)).toBeUndefined();
    });

    it('treats an empty stored string as no transcription, so absent stays the one spelling', () => {
        expect(
            disclosedSourceLine(ownerAudience, { sourceLine: '', sourceLineTranscribedByOwner: true }),
        ).toBeUndefined();
    });
});
