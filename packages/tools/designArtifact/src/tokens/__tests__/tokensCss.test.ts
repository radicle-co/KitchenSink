import { gradient, gradientCss, heroDark } from '@commise/ui/tokens/gradients';
import { describe, expect, it } from 'vitest';

import type { ArtifactTokens } from '../artifactTokens.js';
import { buildTokens } from '../buildTokens.js';
import { tokensCss } from '../tokensCss.js';

const small: ArtifactTokens = {
    name: 'T',
    version: 1,
    color: {
        themes: [
            { id: 'light', name: 'Light' },
            { id: 'dark', name: 'Dark' },
        ],
        note: '',
        tokens: [
            { name: 'canvas', value: { light: '#FFF', dark: '#000' }, usage: 'x' },
            { name: 'brand-red', value: '#F00', usage: 'x' },
        ],
    },
    type: {
        fonts: [
            { family: 'Inter', file: 'fonts/Inter_400Regular.ttf', weight: '400', style: 'normal' },
            { family: 'Inter_400Regular', file: 'fonts/Inter_400Regular.ttf', weight: '400', style: 'normal' },
        ],
        families: { display: '"Playfair Display", serif', body: 'Inter, sans-serif', mono: 'Mono' },
        groups: [],
    },
    spacing: { note: '', tokens: [{ name: 'space-1', value: '4px', usage: 'x' }] },
    radius: { tokens: [{ name: 'radius-sm', value: '6px', usage: 'x' }] },
    shadow: { tokens: [{ name: 'shadow-sm', value: '0 1px 3px red', usage: 'x' }] },
};

/** The text of the first rule whose selector starts with the given text. */
function block(css: string, selector: string): string {
    const start = css.indexOf(selector);

    if (start === -1) {
        throw new Error(`no ${selector} rule`);
    }

    return css.slice(start, css.indexOf('}', start) + 1);
}

describe('tokensCss', () => {
    const css = tokensCss(small);

    it('writes one @font-face per font, with the family quoted and the file relative', () => {
        const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];

        expect(faces).toEqual([
            "@font-face{font-family:'Inter';font-weight:400;font-style:normal;font-display:swap;src:url('fonts/Inter_400Regular.ttf') format('truetype')}",
            "@font-face{font-family:'Inter_400Regular';font-weight:400;font-style:normal;font-display:swap;src:url('fonts/Inter_400Regular.ttf') format('truetype')}",
        ]);
    });

    it('puts light values, constants, scales and font stacks on :root and the light theme attribute', () => {
        const light = block(css, ':root,[data-theme="light"]{');

        expect(light).toContain('--canvas:#FFF;');
        expect(light).toContain('--brand-red:#F00;');
        expect(light).toContain('--space-1:4px;');
        expect(light).toContain('--radius-sm:6px;');
        expect(light).toContain('--shadow-sm:0 1px 3px red;');
        expect(light).toContain('--font-display:"Playfair Display", serif;');
        expect(light).toContain('--font-body:Inter, sans-serif;');
        expect(light).toContain('--font-mono:Mono;');
        expect(light).not.toContain('#000');
    });

    it('puts only the themed colours, and the dark wash, on the dark theme attribute', () => {
        const dark = block(css, '[data-theme="dark"]{');

        expect(dark).toBe(`[data-theme="dark"]{--canvas:#000;--background-image-hero:${gradientCss(heroDark)};}`);
    });

    it('publishes the hero wash as the product names it, one value per theme, taken from the product tokens', () => {
        const light = block(css, ':root,[data-theme="light"]{');

        expect(light).toContain(`--background-image-hero:${gradientCss(gradient.hero)};`);
        expect(gradientCss(gradient.hero)).not.toBe(gradientCss(heroDark));
    });

    it('is deterministic', () => {
        expect(tokensCss(small)).toBe(css);
    });

    it('covers the real tokens: every colour in light, every themed one in dark', () => {
        const tokens = buildTokens();
        const real = tokensCss(tokens);
        const light = block(real, ':root,[data-theme="light"]{');
        const dark = block(real, '[data-theme="dark"]{');

        for (const token of tokens.color.tokens) {
            const value = typeof token.value === 'string' ? token.value : token.value.light;

            expect(light, token.name).toContain(`--${token.name}:${value};`);

            if (typeof token.value !== 'string') {
                expect(dark, token.name).toContain(`--${token.name}:${token.value.dark};`);
            } else {
                expect(dark, token.name).not.toContain(`--${token.name}:`);
            }
        }

        expect(real.match(/@font-face/g)).toHaveLength(tokens.type.fonts.length);
    });
});
