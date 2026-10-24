import { describe, expect, it } from 'vitest';

import { getDictionary } from '../../src/i18n/getDictionary';

describe('getDictionary', () => {
    it('returns the en dictionary', () => {
        const dict = getDictionary('en');

        expect(dict.home.title).toBe('Commise');
        expect(dict.home.chrome.pageTitles.profile).toBe('Profile');
    });

    it('falls back to en for an unshipped locale', () => {
        expect(getDictionary('fr').home.title).toBe('Commise');
    });
});
