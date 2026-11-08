/**
 * The Recipes tab's route control ("My recipes" / "Collections") at the largest text size (designer ruling 2026-11-01,
 * ADR-0080 §8): a navigation-chrome label grows to the 1.5× chrome cap and is never broken or cut off. This test proves
 * it for every shipped locale, on the narrowest phone the boards draw (360 pt, less its 16 pt gutters), by measuring
 * each label in the app's own font file against the room a segment leaves it.
 *
 * jsdom lays nothing out, so the width comes from the font (`measureTextWidth`) and the room from the control's own
 * spacing (`segmentLabelRoom`). A device run calibrates the two.
 */
import { describe, expect, it } from 'vitest';

import { resolveMessages, SUPPORTED_LOCALES } from '@commise/i18n';
import { nativeTokens } from '@commise/ui/native';
import { scaledTypeSize } from '@commise/ui/scaled-type';
import { SEGMENT_CHROME_CAP, SEGMENT_LABEL_ROLE, segmentLabelRoom } from '@commise/ui/segmented-control/geometry';
import { asLoadedFace, measureTextWidth } from '@commise/ui/testing/measure-text';

import { recipeMessages } from '../../messages.js';

/** The narrowest phone the boards draw, less its two 16 pt gutters. */
const TRACK_WIDTH = 360 - 2 * nativeTokens.spacing[4];

describe('the Recipes route control fits at the chrome cap', () => {
    const { fontSize } = scaledTypeSize(SEGMENT_LABEL_ROLE, Number.POSITIVE_INFINITY, SEGMENT_CHROME_CAP);
    const face = asLoadedFace(nativeTokens.type[SEGMENT_LABEL_ROLE].fontFamily);
    const room = segmentLabelRoom({ trackWidth: TRACK_WIDTH, count: 2, withIcon: false });

    it.each(
        SUPPORTED_LOCALES.flatMap((locale) => {
            const { list } = resolveMessages(recipeMessages, locale);

            return [list.tabMine, list.tabCollections].map((label) => [locale, label] as const);
        }),
    )('%s: "%s" stays on one line', (_locale, label) => {
        expect(measureTextWidth(label, face, fontSize)).toBeLessThanOrEqual(room);
    });
});
