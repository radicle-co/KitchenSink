/**
 * @module tokens/tokensCss — the canvas's copy of the design tokens, as a stylesheet.
 *
 * Pure. Boards read colours through `var(--role)`; the viewer flips `data-theme` on the root to switch the theme.
 * The canvas wash behind the screens is `var(--background-image-hero)`, the name and value the product itself emits
 * (`@commise/ui` `themeCss.ts`), so a board never types the gradient again.
 */
import { gradient, gradientCss, heroDark } from '@commise/ui/tokens/gradients';

import type { ArtifactColorToken, ArtifactTokens, ArtifactThemedColour } from './artifactTokens.js';

/** Whether a colour token changes with the theme. */
function isThemed(token: ArtifactColorToken): token is ArtifactColorToken & { readonly value: ArtifactThemedColour } {
    return typeof token.value !== 'string';
}

/** The canvas wash's custom property: the product's own name (`--background-image-hero`). */
const HERO_WASH = 'background-image-hero';

/** A custom property declaration. */
function declaration(name: string, value: string): string {
    return `--${name}:${value};`;
}

/**
 * The stylesheet for a token set: `@font-face` rules, the light theme on `:root` (with the theme-independent
 * values), and the dark overrides on `[data-theme="dark"]`.
 *
 * @param tokens - The tokens to write.
 * @returns The stylesheet text, one rule per line.
 */
export function tokensCss(tokens: ArtifactTokens): string {
    const faces = tokens.type.fonts.map(
        (font) =>
            `@font-face{font-family:'${font.family}';font-weight:${font.weight};font-style:${font.style};` +
            `font-display:swap;src:url('${font.file}') format('truetype')}`,
    );
    const light = [
        ...tokens.color.tokens.map((token) =>
            declaration(token.name, isThemed(token) ? token.value.light : (token.value as string)),
        ),
        ...[...tokens.spacing.tokens, ...tokens.radius.tokens, ...tokens.shadow.tokens].map((token) =>
            declaration(token.name, token.value),
        ),
        ...Object.entries(tokens.type.families).map(([family, stack]) => declaration(`font-${family}`, stack)),
        declaration(HERO_WASH, gradientCss(gradient.hero)),
    ];
    const dark = [
        ...tokens.color.tokens.filter(isThemed).map((token) => declaration(token.name, token.value.dark)),
        declaration(HERO_WASH, gradientCss(heroDark)),
    ];

    return [
        ...faces,
        `:root,[data-theme="light"]{${light.join('')}}`,
        `[data-theme="dark"]{${dark.join('')}}`,
        '',
    ].join('\n');
}
