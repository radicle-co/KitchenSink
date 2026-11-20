// scanScope.mjs — which scanner applies to which changed files, and what it is pointed at (owner ruling 2026-11-20:
// "We should only run on files that change"). Every test fails if the rule it names is removed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    NOT_APPLICABLE,
    cloneTouchesChangedLines,
    cruiseTargets,
    isApplicable,
    touchesModuleSurface,
} from '../scanScope.mjs';

const NONE = { code: 0, python: 0, codeInTsProject: 0, manifest: 0, moduleSurface: 0, workflow: 0 };

describe('which tool applies to which changed files', () => {
    const table = [
        ['eslint-overlay', { code: 1 }],
        ['jscpd', { code: 1 }],
        ['semgrep', { python: 1 }],
        ['semgrep', { code: 1 }],
        ['depcruise', { codeInTsProject: 1 }],
        ['knip', { moduleSurface: 1 }],
        ['knip', { manifest: 1 }],
        ['sherif', { manifest: 1 }],
        ['turbo-config', { manifest: 1 }],
        ['turbo-config', { code: 1 }],
        ['turbo-boundaries', { manifest: 1 }],
        ['codeql', { code: 1 }],
        ['codeql', { python: 1 }],
        ['ruff', { python: 1 }],
        ['mypy', { python: 1 }],
        ['zizmor', { workflow: 1 }],
    ];
    for (const [tool, kinds] of table) {
        it(`${tool} applies to ${JSON.stringify(kinds)} and to nothing else`, () => {
            assert.equal(isApplicable(tool, { ...NONE, ...kinds }), true);
            assert.equal(isApplicable(tool, NONE), false);
        });
    }

    it('applies no tool to a docs-only change', () => {
        for (const [tool] of table) {
            assert.equal(isApplicable(tool, NONE), false, tool);
        }
    });

    it('does not run sherif or knip for a code change that touches no manifest and no export or import', () => {
        const kinds = { ...NONE, code: 3, codeInTsProject: 3 };
        assert.equal(isApplicable('sherif', kinds), false);
        assert.equal(isApplicable('knip', kinds), false);
    });

    it('does not run ruff or mypy for a TypeScript-only change', () => {
        const kinds = { ...NONE, code: 3 };
        assert.equal(isApplicable('ruff', kinds), false);
        assert.equal(isApplicable('mypy', kinds), false);
    });

    it('names the not-applicable state', () => {
        assert.equal(NOT_APPLICABLE, 'NOT_APPLICABLE');
    });
});

describe('knip runs only when exports, imports or a manifest change', () => {
    const diff = (...lines) => ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', ...lines].join('\n');
    it('sees an added export', () => {
        assert.equal(touchesModuleSurface(diff('+export const a = 1;')), true);
    });
    it('sees a removed export', () => {
        assert.equal(touchesModuleSurface(diff('-export function a() {}')), true);
    });
    it('sees an added or removed import', () => {
        assert.equal(touchesModuleSurface(diff("+import { a } from './a.js';")), true);
        assert.equal(touchesModuleSurface(diff("-import type { A } from './a.js';")), true);
    });
    it('sees a require and a re-export', () => {
        assert.equal(touchesModuleSurface(diff("+const a = require('a');")), true);
        assert.equal(touchesModuleSurface(diff("+export * from './a.js';")), true);
    });
    it('ignores a change that touches no export or import', () => {
        assert.equal(touchesModuleSurface(diff('+const a = 1;', '-const a = 2;')), false);
    });
    it('does not read the +++ and --- file headers as changed lines', () => {
        assert.equal(touchesModuleSurface('--- a/export.ts\n+++ b/import.ts\n@@ -1 +1 @@\n+const a = 1;'), false);
    });
    it('ignores the word export inside a comment or identifier', () => {
        assert.equal(touchesModuleSurface(diff('+const exported = 1;', '+// we export nothing')), false);
    });
});

describe('depcruise is pointed at the changed files', () => {
    it('returns the changed files, relative to the package, and not the package directories', () => {
        assert.deepEqual(cruiseTargets('packages/a', ['packages/a/src/x.ts', 'packages/a/lib/y.ts']), [
            'src/x.ts',
            'lib/y.ts',
        ]);
    });
    it('keeps a root-package file as it is', () => {
        assert.deepEqual(cruiseTargets('', ['x.ts']), ['x.ts']);
    });
});

describe('jscpd reports only clones that involve changed lines', () => {
    const changed = new Set([10, 11, 12]);
    it('reports a clone that overlaps a changed line', () => {
        assert.equal(cloneTouchesChangedLines({ start: 8, end: 10 }, changed), true);
        assert.equal(cloneTouchesChangedLines({ start: 12, end: 30 }, changed), true);
    });
    it('drops a clone entirely in unchanged lines', () => {
        assert.equal(cloneTouchesChangedLines({ start: 1, end: 9 }, changed), false);
        assert.equal(cloneTouchesChangedLines({ start: 13, end: 40 }, changed), false);
    });
    it('reports every clone in a file with no per-line information (new or explicit-scope file)', () => {
        assert.equal(cloneTouchesChangedLines({ start: 1, end: 9 }, undefined), true);
    });
});
