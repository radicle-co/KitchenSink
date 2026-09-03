/**
 * TOKEN classification, and the path recovery the committed output's determinism depends on.
 *
 * The token VALUES are asserted in the integration tier, against the real `@commise/ui` — a fixture palette
 * here would prove the serializer works and say nothing about whether the style guide shows the colours the
 * product paints.
 */
import { describe, expect, it } from 'vitest';

import { resolveTrimmedPath } from '../extract.js';
import { tokenKindOf } from '../tokens.js';

describe('tokenKindOf', () => {
    it.each([
        ['#31807A', 'color'],
        ['#FFF', 'color'],
        ['rgba(45, 52, 54, 0.6)', 'color'],
        ['oklch(0.55 0.06 180)', 'color'],
        ['1.5rem', 'dimension'],
        ['9999px', 'dimension'],
        ['100%', 'dimension'],
        [16, 'number'],
        ['Georgia, serif', 'text'],
        ['0 2px 8px 0 rgba(0,0,0,0.08)', 'shadow'],
    ])('classifies %j as %s', (value, expected) => {
        expect(tokenKindOf(value)).toBe(expected);
    });

    it('classifies a gradient spec from its own shape', () => {
        expect(tokenKindOf({ angle: 135, stops: [{ color: '#fff', position: 0 }] })).toBe('gradient');
    });

    it('classifies a glass spec from its fallback', () => {
        expect(tokenKindOf({ blur: 12, fallback: '#FFFFFFE6' })).toBe('glass');
    });

    it('classifies a React Native shadow from its own fields', () => {
        expect(tokenKindOf({ shadowRadius: 8, shadowOpacity: 0.1, elevation: 2 })).toBe('shadow');
    });

    it('falls back to object rather than guessing at an unrecognised shape', () => {
        expect(tokenKindOf({ anything: true })).toBe('object');
    });
});

describe('resolveTrimmedPath', () => {
    // `react-docgen-typescript` rewrites every declaring-file path relative to `dirname(process.cwd())` with
    // no option to pass a root, so the same tree produces different strings depending on where the command
    // was run from — and committed output whose bytes depend on the caller's shell has an unusable guard.
    it('recovers an absolute path from the library CWD-relative form, whatever directory it is called from', () => {
        const here = import.meta.dirname;
        const trimmed = 'docgen-components/src/__tests__/tokens.test.ts';
        const fromPackage = resolveTrimmedPath(trimmed, `${here}/../..`);
        const fromRepoRoot = resolveTrimmedPath(trimmed, `${here}/../../../../..`);

        expect(fromPackage).toContain('/packages/tools/docgen-components/src/__tests__/tokens.test.ts');
        expect(fromRepoRoot).toBe(fromPackage);
    });

    it('leaves an absolute path alone', () => {
        expect(resolveTrimmedPath('/a/b/c.ts', '/x/y')).toBe('/a/b/c.ts');
    });

    it('returns a path that resolves nowhere unchanged, rather than guessing at it', () => {
        expect(resolveTrimmedPath('nope/nothing/here.ts', import.meta.dirname)).toBe('nope/nothing/here.ts');
    });
});
