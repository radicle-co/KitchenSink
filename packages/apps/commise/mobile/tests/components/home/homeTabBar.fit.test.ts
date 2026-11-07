/**
 * The Home tab bar's labels at the largest text size (designer ruling 2026-11-01, ADR-0080 §8): a navigation-chrome label
 * grows to the 1.5× chrome cap, on one line, never broken inside a word and never cut off. This proves it for every
 * shipped locale, on the narrowest phone the boards draw (360 pt), by measuring each label in the app's own font file
 * (inactive tabs in the `caption` role, the active tab in the `label` role) against the room a tab leaves it.
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
    TAB_LABEL_ROLE,
    tabLabelRoom,
} from '../../../src/components/home/chrome/homeTabBarGeometry.js';

/** The narrowest phone the boards draw. */
const SCREEN_WIDTH = 360;

/** The tabs the bar shows today. */
const TABS = resolveHomeNav([RECIPE_HOME_WIDGET_CAPABILITY]);

describe('the Home tab bar fits at the chrome cap', () => {
    const room = tabLabelRoom({ screenWidth: SCREEN_WIDTH, count: TABS.length });

    it.each(
        SUPPORTED_LOCALES.flatMap((locale) => {
            const { destinations } = resolveMessages(homeMessages, locale).chrome;

            return TABS.flatMap(({ id }) =>
                (['active', 'inactive'] as const).map((state) => [locale, state, destinations[id]] as const),
            );
        }),
    )('%s, %s tab: "%s" stays on one line', (_locale, state, label) => {
        const role = TAB_LABEL_ROLE[state];
        const { fontSize } = scaledTypeSize(role, Number.POSITIVE_INFINITY, TAB_BAR_CHROME_CAP);
        const face = asLoadedFace(nativeTokens.type[role].fontFamily);

        expect(measureTextWidth(label, face, fontSize)).toBeLessThanOrEqual(room);
    });

    it('leaves each of three tabs a third of the bar, less its side padding', () => {
        expect(tabLabelRoom({ screenWidth: 360, count: 3 })).toBeCloseTo((360 - 2 * nativeTokens.spacing[1]) / 3);
    });
});
