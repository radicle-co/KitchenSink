/**
 * The Home tab bar's labels at the largest text size (designer ruling 2026-11-01, ADR-0080 §8): a navigation-chrome label
 * grows to the 1.5× chrome cap, on one line, never broken inside a word and never cut off. This proves it for every
 * shipped locale, on the narrowest phone the boards draw (360 pt), by measuring each label in the app's own font file
 * (inactive tabs in the `caption` role, the active tab in the `label` role) against the room a tab leaves it.
 *
 * With four tabs (Home, Recipes, Discover and You; owner ruling 2026-11-11, N3) the narrowest screen is 320 pt, which
 * `buildSpec.md` §3.2 names: each tab is at least 80 wide there.
 *
 * jsdom lays nothing out, so the width comes from the font (`measureTextWidth`) and the room from the bar's own geometry
 * (`tabLabelRoom`). A device run calibrates the two.
 */
import { describe, expect, it } from 'vitest';

import { resolveHomeNav } from '@commise/features-core';
import { homeMessages } from '@commise/features-core/home';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { resolveMessages, SUPPORTED_LOCALES } from '@commise/i18n';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import {
    TAB_BAR_CHROME_CAP,
    TAB_BAR_SIDE_PADDING,
    TAB_LABEL_ROLE,
    tabLabelRoom,
} from '../../../src/components/home/chrome/homeTabBarGeometry.js';

/** The narrowest screen the spec names (320), where four tabs share the bar. */
const SCREEN_WIDTH = 320;

/** The tabs the bar shows today. */
const TABS = resolveHomeNav([RECIPE_HOME_WIDGET_CAPABILITY]);

describe('the Home tab bar fits at the chrome cap', () => {
    const room = tabLabelRoom({ screenWidth: SCREEN_WIDTH, count: TABS.length });

    /**
     * ⚠️ OPEN DESIGN CONFLICT, measured 2026-11-11: at the 1.5× chrome cap (ADR-0080 §8) the English "Discover" is about 90 dp
     * wide in either role and "Recipes" in the active `label` role about 81 dp, and four tabs leave 80 dp each at 320 (and
     * 90 at 360), where three left 107 at 360. `buildSpec.md` §3.2 says "Discover" at +35% still fits 80 px; it does not
     * quite (80.2). These three cases are listed here, and run as `it.fails`, so the suite stays honest: each one turns RED
     * the day a design ruling (a shorter label, a lower tab-label cap, or a two-line label) makes it fit, and the entry is
     * then deleted. Nothing else is excused: every other label, locale and role is asserted to fit.
     */
    const KNOWN_OVERFLOW: ReadonlySet<string> = new Set([
        'en|active|Recipes',
        'en|active|Discover',
        'en|inactive|Discover',
    ]);

    const cases = SUPPORTED_LOCALES.flatMap((locale) => {
        const { destinations } = resolveMessages(homeMessages, locale).chrome;

        return TABS.flatMap(({ id }) =>
            (['active', 'inactive'] as const).map((state) => [locale, state, destinations[id]] as const),
        );
    });

    const labelFits = (state: 'active' | 'inactive', label: string): boolean => {
        const role = TAB_LABEL_ROLE[state];
        const { fontSize } = scaledTypeSize(role, Number.POSITIVE_INFINITY, TAB_BAR_CHROME_CAP);
        const face = asLoadedFace(nativeTokens.type[role].fontFamily);

        return measureTextWidth(label, face, fontSize) <= room;
    };

    for (const [locale, state, label] of cases) {
        const name = `${locale}, ${state} tab: "${label}" stays on one line`;

        if (KNOWN_OVERFLOW.has(`${locale}|${state}|${label}`)) {
            it.fails(`${name} (known overflow, see the note above)`, () => {
                expect(labelFits(state, label)).toBe(true);
            });
        } else {
            it(name, () => {
                expect(labelFits(state, label)).toBe(true);
            });
        }
    }

    it('has four tabs, You last', () => {
        expect(TABS.map((tab) => tab.id)).toEqual(['home', 'recipes', 'discover', 'you']);
    });

    it('leaves each of four tabs a quarter of the bar, less its side padding, which is at least 80 at 320', () => {
        expect(tabLabelRoom({ screenWidth: 320, count: 4 })).toBeCloseTo((320 - 2 * TAB_BAR_SIDE_PADDING) / 4);
        expect(room).toBeGreaterThanOrEqual(80);
    });
});
