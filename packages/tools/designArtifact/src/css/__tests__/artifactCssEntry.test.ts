import { existsSync } from 'node:fs';
import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '../../config.js';

import { CONTENT_SOURCE_ROOTS, artifactCssEntry } from '../artifactCssEntry.js';

describe('artifactCssEntry', () => {
    const entry = artifactCssEntry(['/a/ui/src', '/b/features/recipes/src']);

    it('imports the shared theme alone, with source detection off', () => {
        expect(entry.split('\n')[0]).toBe("@import '@commise/ui/theme.css' source(none);");
    });

    it('does not import tailwindcss itself: the theme already does, and a second import doubles every layer', () => {
        expect(entry).not.toMatch(/@import ['"]tailwindcss/);
    });

    it('puts every @import before any other rule (CSS drops a late @import)', () => {
        const lines = entry.split('\n').filter((line) => line.trim() !== '');
        const lastImport = lines.map((line) => line.startsWith('@import')).lastIndexOf(true);
        const firstOther = lines.findIndex((line) => !line.startsWith('@import'));

        expect(lastImport).toBeLessThan(firstOther);
    });

    it('declares the dark variant on the data-theme attribute', () => {
        expect(entry).toContain('@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));');
    });

    it('emits exactly one @source per root, in order', () => {
        expect(entry.match(/^@source .*$/gm)).toEqual(['@source "/a/ui/src";', '@source "/b/features/recipes/src";']);
    });

    it('carries no copy of the design tokens: the theme comes from @commise/ui', () => {
        expect(entry).not.toContain('--color-');
        expect(entry).not.toContain('--font-');
        expect(entry).not.toContain('--text-');
    });

    it('brings in the three motion tokens the components use', () => {
        for (const name of ['home-hero-enter', 'section-enter', 'pending-bar-reveal']) {
            expect(entry).toContain(`--animate-${name}:`);
            expect(entry).toContain(`@keyframes ${name}`);
        }
    });

    it('rejects a root that would break out of the quoted path', () => {
        expect(() => artifactCssEntry(['/a"; @import "x'])).toThrow(/source root/);
    });

    it('also scans the authored cards and boards, whose utility classes the bundle sources never name', () => {
        expect(CONTENT_SOURCE_ROOTS.map((root) => relative(PACKAGE_ROOT, root))).toEqual([
            'content/designSystem/cards',
            'content/canvas/boards',
        ]);

        for (const root of CONTENT_SOURCE_ROOTS) {
            expect(existsSync(root), root).toBe(true);
        }
    });
});
