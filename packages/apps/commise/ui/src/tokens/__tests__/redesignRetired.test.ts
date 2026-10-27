/**
 * The teal-and-sand look cannot come back. The redesign (steel on a cool base, dusk dark mode) replaced it, and a
 * hard-coded literal is exactly how teal survived a token change before (six `rgba(...)` literals frozen at the
 * pre-#113 seafoam). This scans the source of every app and feature package for the retired values, in hex AND in
 * the decimal `rgba(r, g, b)` spelling, so a literal that skips the token module fails here.
 *
 * Mutation lens: paste `#31807A` or `rgba(49, 128, 122, 0.2)` into any file under the scanned trees and this fails
 * naming the file and the value.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { palette, role, roleDark } from '../colors.js';
import { coverTint, coverTintDark } from '../covers.js';

/** Retired value, with the name it had. Hex without the `#`, upper case. */
const RETIRED: Readonly<Record<string, string>> = {
    '31807A': 'seafoam (the teal action)',
    '5BA8A0': 'seafoam-light',
    '2A6B65': 'ocean-dark (teal)',
    '3D8B85': 'the pre-#113 seafoam',
    E2EDEC: 'the teal selected fill',
    '7DC7C0': 'the dark teal action text',
    '65B5AE': 'the dark teal edge',
    '243935': 'the dark teal selected fill',
    FAF6F0: 'sand (the warm canvas)',
    '141210': 'the warm dark canvas',
    '1E1B18': 'the warm dark paper',
    '2D3436': 'the old charcoal',
    '6B645C': 'the warm slate',
    C9C1B6: 'the warm mist',
    F3EEE6: 'linen (the warm pearl)',
    '8A847C': 'the warm pewter',
    A86A12: 'honey (the amber star)',
    '2EC4B6': 'the stray teal of the pre-#113 chips',
};

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/apps/commise`. */
const APPS = join(HERE, '../../../..');
const SCANNED = ['ui/src', 'web/src', 'mobile/src', 'features'];
const SKIPPED = new Set(['node_modules', 'dist', '.next', '__fixtures__', 'generated']);

/** Every source file under a directory. */
function files(directory: string): readonly string[] {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry);

        if (SKIPPED.has(entry)) {
            return [];
        }

        return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx|css|json)$/.test(entry) ? [path] : [];
    });
}

/** The forms one retired hex can be spelled in. */
function spellings(hex: string): readonly RegExp[] {
    const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

    return [new RegExp(`#${hex}\\b`, 'i'), new RegExp(`\\b${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`)];
}

describe('the retired teal-and-sand values', () => {
    it('are not in any token', () => {
        const tokens = [palette, role, roleDark, coverTint, coverTintDark].flatMap((table) =>
            Object.values(table).map((value) => value.toUpperCase()),
        );

        for (const hex of Object.keys(RETIRED)) {
            expect(tokens, `#${hex} is back in a token`).not.toContain(`#${hex}`);
        }
    });

    it('are not hard-coded in app or feature source', () => {
        const hits: string[] = [];

        for (const root of SCANNED) {
            for (const file of files(join(APPS, root))) {
                const text = readFileSync(file, 'utf8');

                if (file === fileURLToPath(import.meta.url)) {
                    continue;
                }

                for (const [hex, name] of Object.entries(RETIRED)) {
                    if (spellings(hex).some((pattern) => pattern.test(text))) {
                        hits.push(`${relative(APPS, file)}: #${hex} (${name})`);
                    }
                }
            }
        }

        expect(hits).toEqual([]);
    });
});
