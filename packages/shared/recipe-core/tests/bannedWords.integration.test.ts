/**
 * The banned-word matcher through the package's export map, over the real text canonical form it builds on: realistic
 * cook-facing sentences, written the way someone would try to slip a claim past a plain search.
 */
import { BANNED_COPY_WORDS, bannedCopyWordsIn } from '@kitchensink/recipe-core/copy/banned-words';
import { describe, expect, it } from 'vitest';

describe('bannedCopyWordsIn through the export map', () => {
    it.each([
        ['This recipe is verified by our team.', ['verified']],
        ['100% COPYRIGHT‑FREE, so it is safe\u00A0to\u00A0publish.', ['copyright-free', 'safe to publish']],
        ['Approved! We  checked\tthis for you.', ['we checked this', 'approved']],
        ['These royalty-free recipes are legally yours.', ['royalty-free recipe', 'legally yours']],
        ['V\u00E9rifi\u00E9d \u2014 and APPROVED', ['verified', 'approved']],
        ['ver\u00ADified and ap\u200Bproved', ['verified', 'approved']],
    ])('finds the claims in %j', (text, expected) => {
        expect([...bannedCopyWordsIn(text)].sort()).toEqual([...expected].sort());
    });

    it.each([
        'Saved from {site}. The words and photos belong to their author. Private to you.',
        'An unverified source, disapproved of by nobody.',
        'Copyrighted, not copy right free.',
    ])('leaves honest copy alone: %j', (text) => {
        expect(bannedCopyWordsIn(text)).toEqual([]);
    });

    it('reports every entry of the list for a text that holds them all', () => {
        expect(new Set(bannedCopyWordsIn(BANNED_COPY_WORDS.join('. ')))).toEqual(new Set(BANNED_COPY_WORDS));
    });
});
