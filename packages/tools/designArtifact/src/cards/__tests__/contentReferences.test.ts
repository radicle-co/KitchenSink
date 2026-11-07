import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fontFamily } from '@commise/ui/scale';
import { describe, expect, it } from 'vitest';

import { CONTENT_DIR } from '../../config.js';
import { buildTokens } from '../../tokens/buildTokens.js';

/**
 * The Design System's own pages (cards and the cover) may only name what the system ships. The host page defines a
 * CSS variable for each token in `tokens.json` and registers each font face, and nothing else: a `var(--x)` with no
 * token behind it makes its whole declaration invalid (a border that was meant to be a divider falls back to the text
 * colour), and a family outside `fontFamily` renders in a fallback face. Both failed silently before this guard, when
 * the redesign renamed `--cover-seafoam` and dropped Playfair Display.
 */
const DESIGN_SYSTEM_DIR = join(CONTENT_DIR, 'designSystem');

function pagesUnder(directory: string): readonly string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);

        if (statSync(path).isDirectory()) {
            return pagesUnder(path);
        }

        return /\.(tsx|html)$/.test(name) ? [path] : [];
    });
}

const pages = pagesUnder(DESIGN_SYSTEM_DIR);
const tokens = buildTokens();
const tokenNames = new Set(
    [tokens.color, tokens.spacing, tokens.radius, tokens.shadow].flatMap((group) => group.tokens.map((t) => t.name)),
);
const shippedFamilies = new Set(
    Object.values(fontFamily).flatMap((stack) =>
        stack.split(',').map((family) => family.trim().replace(/^["']|["']$/g, '')),
    ),
);

/**
 * The theme CSS every card page loads emits each `fontFamily` stack as `--font-<key>`, so a card names a family
 * through that variable (a card may not import product values: it would bundle a second copy of the product).
 */
const fontVariables = new Set(Object.keys(fontFamily).map((key) => `font-${key}`));

/** The variables a page reads that it neither defines itself nor gets from a token. */
function unknownVariables(text: string): readonly string[] {
    const defined = new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
    const read = [...text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1] ?? '');

    return read.filter(
        (name) => !defined.has(name) && !tokenNames.has(name.slice(2)) && !fontVariables.has(name.slice(2)),
    );
}

/** The font families a page names in a `font` shorthand or a `font-family`, each without its quotes. */
function namedFamilies(text: string): readonly string[] {
    const source = text.replace(/var\(--font-([a-z]+)\)/g, (whole, key: string) =>
        fontVariables.has(`font-${key}`) ? 'inherit' : whole,
    );
    const shorthands = [...source.matchAll(/\bfont\s*:\s*['"`]?([^;'"`\n}]+)/g)].map((match) =>
        (match[1] ?? '').replace(/^(?:(?:normal|italic|\d{3})\s+)*\d+(?:\.\d+)?px(?:\/\S+)?\s+/, ''),
    );
    const families = [...source.matchAll(/font-family\s*:\s*([^;}\n]+)/g)].map((match) => match[1] ?? '');

    return [...shorthands, ...families]
        .flatMap((list) => list.split(','))
        .map((family) => family.trim().replace(/^["']|["']$/g, ''))
        .filter((family) => family !== '' && family !== 'inherit');
}

describe('Design System content names only what the system ships', () => {
    it('scans the cards and the cover, so an empty scan cannot pass', () => {
        expect(pages.length).toBeGreaterThan(80);
        expect(pages.some((page) => page.endsWith('cover.html'))).toBe(true);
    });

    it.each(pages.map((page) => [relative(DESIGN_SYSTEM_DIR, page), page]))(
        '%s reads only token variables',
        (_name, page) => {
            expect(unknownVariables(readFileSync(page, 'utf8'))).toEqual([]);
        },
    );

    it.each(pages.map((page) => [relative(DESIGN_SYSTEM_DIR, page), page]))(
        '%s names only families in fontFamily',
        (_name, page) => {
            expect(namedFamilies(readFileSync(page, 'utf8')).filter((family) => !shippedFamilies.has(family))).toEqual(
                [],
            );
        },
    );
});
