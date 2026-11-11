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

import { resolveHomeNav, TAB_LABEL_TEXT_CAP } from '@commise/features-core';
import { homeMessages } from '@commise/features-core/home';
import { RECIPE_HOME_WIDGET_CAPABILITY } from '@commise/features-recipes';
import { resolveMessages, SUPPORTED_LOCALES } from '@commise/i18n';
import { SEGMENT_CHROME_CAP } from '@commise/ui/segmented-control/geometry';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import {
    TAB_BAR_CHROME_CAP,
    TAB_BAR_SIDE_PADDING,
    TAB_LABEL_ROLE,
    tabLabelRoom,
} from '../../../src/components/home/chrome/homeTabBarGeometry.js';

/** The two narrow screens `buildSpec.md` §3.2 names: where four tabs share the bar, 80 wide at 320 and 90 at 360. */
const SCREEN_WIDTHS = [320, 360] as const;

/** The tabs the bar shows today. */
const TABS = resolveHomeNav([RECIPE_HOME_WIDGET_CAPABILITY]);

/**
 * Tab labels take their own 1.3× cap (owner ruling 2026-11-11, `buildSpec.md` §3.2), below the 1.5× chrome cap: at 1.5×
 * the English "Discover" (about 90) and the active "Recipes" (about 81) overflowed an 80 tab. The cap is one named
 * constant, held once for both apps (`TAB_LABEL_TEXT_CAP`), never an inline number.
 */
describe('the tab label cap', () => {
    it('is the shared 1.3×, which is a chrome step below the 1.5× the other chrome keeps', () => {
        expect(TAB_BAR_CHROME_CAP).toBe(String(TAB_LABEL_TEXT_CAP));
        expect(TAB_BAR_CHROME_CAP).toBe('1.3');
        expect(Number(TAB_BAR_CHROME_CAP)).toBeLessThan(Number(SEGMENT_CHROME_CAP));
    });

    it('grows a label to 1.3× at the largest system size and no further', () => {
        const { fontSize } = scaledTypeSize('caption', Number.POSITIVE_INFINITY, TAB_BAR_CHROME_CAP);

        expect(fontSize).toBeCloseTo(nativeTokens.type.caption.fontSize * 1.3);
    });
});

describe.each(SCREEN_WIDTHS)('the Home tab bar fits at the tab label cap, at %i', (screenWidth) => {
    const room = tabLabelRoom({ screenWidth, count: TABS.length });

    const cases = SUPPORTED_LOCALES.flatMap((locale) => {
        const { destinations } = resolveMessages(homeMessages, locale).chrome;

        return TABS.flatMap(({ id }) =>
            (['active', 'inactive'] as const).map((state) => [locale, state, destinations[id]] as const),
        );
    });

    it.each(cases)('%s, %s tab: "%s" stays on one line', (_locale, state, label) => {
        const role = TAB_LABEL_ROLE[state];
        const { fontSize } = scaledTypeSize(role, Number.POSITIVE_INFINITY, TAB_BAR_CHROME_CAP);
        const face = asLoadedFace(nativeTokens.type[role].fontFamily);

        expect(measureTextWidth(label, face, fontSize)).toBeLessThanOrEqual(room);
    });

    it('has four tabs, You last, each at least 80 wide', () => {
        expect(TABS.map((tab) => tab.id)).toEqual(['home', 'recipes', 'discover', 'you']);
        expect(room).toBeGreaterThanOrEqual(80);
        expect(room).toBeCloseTo((screenWidth - 2 * TAB_BAR_SIDE_PADDING) / TABS.length);
    });
});
