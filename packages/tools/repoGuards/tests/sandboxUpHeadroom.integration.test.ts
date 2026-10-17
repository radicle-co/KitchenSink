// @vitest-environment node
/**
 * Integration: Sandbox Up refuses a press inside the pre-midnight headroom (ADR-0060).
 *
 * The step SOURCES `sandboxWake.sh` and runs under GitHub's `bash -e`, so two things only execution can show: that
 * sourcing the script does not kill the step, and that the verdict really refuses a late press and admits an early
 * one. The real `run:` body is lifted from the workflow and executed with only the clock stubbed — `date +%s` answers
 * a fixed instant and every other `date` call goes to the real binary, so the time-zone arithmetic under test is the
 * script's own.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from '../__tests__/serviceSources.js';

const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** The `run:` body of Sandbox Up's headroom refusal, taken from the workflow itself. */
function headroomStep(): string {
    const doc = parse(readFileSync(path.join(repoRoot, '.github/workflows/sandboxUp.yml'), 'utf8')) as {
        jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
    };
    const body = (doc.jobs['start']?.steps ?? []).find((step) => step.name?.startsWith('Refuse a start'))?.run;

    if (body === undefined) {
        throw new Error('sandboxUp.yml no longer has the headroom refusal step');
    }

    return body;
}

/** Run the step at the instant `iso`, under `bash -e` as Actions does. */
function pressAt(iso: string): { readonly status: number | null; readonly stderr: string } {
    const workspace = mkdtempSync(path.join(tmpdir(), 'sandbox-up-headroom-'));
    workspaces.push(workspace);
    const epoch = Math.floor(Date.parse(iso) / 1000);

    writeFileSync(
        path.join(workspace, 'date'),
        `#!/usr/bin/env bash\nif [ "$#" -eq 1 ] && [ "$1" = '+%s' ]; then echo ${epoch}; else exec /usr/bin/date "$@"; fi\n`,
    );
    chmodSync(path.join(workspace, 'date'), 0o755);
    writeFileSync(path.join(workspace, 'step.sh'), headroomStep());

    const result = spawnSync('/usr/bin/bash', ['-e', path.join(workspace, 'step.sh')], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { PATH: `${workspace}:${process.env['PATH'] ?? ''}`, HOME: workspace },
    });

    return { status: result.status, stderr: result.stderr };
}

describe('Sandbox Up — the pre-midnight headroom', () => {
    it('admits a press at noon, America/New_York', () => {
        expect(pressAt('2026-10-12T12:00:00-04:00').status).toBe(0);
    });

    it('⛔ refuses a press twenty minutes before the midnight stop, and says why', () => {
        const result = pressAt('2026-10-12T23:40:00-04:00');

        expect(result.status).toBe(1);
        expect(result.stderr).toContain('too close to the midnight stop');
    });
});
