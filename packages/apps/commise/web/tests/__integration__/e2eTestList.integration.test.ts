// @vitest-environment node
/**
 * The selected-specs door against the REAL Playwright: a `--test-list` file built from a `--list` report must select
 * exactly the tests it was built from.
 *
 * The line syntax (`[project] › file › describe › title`) is Playwright's, not ours, and a line that does not match
 * silently selects nothing. A unit test over our own text cannot see that; only Playwright can. This runs
 * `playwright test --list` only. It starts no server and runs no test.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { flattenReport, parseReport, type ReportedTest } from '../../scripts/e2eReport';
import { specFilters, testListText } from '../../scripts/e2eSelection';

/** One spec with several projects, and one with nested describes and the own-session project. */
const SPECS = ['collectionHeaderReflow.spec.ts', 'authPages.spec.ts'] as const;

describe('a --test-list built from a --list report', () => {
    let dir: string;

    const list = (args: readonly string[]): readonly ReportedTest[] => {
        const out = join(dir, `report${Math.random().toString(36).slice(2)}.json`);

        execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...args], {
            env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: out },
            stdio: ['ignore', 'ignore', 'inherit'],
        });

        return flattenReport(parseReport(readFileSync(out, 'utf8'))).filter((test) => test.project !== 'setup');
    };

    const idsOf = (tests: readonly ReportedTest[]): readonly string[] => tests.map((test) => test.id).sort();

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'e2eTestList-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('selects exactly the tests of the named specs, and no other spec', () => {
        const named = list(specFilters(SPECS));
        const file = join(dir, 'selected.txt');

        writeFileSync(file, testListText(named));

        expect(named.length).toBeGreaterThan(3);
        expect(new Set(named.map((test) => test.id.split(' › ')[1]))).toEqual(new Set(SPECS));
        expect(idsOf(list(['--test-list', file]))).toEqual(idsOf(named));
    });

    it('keeps a spec out of the run when its file filter is exact', () => {
        const tests = list(specFilters(['home.spec.ts']));

        expect(tests.length).toBeGreaterThan(0);
        expect(tests.every((test) => test.id.split(' › ')[1] === 'home.spec.ts')).toBe(true);
    });

    it('selects nothing from an empty list, which is why the door short-circuits zero before calling Playwright', () => {
        const file = join(dir, 'empty.txt');

        writeFileSync(file, '');

        expect(list(['--test-list', file])).toEqual([]);
    });
});
