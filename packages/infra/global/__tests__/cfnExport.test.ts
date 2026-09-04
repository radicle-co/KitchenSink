/**
 * Guards `.github/scripts/cfn-export.sh` — the ONE place a CloudFormation export is resolved by name.
 *
 * WHY THIS EXISTS. `ListExports` pages at 100 items and the AWS CLI applies `--query` to EACH PAGE,
 * printing one result per page. This account holds 196 exports, so the idiom every deploy workflow used —
 *
 *     aws cloudformation list-exports --query "Exports[?Name=='<name>'].Value | [0]" --output text
 *
 * — emits TWO lines: the value from the page holding the export, and the literal `None` from the page that
 * does not. Ten call sites across the sandbox, identity and PROD deploy workflows used it, none guarded.
 *
 * It fails in both directions, which is why it went unnoticed: a caller may capture `"VALUE\nNone"` and
 * pass a two-line string downstream, or capture `"None\nVALUE"` where the `= "None"` guard does not match
 * (it compares the whole two-line string) and the bad value is used, or see only `None` and abort a correct
 * deploy claiming the export is missing. Which happens depends on which page the export lands on — so it
 * changes as the account accumulates exports, with no repo change. `Publish sandbox preview address` hit
 * the abort case on PR #91 while `list-exports` demonstrably listed the export it said was absent.
 *
 * These tests drive the REAL script with a stub `aws` on PATH that reproduces the two-page output, rather
 * than reimplementing the pipeline in TypeScript — the same approach as the pr-scope and deploy-gate guards.
 * A test that reimplemented the logic would pass against the broken version.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const script = path.join(repoRoot, '.github/scripts/cfn-export.sh');

interface Result {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * Run the real script with a fake `aws` that prints `pages` — one line per page, exactly as the CLI does
 * when `--query` is applied per page.
 *
 * @sideEffect Creates a temp dir containing an executable `aws` stub and executes the script.
 */
function runWithPages(pages: readonly string[], exportName = 'kitchensink-domain-sandbox:HostedZoneId'): Result {
    const dir = mkdtempSync(path.join(tmpdir(), 'cfn-export-'));
    const stub = path.join(dir, 'aws');

    writeFileSync(stub, `#!/usr/bin/env bash\n${pages.map((page) => `echo '${page}'`).join('\n')}\n`);
    chmodSync(stub, 0o755);

    try {
        const stdout = execFileSync('bash', [script, exportName], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}` },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        return { code: 0, stdout, stderr: '' };
    } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };

        return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
}

describe('cfn-export.sh — paginated ListExports', () => {
    it('returns the value when the export is on the FIRST page', () => {
        const result = runWithPages(['Z0474040RGDAGYCWHZ7M', 'None']);

        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe('Z0474040RGDAGYCWHZ7M');
    });

    it('returns the value when the export is on a LATER page', () => {
        // The case the old idiom got wrong in the loudest way: it would capture "None\nVALUE".
        const result = runWithPages(['None', 'Z0474040RGDAGYCWHZ7M']);

        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe('Z0474040RGDAGYCWHZ7M');
    });

    it('returns exactly ONE line — never a multi-line value', () => {
        const result = runWithPages(['None', 'Z0474040RGDAGYCWHZ7M', 'None']);

        expect(result.stdout.trimEnd().split('\n')).toHaveLength(1);
    });

    it('FAILS loudly when the export exists on no page', () => {
        const result = runWithPages(['None', 'None']);

        expect(result.code).not.toBe(0);
        expect(result.stdout.trim()).toBe('');
        expect(result.stderr).toContain('not found');
    });

    it('does not exit 0 with empty output when every page is empty', () => {
        // grep exits 1 when nothing survives the filter; under `set -o pipefail` that must become the
        // reported "not found", not an unexplained abort and not a silent success.
        const result = runWithPages(['']);

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('not found');
    });

    it('names the export it could not find, so the failure is actionable', () => {
        const result = runWithPages(['None'], 'kitchensink-network-prod:VpcId');

        expect(result.stderr).toContain('kitchensink-network-prod:VpcId');
    });
});

/**
 * Run the real script with an arbitrary `aws` stub body — the CLI FAILING is the case the page-printing
 * runner above cannot express, and it is the case both review threads on this script are about.
 *
 * @sideEffect Creates a temp dir containing an executable `aws` stub and executes the script.
 */
function runWithStub(stubBody: string, args: readonly string[]): Result {
    const dir = mkdtempSync(path.join(tmpdir(), 'cfn-export-stub-'));
    const stub = path.join(dir, 'aws');

    writeFileSync(stub, `#!/usr/bin/env bash\n${stubBody}\n`);
    chmodSync(stub, 0o755);

    try {
        const stdout = execFileSync('bash', [script, ...args], {
            encoding: 'utf8',
            env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}` },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        return { code: 0, stdout, stderr: '' };
    } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };

        return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
}

/** The AWS CLI dying the way it does with no credentials: a message on stderr and exit 255. */
const CLI_FAILURE = `echo 'Unable to locate credentials. You can configure credentials by running "aws configure".' >&2
exit 255`;

const EXPORT = 'kitchensink-data-prod:DatabaseEndpoint';

/**
 * A lookup has THREE outcomes, not two. "Found" and "absent" are both answers; a CLI failure (no
 * credentials, no permission, no network) is not an answer at all, and the script must never dress it up as
 * "absent". Before this suite existed the pipeline folded the CLI's non-zero exit into an empty `value` and
 * reported "export not found" — in strict mode a wrong diagnosis, and under `--optional` a silent exit 0:
 * the swallowed-failure class every deploy workflow in this repo has a guard against.
 *
 * The statuses are part of the contract: 1 is "absent" (the only status `--optional` may tolerate), 2 is
 * "the lookup itself failed". A caller that wants to tell them apart can; `--optional` is the one that does.
 */
describe('cfn-export.sh — a CLI failure is neither "found" nor "absent"', () => {
    it('strict: reports the CLI failure, not "not found", and exits with the distinct failure status', () => {
        const result = runWithStub(CLI_FAILURE, [EXPORT]);

        expect(result.code).toBe(2);
        expect(result.stdout.trim()).toBe('');
        // The CLI's own diagnostic must survive to the log — it names the actual cause.
        expect(result.stderr).toContain('Unable to locate credentials');
        expect(result.stderr).not.toContain('not found');
    });

    it('strict: an absent export is status 1 — distinct from a CLI failure', () => {
        const result = runWithStub("echo 'None'", [EXPORT]);

        expect(result.code).toBe(1);
        expect(result.stderr).toContain('not found');
    });

    it('--optional: an absent export prints nothing and exits 0 (absence is a legitimate answer)', () => {
        const result = runWithStub("echo 'None'", ['--optional', EXPORT]);

        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe('');
        expect(result.stderr).not.toContain('::error::');
    });

    it('--optional: a present export is still printed', () => {
        const result = runWithStub("echo 'None'\necho 'db.example.internal'", ['--optional', EXPORT]);

        expect(result.code).toBe(0);
        expect(result.stdout.trim()).toBe('db.example.internal');
    });

    it('--optional: a CLI failure is NOT absence — it must not exit 0, and it must say why', () => {
        // The exact shape of the bug: `--optional` tolerated absence by tolerating everything.
        const result = runWithStub(CLI_FAILURE, ['--optional', EXPORT]);

        expect(result.code).toBe(2);
        expect(result.stdout.trim()).toBe('');
        expect(result.stderr).toContain('Unable to locate credentials');
    });
});
