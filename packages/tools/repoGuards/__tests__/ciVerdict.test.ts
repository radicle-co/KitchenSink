// @vitest-environment node
/**
 * `.github/scripts/ciVerdict.sh` — the decision behind `_ci.yml`'s `CI verdict` job, the ONE stable check name
 * a branch ruleset can require (owner ruling 2026-10-16: `main` takes pull requests with green CI only).
 *
 * Run as the real script over `needs`-context shapes. The rule is the owner's 2026-10-03 one: a check may skip
 * ONLY when it depends on the sandbox, so a skipped job outside the sandbox list is a failure — a skip claims
 * nothing, and a green over a job that never ran claims something false.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/ciVerdict.sh');

type Result = 'success' | 'failure' | 'cancelled' | 'skipped';

/** A `needs` context as GitHub renders it: each job id maps to an object carrying its `result`. */
const needs = (results: Record<string, Result | undefined>): string =>
    JSON.stringify(Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }])));

/**
 * Run the script.
 *
 * @param needsJson - The `needs` context, as the workflow passes it through `env:`.
 * @param maySkip - The space-separated sandbox list.
 * @returns Exit status, combined output and the job summary it wrote.
 * @sideEffect Writes a temp directory.
 */
function run(
    needsJson: string | undefined,
    maySkip: string | undefined,
): { readonly status: number | null; readonly out: string; readonly summary: string } {
    const directory = mkdtempSync(path.join(tmpdir(), 'ci-verdict-'));
    const summaryFile = path.join(directory, 'summary');

    writeFileSync(summaryFile, '');

    const result = spawnSync('bash', [SCRIPT], {
        encoding: 'utf8',
        env: {
            PATH: process.env['PATH'] ?? '',
            GITHUB_STEP_SUMMARY: summaryFile,
            ...(needsJson === undefined ? {} : { NEEDS_JSON: needsJson }),
            ...(maySkip === undefined ? {} : { SANDBOX_MAY_SKIP: maySkip }),
        },
    });

    return {
        status: result.status,
        out: `${result.stdout}${result.stderr}`,
        summary: readFileSync(summaryFile, 'utf8'),
    };
}

const LIST = 'deploy-preview deployed-tiers';

describe('ciVerdict.sh', () => {
    it.each([
        ['every job succeeded', { lint: 'success', test: 'success', 'deploy-preview': 'success' }, 0],
        ['a sandbox job skipped (sandbox down)', { lint: 'success', 'deploy-preview': 'skipped' }, 0],
        ['every sandbox job skipped', { lint: 'success', 'deploy-preview': 'skipped', 'deployed-tiers': 'skipped' }, 0],
        ['one job failed', { lint: 'failure', test: 'success' }, 1],
        ['a sandbox job failed', { lint: 'success', 'deploy-preview': 'failure' }, 1],
        ['one job was cancelled', { lint: 'success', test: 'cancelled' }, 1],
        ['a job that does NOT depend on the sandbox was skipped', { lint: 'skipped', test: 'success' }, 1],
        ['a skip hides behind a sandbox skip', { lint: 'skipped', 'deploy-preview': 'skipped' }, 1],
        ['a failure beside an allowed skip', { lint: 'failure', 'deploy-preview': 'skipped' }, 1],
    ] as const)('%s', (_name, results, status) => {
        expect(run(needs(results), LIST).status).toBe(status);
    });

    it('names every job and its result in the log AND the job summary, and says why it failed', () => {
        const { out, summary } = run(needs({ lint: 'skipped', test: 'success', 'deploy-preview': 'skipped' }), LIST);

        for (const text of [out, summary]) {
            expect(text).toContain('lint');
            expect(text).toContain('test');
            expect(text).toContain('deploy-preview');
            expect(text).toContain('skipped');
        }

        expect(out).toMatch(/lint.*does not depend on the sandbox/);
    });

    it('treats an unknown or missing result as a failure — only success and skipped are green', () => {
        expect(run(needs({ lint: undefined }), LIST).status).toBe(1);
        expect(run('{"lint":{"result":"neutral"}}', LIST).status).toBe(1);
    });

    it('fails CLOSED on unusable input — an empty needs set would otherwise be a vacuous pass', () => {
        expect(run('{}', LIST).status).not.toBe(0);
        expect(run('not json', LIST).status).not.toBe(0);
        expect(run(undefined, LIST).status).not.toBe(0);
    });

    it('with no sandbox list, any skip fails', () => {
        expect(run(needs({ lint: 'success', 'deploy-preview': 'skipped' }), '').status).toBe(1);
    });
});
