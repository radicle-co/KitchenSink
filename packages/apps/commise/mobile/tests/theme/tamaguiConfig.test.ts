/**
 * The tamagui.config RESOLVES guard. `tests/theme/scaleTokens.test.ts` asserts the input maps feed the
 * config unchanged; this suite is the other half — that `createTamagui` accepts those maps and returns
 * resolved tokens/themes with the expected values. The two fail differently: a valid map that Tamagui
 * rejects only fails here (a real event — Tamagui v3 reserves the `true` token key, so the v2 ramp threw
 * inside `createTokens` at app start while every token-map assertion stayed green and `tsc` was clean).
 */
import { fontFamily } from '@commise/ui/scale';
import { palette } from '@commise/ui/tokens/colors';
import { describe, expect, it } from 'vitest';

import config from '../../tamagui.config.js';

describe('the resolved Tamagui config', () => {
    it('builds without throwing (the config shape is one Tamagui accepts)', () => {
        expect(config.tokens).toBeDefined();
        expect(config.themes).toBeDefined();
    });

    it('resolves the spacing ramp to the shared scale values', () => {
        expect(config.tokens.space[4].val).toBe(16);
        expect(config.tokens.space[9].val).toBe(96);
        expect(config.tokens.size[4].val).toBe(16);
        expect(config.tokens.radius[5].val).toBe(9999);
    });

    it('resolves the light theme to the palette values (token references, not literals)', () => {
        expect(config.themes.light.background.val).toBe(palette.sand);
        expect(config.themes.light.color.val).toBe(palette.charcoal);
        expect(config.themes.light.primary.val).toBe(palette['seafoam-light']);
    });

    it('carries both font ramps under the shared type families', () => {
        expect(config.fonts.body.family).toBe(fontFamily.body);
        expect(config.fonts.heading.family).toBe(fontFamily.display);
        expect(config.fonts.body.size[4]).toBe(18);
        expect(config.fonts.heading.size[9]).toBe(48);
    });
});
