import { describe, expect, it } from 'vitest';

import { CUISINE_ALIASES, CUISINES, canonicalCuisine, foldCuisine } from '../index.js';

/**
 * The committed list (`docs/design/uiOverhaul/cuisineField.md` §1.2, owner-approved 2026-10-13). Written out here on
 * purpose: an entry's spelling is a one-way door (§1.4 — renaming one splits its Discover facet), so a change to the
 * list must be a change to this test too, made on purpose.
 */
const APPROVED = [
    'Afghan',
    'Algerian',
    'American',
    'Argentinian',
    'Armenian',
    'Australian',
    'Austrian',
    'Bangladeshi',
    'Belgian',
    'Brazilian',
    'British',
    'Burmese',
    'Cajun',
    'Cambodian',
    'Canadian',
    'Cantonese',
    'Caribbean',
    'Chilean',
    'Chinese',
    'Colombian',
    'Creole',
    'Cuban',
    'Czech',
    'Dominican',
    'Dutch',
    'Egyptian',
    'Ethiopian',
    'Filipino',
    'French',
    'Georgian',
    'German',
    'Ghanaian',
    'Greek',
    'Haitian',
    'Hawaiian',
    'Hungarian',
    'Indian',
    'Indonesian',
    'Iraqi',
    'Irish',
    'Israeli',
    'Italian',
    'Jamaican',
    'Japanese',
    'Jewish',
    'Kenyan',
    'Korean',
    'Lao',
    'Lebanese',
    'Malaysian',
    'Mediterranean',
    'Mexican',
    'Middle Eastern',
    'Moroccan',
    'Native American',
    'Nepalese',
    'New Zealand',
    'Nigerian',
    'Nordic',
    'Pakistani',
    'Palestinian',
    'Persian',
    'Peruvian',
    'Polish',
    'Portuguese',
    'Puerto Rican',
    'Romanian',
    'Russian',
    'Salvadoran',
    'Senegalese',
    'Sichuan',
    'Singaporean',
    'Somali',
    'Soul food',
    'South African',
    'Southern',
    'Spanish',
    'Sri Lankan',
    'Swiss',
    'Syrian',
    'Taiwanese',
    'Tex-Mex',
    'Thai',
    'Trinidadian',
    'Tunisian',
    'Turkish',
    'Ukrainian',
    'Venezuelan',
    'Vietnamese',
    'Yemeni',
];

describe('CUISINES', () => {
    it('is exactly the 90 approved entries', () => {
        expect(CUISINES).toHaveLength(90);
        expect([...CUISINES]).toEqual(APPROVED);
    });

    it('is in Intl.Collator("en") order, so a cook can scan it', () => {
        const sorted = [...CUISINES].sort(new Intl.Collator('en').compare);

        expect([...CUISINES]).toEqual(sorted);
    });

    it('has no "Other": free text replaces it', () => {
        expect(CUISINES as readonly string[]).not.toContain('Other');
    });

    it('holds no two entries that fold to the same text', () => {
        expect(new Set(CUISINES.map(foldCuisine)).size).toBe(CUISINES.length);
    });
});

describe('CUISINE_ALIASES', () => {
    it.each([
        ['Szechuan', 'Sichuan'],
        ['Szechwan', 'Sichuan'],
        ['Iranian', 'Persian'],
        ['Scandinavian', 'Nordic'],
        ['Argentine', 'Argentinian'],
        ['Laotian', 'Lao'],
        ['Nepali', 'Nepalese'],
        ['Philippine', 'Filipino'],
    ])('maps %s to %s', (alias, entry) => {
        expect(CUISINE_ALIASES[alias]).toBe(entry);
    });

    it('has the eight approved aliases and no others', () => {
        expect(Object.keys(CUISINE_ALIASES)).toHaveLength(8);
    });

    it('never names an alias that is itself an entry, or that folds to one', () => {
        const entries = new Set(CUISINES.map(foldCuisine));

        for (const alias of Object.keys(CUISINE_ALIASES)) {
            expect(entries.has(foldCuisine(alias))).toBe(false);
        }
    });
});

describe('foldCuisine', () => {
    it.each([
        ['Thai', 'thai'],
        ['  Middle   Eastern ', 'middle eastern'],
        ['Tex-Mex', 'tex mex'],
        ['tex–mex', 'tex mex'],
        ['Créole', 'creole'],
        ['\tSoul\nfood ', 'soul food'],
        ['', ''],
        ['   ', ''],
    ])('folds %j to %j', (text, folded) => {
        expect(foldCuisine(text)).toBe(folded);
    });
});

describe('canonicalCuisine', () => {
    it.each([
        // A list entry, however it was typed, is saved in the list's spelling.
        ['thai', 'Thai'],
        ['THAI', 'Thai'],
        ['  middle   eastern ', 'Middle Eastern'],
        ['tex mex', 'Tex-Mex'],
        ['soul FOOD', 'Soul food'],
        ['créole', 'Creole'],
        // An alias is saved as its entry.
        ['szechuan', 'Sichuan'],
        ['IRANIAN', 'Persian'],
        // A value the list does not hold keeps its own words: first letter upper-cased, the rest as typed.
        ['nyonya', 'Nyonya'],
        ['  nyonya  ', 'Nyonya'],
        ['BBQ-style', 'BBQ-style'],
        ['pan-Asian', 'Pan-Asian'],
        ['grandma   style', 'Grandma style'],
        ['évora', 'Évora'],
        // Empty stays empty: absent on the wire.
        ['', ''],
        ['   ', ''],
    ])('canonicalises %j to %j', (text, canonical) => {
        expect(canonicalCuisine(text)).toBe(canonical);
    });

    it('is idempotent', () => {
        const samples = [...CUISINES, ...Object.keys(CUISINE_ALIASES), 'nyonya', 'pan-Asian', '  BBQ  style ', 'ñame'];

        for (const sample of samples) {
            const once = canonicalCuisine(sample);

            expect(canonicalCuisine(once)).toBe(once);
        }
    });

    it('upper-cases a whole first character, not half of a surrogate pair', () => {
        expect(canonicalCuisine('𝒶bc')).toBe('𝒶bc');
    });
});
