/**
 * The Tamagui config BUILDS, and what it built is the shared design scale. `scaleTokens.test.ts` checks the maps the
 * config is fed; this suite checks the other half: that `createTamagui` accepts them and resolves every token, theme
 * value and font step to the value `@commise/ui` holds. The two fail differently. Tamagui 3 throws inside
 * `createTokens` on a key it reserves (the v2 `true` step), while every map assertion stays green and `tsc` is clean,
 * so only a test that builds the real config can see it.
 *
 * Every expected value is read from `@commise/ui`, never written here as a literal, so a palette or ramp change moves
 * this test with it instead of breaking it.
 */
import { fontFamily, fontSize, spacing } from '@commise/ui/scale';
import { palette, role } from '@commise/ui/tokens/colors';
import { describe, expect, it } from 'vitest';

import { bodyFontSize, displayFontSize, radiusScale } from '../../src/theme/scaleTokens.js';
import config from '../../tamagui.config.js';

const steps = Object.keys(spacing) as unknown as readonly (keyof typeof spacing)[];

describe('the built Tamagui config', () => {
    it('resolves every space and size step to the shared spacing scale, with no `true` step', () => {
        for (const step of steps) {
            expect(config.tokens.space[step]?.val, `space ${step}`).toBe(spacing[step]);
            expect(config.tokens.size[step]?.val, `size ${step}`).toBe(spacing[step]);
        }

        expect(Object.keys(config.tokens.space)).not.toContain('true');
        expect(Object.keys(config.tokens.size)).not.toContain('true');
    });

    it('resolves every radius step to the radius ramp', () => {
        for (const [step, value] of Object.entries(radiusScale)) {
            expect(config.tokens.radius[step as unknown as keyof typeof radiusScale]?.val, `radius ${step}`).toBe(value);
        }
    });

    it('resolves the light theme to the palette and roles it is drawn from', () => {
        const light = config.themes.light;

        expect(light.background.val).toBe(palette.fog);
        expect(light.color.val).toBe(palette.charcoal);
        expect(light.primary.val).toBe(palette['steel-light']);
        expect(light.borderColor.val).toBe(role.lineDivider);
    });

    it('carries both font ramps under the shared families, step for step', () => {
        expect(config.fonts.body.family).toBe(fontFamily.body);
        expect(config.fonts.heading.family).toBe(fontFamily.display);

        for (const [step, value] of Object.entries(bodyFontSize)) {
            expect(config.fonts.body.size[step as unknown as keyof typeof bodyFontSize], `body ${step}`).toBe(value);
        }

        for (const [step, value] of Object.entries(displayFontSize)) {
            expect(config.fonts.heading.size[step as unknown as keyof typeof displayFontSize], `heading ${step}`).toBe(
                value,
            );
        }

        expect(Math.max(...Object.values(bodyFontSize), ...Object.values(displayFontSize))).toBeLessThanOrEqual(
            Math.max(...Object.values(fontSize)),
        );
    });
});
