import { describe, expect, it } from 'vitest';

import { role, roleDark } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { themeFor } from '../../theme/themeFor.js';
import { FIELD_MIN_HEIGHT, fieldDisabled, fieldGeometry, fieldPaint } from '../fieldStyle.js';

/**
 * The native text-field geometry and paint (spec §1.5/§1.11). The type is read here rather than off a rendered field,
 * because jsdom resolves react-native-web's static `font` shorthand above the field's own longhands.
 *
 * ⚠️ REWRITTEN for D15: the geometry is static and holds NO colour; the paint is a function of the theme, applied at
 * render, so a field repaints in the dark scheme.
 */
describe('the native field geometry', () => {
    it('sets the text in the body role — one registered face, at 16, never with a fontWeight', () => {
        expect(fieldGeometry.fontFamily).toBe(nativeTokens.type.body.fontFamily);
        expect(fieldGeometry.fontSize).toBe(16);
        expect(fieldGeometry).not.toHaveProperty('fontWeight');
    });

    it('fits one body line and its padding inside the 48 pt minimum', () => {
        expect((nativeTokens.type.body.lineHeight ?? 0) + 2 * fieldGeometry.paddingVertical).toBe(FIELD_MIN_HEIGHT);
    });

    it('carries no colour, so nothing is baked into one theme', () => {
        expect(Object.keys(fieldGeometry).filter((key) => /color/iu.test(key))).toEqual([]);
    });

    it('dims to 40% when disabled', () => {
        expect(fieldDisabled.opacity).toBe(0.4);
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
