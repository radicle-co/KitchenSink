import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, render } from '@testing-library/react';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { GLYPHS } from '../glyphs.js';
import { ICON_NAMES, MIRROR_IN_RTL, type IconName } from '../props.js';

/**
 * The glyph Registry — one list of meanings, and each platform's leaf maps every meaning to a Lucide glyph.
 *
 * The web map is read by RENDERING it: Lucide stamps each glyph's own kebab name into its class (`lucide-house`), so the
 * test reads what the component actually draws, not what the map says it draws. The native map cannot render here
 * (`react-native-svg` has no jsdom runtime), so its source is PARSED for the deep import behind each key. The two are
 * then required to agree for every name: a meaning that drew `house` on web and `home` on a phone is exactly the drift
 * the Registry exists to prevent.
 */

afterEach(cleanup);

/** The Lucide glyph a web map entry draws, read off the rendered `<svg>`'s class list. */
function webGlyphName(name: IconName): string {
    const Glyph = GLYPHS[name];
    const { container } = render(<Glyph />);
    const svg = container.querySelector('svg');
    const glyph = [...(svg?.classList ?? [])].find((token) => token.startsWith('lucide-'));

    cleanup();

    if (glyph === undefined) {
        throw new Error(`The web glyph for "${name}" rendered no lucide-* class.`);
    }

    return glyph.slice('lucide-'.length);
}

/** Every key of the native map with the deep-import glyph name its value comes from, read with the TS parser. */
function nativeGlyphNames(): ReadonlyMap<string, string> {
    const file = path.resolve(import.meta.dirname, '../glyphs.native.ts');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const importedFrom = new Map<string, string>();
    const keys = new Map<string, string>();

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const local = node.importClause?.name?.text;

            if (local !== undefined) {
                importedFrom.set(local, node.moduleSpecifier.text);
            }
        }

        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.initializer)) {
            const specifier = importedFrom.get(node.initializer.text);

            if (specifier !== undefined) {
                keys.set(node.name.getText(source), specifier.replace(/^lucide-react-native\/icons\//, ''));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return keys;
}

describe('the glyph Registry', () => {
    it('lists each meaning once', () => {
        expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    });

    it('draws a Lucide glyph on web for every meaning', () => {
        for (const name of ICON_NAMES) {
            expect(webGlyphName(name), name).toMatch(/^[a-z0-9-]+$/);
        }
    });

    it('maps every meaning on native, and nothing else', () => {
        expect([...nativeGlyphNames().keys()].sort()).toEqual([...ICON_NAMES].sort());
    });

    it('draws the SAME glyph on both platforms for every meaning', () => {
        const native = nativeGlyphNames();
        const disagreements = ICON_NAMES.filter((name) => native.get(name) !== webGlyphName(name)).map(
            (name) => `${name}: web ${webGlyphName(name)}, native ${String(native.get(name))}`,
        );

        expect(disagreements).toEqual([]);
    });

    it('imports native glyphs only by deep path, never the package root that ships every glyph', () => {
        const file = path.resolve(import.meta.dirname, '../glyphs.native.ts');
        const specifiers = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]);
        const lucide = specifiers.filter((specifier) => specifier?.startsWith('lucide-react-native'));

        expect(lucide.length).toBe(ICON_NAMES.length);
        expect(lucide.filter((specifier) => !specifier?.startsWith('lucide-react-native/icons/'))).toEqual([]);
    });

    it('mirrors in right-to-left exactly the glyphs that point left or right', () => {
        // The rule, not a restatement of the set: a chevron points a direction that reverses with the reading order.
        // The clock, the timer and every other glyph keep their drawing (spec §2.2).
        const directional = ICON_NAMES.filter((name) => /^chevrons?-(left|right)$/.test(webGlyphName(name)));

        expect([...MIRROR_IN_RTL].sort()).toEqual([...directional].sort());
        expect(directional.length).toBeGreaterThan(0);
    });
});
