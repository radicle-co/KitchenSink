/**
 * The transcription-disclosure Specification: who may be shown the line a cook pasted or imported.
 *
 * The rule today is ONE condition, "the viewer owns the recipe". The table pins every cell, and the
 * undefined-viewer row is the fail-closed one: a signed-out or system read is a reader.
 */
import { describe, expect, it } from 'vitest';

import { disclosedSourceLine, transcriptionAudienceOf } from '../transcriptionDisclosure.js';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const TEXT = '2 cups flour, sifted';

describe('transcriptionAudienceOf', () => {
    it.each([
        ['the owner', OWNER, 'transcriber'],
        ['another cook', OTHER, 'reader'],
        ['no viewer at all', undefined, 'reader'],
        ['an empty viewer id', '', 'reader'],
    ] as const)('classifies %s as a %s', (_label, viewerId, kind) => {
        expect(transcriptionAudienceOf({ ownerId: OWNER }, viewerId).kind).toBe(kind);
    });
});

describe('disclosedSourceLine', () => {
    const transcriber = transcriptionAudienceOf({ ownerId: OWNER }, OWNER);
    const reader = transcriptionAudienceOf({ ownerId: OWNER }, OTHER);
    const anonymous = transcriptionAudienceOf({ ownerId: OWNER }, undefined);

    it('gives the owner the text of a transcribed line', () => {
        expect(disclosedSourceLine(transcriber, { sourceLine: TEXT })).toBe(TEXT);
    });

    it('gives the owner nothing for a line with no transcription', () => {
        expect(disclosedSourceLine(transcriber, { sourceLine: null })).toBeUndefined();
    });

    it('never gives the text to another cook', () => {
        expect(disclosedSourceLine(reader, { sourceLine: TEXT })).toBeUndefined();
    });

    it('never gives the text to an undefined viewer', () => {
        expect(disclosedSourceLine(anonymous, { sourceLine: TEXT })).toBeUndefined();
    });

    it('treats an empty stored string as no transcription, so absent stays the one spelling', () => {
        expect(disclosedSourceLine(transcriber, { sourceLine: '' })).toBeUndefined();
    });
});
