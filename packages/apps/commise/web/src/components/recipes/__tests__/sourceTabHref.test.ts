/**
 * Unit tests for {@link recipeSourceHrefs} — the ONE statement of where each recipe source lives on web.
 *
 * Both source surfaces build their switcher from this, so a wrong or missing destination here is exactly the
 * defect it exists to prevent: `/discover` previously had no route back to `/recipes` at all.
 */
import { describe, expect, it } from 'vitest';

import { recipeSourceHrefs } from '../sourceTabHref';

describe('recipeSourceHrefs', () => {
    it('gives BOTH sources a locale-prefixed destination', () => {
        expect(recipeSourceHrefs('en')).toEqual({ mine: '/en/recipes', community: '/en/discover' });
    });

    it('carries the active locale into every destination', () => {
        // A locale-blind href would strand a non-English viewer on the wrong locale's surface (or on the
        // middleware's redirect), which is the same dead end wearing a different hat.
        const hrefs = recipeSourceHrefs('fr');

        expect(Object.values(hrefs).every((href) => href.startsWith('/fr/'))).toBe(true);
    });
});
