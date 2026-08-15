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
