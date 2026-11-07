import { describe, expect, it, vi } from 'vitest';

import { role, roleDark } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { themeFor } from '../../theme/themeFor.js';
// A value no literal in the field could match: the disabled opacity must be READ from the shared token.
vi.mock('../../tokens/scale.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../tokens/scale.js')>()),
    dimmedOpacity: 0.25,
}));

import { FIELD_MIN_HEIGHT, fieldDisabled, fieldGeometry, fieldPaint } from '../fieldStyle.js';

/**
 * The native text-field geometry and paint (spec §1.5/§1.11). The type is read here rather than off a rendered field,
 * because jsdom resolves react-native-web's static `font` shorthand above the field's own longhands.
 *
 * ⚠️ REWRITTEN for D15: the geometry is static and holds NO colour; the paint is a function of the theme, applied at
 * render, so a field repaints in the dark scheme.
 */
describe('the native field geometry', () => {
    // ⛔ REWRITTEN: the geometry used to spread the body role, which carried a fixed `lineHeight` into every field and sat
    // the text low on iOS. The text of every field is `inputTextStyle`, applied by the `TextInput` primitive
    // (`TextInputStyle.native.test.tsx`), so the geometry holds none of it.
    it('holds the box only: no font family, size or line height, which belong to the input text style', () => {
        expect(Object.keys(fieldGeometry).filter((key) => /^(font|lineHeight)/u.test(key))).toEqual([]);
    });

    it('fits one body line and its padding inside the 48 pt minimum', () => {
        expect((nativeTokens.type.body.lineHeight ?? 0) + 2 * fieldGeometry.paddingVertical).toBe(FIELD_MIN_HEIGHT);
    });

    it('carries no colour, so nothing is baked into one theme', () => {
        expect(Object.keys(fieldGeometry).filter((key) => /color/iu.test(key))).toEqual([]);
    });

    it('dims to the shared dimmed opacity when disabled', () => {
        expect(fieldDisabled.opacity).toBe(0.25);
    });
});

describe('fieldPaint', () => {
    it('paints ink on paper with a lineControl edge, from the theme it is given', () => {
        expect(fieldPaint(themeFor('light'), false)).toEqual({
            color: role.ink,
            backgroundColor: role.paper,
            borderColor: role.lineControl,
        });
        expect(fieldPaint(themeFor('dark'), false)).toEqual({
            color: roleDark.ink,
            backgroundColor: roleDark.paper,
            borderColor: roleDark.lineControl,
        });
    });

    it('draws the danger edge when invalid', () => {
        expect(fieldPaint(themeFor('dark'), true).borderColor).toBe(roleDark.danger);
    });
});
