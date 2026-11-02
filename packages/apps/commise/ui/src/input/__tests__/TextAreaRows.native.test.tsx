/**
 * The rows of a multi-line field are counted in the CAPPED leading, not the 1x one. At the system cap a line is 48 pt, so
 * a floor and a ceiling of `rows x 24 pt` would stop a bounded field short of its rows (the text would scroll early) and
 * start an unbounded one too small. Size and clamp use the same leading as the text (`inputTextStyle`).
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { withPlatformOs } from '../../testing/platformOs.native.js';
import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { scaledTypeSize } from '../../text/scaledType.js';
import { FIELD_EDGE, FIELD_PADDING } from '../fieldStyle.js';
import { TextArea, textAreaHeight } from '../TextArea.native.js';

afterEach(cleanup);

const BOX = 2 * FIELD_PADDING + 2 * FIELD_EDGE;

describe('textAreaHeight', () => {
    it('counts the floor and the ceiling in the leading it is given', () => {
        expect(textAreaHeight(null, 2, 4, 24)).toBe(2 * 24 + BOX);
        expect(textAreaHeight(500, 2, 4, 24)).toBe(4 * 24 + BOX);
        expect(textAreaHeight(null, 2, 4, 48)).toBe(2 * 48 + BOX);
        expect(textAreaHeight(500, 2, 4, 48)).toBe(4 * 48 + BOX);
    });

    it('lets an unbounded field follow its content', () => {
        expect(textAreaHeight(300, 2, undefined, 48)).toBe(300 + BOX);
    });
});

describe('TextArea (native) — rows at the system text scale', () => {
    const height = (scale: number, minRows: number): number => {
        withPlatformOs('ios', () =>
            renderWithTamagui(
                <TextArea id="notes" label="Notes" value="" onChangeText={() => undefined} minRows={minRows} />,
                'light',
                scale,
            ),
        );

        return Number.parseFloat(screen.getByRole('textbox', { name: 'Notes' }).style.height);
    };

    it.each([1, 2, 3.1])('floors the field at minRows of the capped leading at scale %s', (scale) => {
        expect(height(scale, 3)).toBe(3 * scaledTypeSize('body', scale).lineHeight + BOX);
    });
});
