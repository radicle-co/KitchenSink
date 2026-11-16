/**
 * A lane's measured cost lives in ONE file, `laneCosts.json`, because two readers depend on it: the lane planners
 * (Android, iOS and web) and a user-level hook that decides whether an e2e suite has room. A second copy, written as a
 * literal in a planner, drifts from the file and the two disagree about whether a suite fits.
 *
 * Two checks run over every tracked, non-test TypeScript or JavaScript source under `packages/`, comments removed:
 *
 * 1. No cost literal: a `cpus:` or `memBytes:` property given a value that contains a digit. A type declaration
 *    (`memBytes: number`) and the loader's computed value carry no digit, so they pass.
 * 2. Every `: LaneCost =` or `satisfies LaneCost` initialiser starts with `laneCosts.`, so a cost is taken from the
 *    file and not built or copied beside it.
 *
 * What it still does not catch: a cost given without a digit in the property value (a named constant such as
 * `cpus: FIVE`), a cost built where no `LaneCost` annotation or `satisfies` marks it (an untyped object literal, a
 * return type, a function argument), a `cpus` or `memBytes` written under another name, and a cost kept in a language
 * other than TypeScript or JavaScript. Tests are not scanned: they pin and fake costs on purpose.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withoutTsComments } from './sourceComments.js';
import { repoRoot } from './serviceSources.js';
import { isSource, trackedPackageFiles } from './workspaceSourceScan.js';

const isTestFile = (path: string): boolean => /(^|\/)(__tests__|__fixtures__|tests)\//u.test(path);

/** A `cpus:` or `memBytes:` property whose value (up to the next `,` or `}`) contains a digit. */
const COST_LITERAL = /\b(?:cpus|memBytes)\s*:\s*[^,}\n]*\d/gu;

/** The cost literals in a source text, comments ignored. Pure. */
function costLiterals(text: string): string[] {
    return [...withoutTsComments(text).matchAll(COST_LITERAL)].map((match) => match[0]);
}

/** What follows `: LaneCost =` or comes before `satisfies LaneCost`, comments ignored. Pure. */
function laneCostInitialisers(text: string): string[] {
    const code = withoutTsComments(text);

    return [
        ...[...code.matchAll(/:\s*LaneCost\s*=(?!>)\s*([^;]*)/gu)].map((match) => (match[1] ?? '').trim()),
        ...[...code.matchAll(/=\s*([^;=]*?)\s+satisfies\s+LaneCost\b/gu)].map((match) => (match[1] ?? '').trim()),
    ];
}

const fromTheFile = (initialiser: string): boolean => initialiser.startsWith('laneCosts.');

describe('laneCostInitialisers', () => {
    it('reads both forms and ignores a comment', () => {
        expect(laneCostInitialisers('export const A: LaneCost = laneCosts.web;')).toEqual(['laneCosts.web']);
        expect(laneCostInitialisers('const B = { ...laneCosts.web } satisfies LaneCost;')).toEqual([
            '{ ...laneCosts.web }',
        ]);
        expect(laneCostInitialisers('// const C: LaneCost = { cpus: 1 };')).toEqual([]);
    });

    it('rejects an initialiser that is not an entry of the file', () => {
        expect(fromTheFile('laneCosts.android')).toBe(true);
        expect(fromTheFile('{ ...laneCosts.web }')).toBe(false);
        expect(fromTheFile('makeCost()')).toBe(false);
    });
});

describe('costLiterals', () => {
    it('finds a hand-written lane cost', () => {
        expect(costLiterals('const C = { cpus: 3, memBytes: Math.round(5.8 * 1024 ** 3) };')).toEqual([
            'cpus: 3',
            'memBytes: Math.round(5.8 * 1024 ** 3',
        ]);
    });

    it('ignores a type declaration, a loader-computed value and a comment', () => {
        expect(costLiterals('interface L { readonly cpus: number; readonly memBytes: number }')).toEqual([]);
        expect(costLiterals('({ cpus, memBytes: Math.round(gib * GIB) })')).toEqual([]);
        expect(costLiterals('// { cpus: 5.5, memBytes: 5.5 * GIB }')).toEqual([]);
    });
});

describe('lane costs have one source', () => {
    const sources = trackedPackageFiles().filter((path) => isSource(path) && !isTestFile(path));
    const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');

    it('scans every tracked source (a guard over zero files passes for nothing)', () => {
        expect(sources.length).toBeGreaterThan(500);
        expect(sources).toContain('packages/tools/e2ePlan/src/laneCosts.ts');
        expect(sources).toContain('packages/tools/local-sandbox/src/maestroLanes/androidAdapter.ts');
    });

    it('declares no lane cost literal outside laneCosts.json', () => {
        const offenders = sources.flatMap((path) => costLiterals(read(path)).map((literal) => `${path}: ${literal}`));

        expect(offenders).toEqual([]);
    });

    it('takes every LaneCost initialiser from laneCosts', () => {
        const offenders = sources.flatMap((path) =>
            laneCostInitialisers(read(path))
                .filter((initialiser) => !fromTheFile(initialiser))
                .map((initialiser) => `${path}: ${initialiser}`),
        );

        expect(offenders).toEqual([]);
    });
});
