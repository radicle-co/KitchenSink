/** The one banned-word list and the matcher every copy guard shares. */
import { describe, expect, it } from 'vitest';

import { BANNED_COPY_WORDS, bannedCopyWordsIn } from '../bannedWords.js';

describe('BANNED_COPY_WORDS', () => {
    it('holds the words the rights label may never use', () => {
        expect(BANNED_COPY_WORDS).toEqual(
            expect.arrayContaining([
                'copyright-free',
                'royalty-free recipe',
                'legally yours',
                'safe to publish',
                'we checked this',
                'verified',
                'approved',
            ]),
        );
    });

    it('is written in lower case with no duplicates, so the matcher and a reader agree', () => {
        expect(BANNED_COPY_WORDS.every((word) => word === word.toLowerCase().trim())).toBe(true);
        expect(new Set(BANNED_COPY_WORDS).size).toBe(BANNED_COPY_WORDS.length);
    });
});

describe('bannedCopyWordsIn', () => {
    it.each([
        ['Your recipe is Verified.', ['verified']],
        ['It is COPYRIGHT-FREE and safe to publish!', ['copyright-free', 'safe to publish']],
        ['Saved from {site}. We  checked this.', ['we checked this']],
        ['Fully approved', ['approved']],
        ['legally\u200B yours', ['legally yours']],
    ])('finds the banned words in %j', (text, expected) => {
        expect(bannedCopyWordsIn(text)).toEqual(expected);
    });

    it.each([
        ['an ASCII hyphen', 'copyright-free'],
        ['a space', 'copyright free'],
        ['a hyphen U+2010', 'copyright\u2010free'],
        ['a non-breaking hyphen U+2011', 'copyright\u2011free'],
        ['a figure dash U+2012', 'copyright\u2012free'],
        ['an en dash U+2013', 'copyright\u2013free'],
        ['an em dash U+2014', 'copyright\u2014free'],
        ['a horizontal bar U+2015', 'copyright\u2015free'],
        ['a minus sign U+2212', 'copyright\u2212free'],
        ['a superscript minus U+207B', 'copyright\u207Bfree'],
        ['a hyphen bullet U+2043', 'copyright\u2043free'],
        ['a soft hyphen U+00AD', 'copyright\u00ADfree'],
        ['nothing at all', 'copyrightfree'],
        ['a hyphen with spaces around it', 'copyright - free'],
    ])('matches copyright-free spelled with %s', (_name, text) => {
        expect(bannedCopyWordsIn(text)).toEqual(['copyright-free']);
    });

    it.each([
        ['verified', 'veri\u00ADfied'],
        ['approved', 'ap\u00ADproved'],
        ['verified', 'ver\u200Bified'],
    ])('catches %s with an invisible character hidden inside', (word, text) => {
        expect(bannedCopyWordsIn(text)).toEqual([word]);
    });

    it.each([
        ['a Cyrillic \u0435', 'v\u0435rified'],
        ['a Cyrillic \u0430 and \u0440', '\u0430\u0440proved'],
        ['a Greek \u03BF', 'appr\u03BFved'],
        ['a dotted capital I', 'VER\u0130F\u0130ED'],
        ['a dotless \u0131', 'ver\u0131f\u0131ed'],
        ['an accent', 'v\u00E9rified'],
        ['a combining accent', 've\u0301rified'],
        ['capitals', 'VERIFIED'],
        ['full-width letters', '\uFF56erified'],
    ])('catches verified or approved disguised with %s', (_name, text) => {
        expect(bannedCopyWordsIn(text)).toHaveLength(1);
    });

    it.each([
        ['royalty-free recipes', ['royalty-free recipe']],
        ['Verifieds', ['verified']],
    ])('allows a plural: %j', (text, expected) => {
        expect(bannedCopyWordsIn(text)).toEqual(expected);
    });

    it('matches a hyphen written inside a phrase that has a space in the list', () => {
        expect(bannedCopyWordsIn('a royalty-free recipe')).toEqual(['royalty-free recipe']);
    });

    it.each([
        'Saved from {site}. The words and photos belong to their author.',
        'This is unverified.',
        'Disapproved of',
        'The recipe is copyrighted material, freed up',
        '',
    ])('finds nothing in %j', (text) => {
        expect(bannedCopyWordsIn(text)).toEqual([]);
    });
});
