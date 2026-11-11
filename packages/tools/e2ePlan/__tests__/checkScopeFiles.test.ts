import { describe, expect, it } from 'vitest';

import { isFileTier, scopeFiles } from '../src/checkScopeFiles.js';

const files = (...paths: string[]) => ({ kind: 'files', files: paths }) as const;

describe('scopeFiles', () => {
    it('checks only the changed prose the docs tier owns', () => {
        expect(
            scopeFiles(
                'docs',
                files('CLAUDE.md', 'docs/a/b.md', 'specs/x/spec.md', '.github/notes.md', 'docs/a/x.html'),
            ),
        ).toEqual({ kind: 'some', files: ['CLAUDE.md', 'docs/a/b.md', 'specs/x/spec.md'] });
    });

    it('checks nothing when no file of the tier changed', () => {
        expect(scopeFiles('docs', files('packages/apps/commise/web/src/a.ts'))).toEqual({ kind: 'some', files: [] });
    });

    it.each(['prettier.config.js', '.prettierignore', 'package-lock.json', 'packages/tools/prettier/index.js'])(
        're-checks every doc when %s changes',
        (config) => {
            expect(scopeFiles('docs', files('docs/a.md', config)).kind).toBe('all');
        },
    );

    it('re-checks everything when the selector changes', () => {
        expect(scopeFiles('docs', files('packages/tools/e2ePlan/src/checkScopeFiles.ts')).kind).toBe('all');
    });

    it('runs everything when asked', () => {
        expect(scopeFiles('docs', { kind: 'full', reason: 'push to main' })).toEqual({
            kind: 'all',
            reasons: ['push to main'],
        });
    });

    it('knows its tiers and nothing else', () => {
        expect(isFileTier('docs')).toBe(true);
        expect(isFileTier('toString')).toBe(false);
    });
});
