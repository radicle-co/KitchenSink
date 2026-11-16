/**
 * A lane's measured cost lives in ONE file, `laneCosts.json`, because two readers depend on it: the lane planners
 * (Android, iOS and web) and a user-level hook that decides whether an e2e suite has room. A second copy, written as a
 * literal in a planner, drifts from the file and the two disagree about whether a suite fits.
 *
 * This guard reads the lane folders' production source, comments removed, and fails on a cost literal: a `cpus:` or
 * `memBytes:` property given a number. A type declaration (`memBytes: number`) and the loader's computed value carry no
 * number, so they pass. Tests are not scanned: they pin and fake costs on purpose.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withoutTsComments } from './sourceComments.js';
import { repoRoot } from './serviceSources.js';
import { isSource, trackedPackageFiles } from './workspaceSourceScan.js';

const LANE_FOLDERS = [
    'packages/tools/e2ePlan/src/',
    'packages/tools/local-sandbox/src/',
    'packages/apps/commise/web/scripts/',
];

const isTestFile = (path: string): boolean => /(^|\/)(__tests__|__fixtures__|tests)\//u.test(path);

/** A `cpus:` or `memBytes:` property whose value (up to the next `,` or `}`) contains a digit. */
const COST_LITERAL = /\b(?:cpus|memBytes)\s*:\s*[^,}\n]*\d/gu;

/** The cost literals in a source text, comments ignored. Pure. */
export function costLiterals(text: string): string[] {
    return [...withoutTsComments(text).matchAll(COST_LITERAL)].map((match) => match[0]);
}

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
    const sources = trackedPackageFiles().filter(
        (path) => isSource(path) && !isTestFile(path) && LANE_FOLDERS.some((folder) => path.startsWith(folder)),
    );

    it('scans the lane folders (a guard over zero files passes for nothing)', () => {
        expect(sources.length).toBeGreaterThan(20);
        expect(sources).toContain('packages/tools/local-sandbox/src/maestroLanes/laneCosts.ts');
    });

    it('declares no lane cost literal outside laneCosts.json', () => {
        const offenders = sources.flatMap((path) =>
            costLiterals(readFileSync(join(repoRoot, path), 'utf8')).map((literal) => `${path}: ${literal}`),
        );

        expect(offenders).toEqual([]);
    });
});
