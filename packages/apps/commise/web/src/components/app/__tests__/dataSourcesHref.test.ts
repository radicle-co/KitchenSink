/**
 * The Data sources page's address (curated U25, design §S16): one authority for every link to it in the web app.
 */
import { describe, expect, it } from 'vitest';

import { dataSourcesHref } from '../dataSourcesHref';

describe('dataSourcesHref', () => {
    it.each([
        ['en', '/en/legal/sources'],
        ['fr', '/fr/legal/sources'],
    ])('addresses the %s page under its locale', (locale, href) => {
        expect(dataSourcesHref(locale)).toBe(href);
    });
});
