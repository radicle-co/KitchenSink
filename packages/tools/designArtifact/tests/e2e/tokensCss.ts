/**
 * @module tokensCss — the CSS custom properties the artifact host derives from a Design System's `tokens.json`.
 *
 * The host reads the published `tokens.json` and sets every colour (light under `:root`, dark under
 * `[data-theme="dark"]`), spacing, radius and shadow token as `--<name>`, plus an `@font-face` per font file. This
 * reproduces that from the file the build wrote, so a card is rendered with the variables the host would give it and
 * not with the build's own copy of them.
 */
import { DesignArtifactError } from '../../src/errors.js';

interface Token {
    readonly name: string;
    readonly value: string | { readonly light: string; readonly dark?: string };
}

interface TokensJson {
    readonly color: { readonly tokens: readonly Token[] };
    readonly spacing: { readonly tokens: readonly Token[] };
    readonly radius: { readonly tokens: readonly Token[] };
    readonly shadow: { readonly tokens: readonly Token[] };
    readonly type: { readonly fonts: readonly { family: string; weight: string; style: string; file: string }[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function tokenList(json: Record<string, unknown>, group: string): readonly Token[] {
    const section = json[group];
    const tokens = isRecord(section) ? section['tokens'] : undefined;

    if (!Array.isArray(tokens)) {
        throw new DesignArtifactError('missing-source', `tokens.json has no "${group}.tokens" list.`);
    }

    return tokens as readonly Token[];
}

/**
 * The host's CSS for a tokens file.
 *
 * @param tokensJson - The parsed `tokens.json`.
 * @param fontBase - URL prefix the font `file` values are relative to (ending in `/`).
 * @returns Stylesheet text.
 * @throws DesignArtifactError `missing-source` when the file lacks a token group.
 */
export function hostTokensCss(tokensJson: unknown, fontBase: string): string {
    if (!isRecord(tokensJson)) {
        throw new DesignArtifactError('missing-source', 'tokens.json is not an object.');
    }

    const light: string[] = [];
    const dark: string[] = [];

    for (const token of tokenList(tokensJson, 'color')) {
        const value = typeof token.value === 'string' ? { light: token.value } : token.value;

        light.push(`--${token.name}:${value.light};`);
        dark.push(`--${token.name}:${value.dark ?? value.light};`);
    }

    for (const group of ['spacing', 'radius', 'shadow']) {
        for (const token of tokenList(tokensJson, group)) {
            light.push(`--${token.name}:${typeof token.value === 'string' ? token.value : token.value.light};`);
        }
    }

    const type = tokensJson['type'];
    const fonts = isRecord(type) && Array.isArray(type['fonts']) ? (type['fonts'] as TokensJson['type']['fonts']) : [];
    const faces = fonts.map(
        (font) =>
            `@font-face{font-family:'${font.family}';font-weight:${font.weight};font-style:${font.style};` +
            `src:url('${fontBase}${font.file}') format('truetype')}`,
    );

    return `${faces.join('')}:root{${light.join('')}}[data-theme="dark"]{${dark.join('')}}`;
}
