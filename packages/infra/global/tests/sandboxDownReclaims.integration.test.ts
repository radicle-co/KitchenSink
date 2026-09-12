// @vitest-environment node
/**
 * Integration guard: `Sandbox Down` still reclaims infrastructure when the DNS lookup fails.
 *
 * ## Why this tier, and not a static check
 *
 * `sandboxReclamationReachability.test.ts` reads the workflow and asks structural questions — is the
 * teardown skip-tolerant, does a predecessor deliberately abort. It cannot answer the question that
 * actually matters here, because that question is about SHELL SEMANTICS:
 *
 *   > when the hosted-zone lookup exits non-zero, does the teardown still run?
 *
 * The answer turns on a detail no structural reader sees: GitHub executes a `run:` body under
 * `/usr/bin/bash -e {0}`, so `-e` arrives from the CALLER. `set -uo pipefail` at the top of the body ADDS
 * to it — it does not clear it — so a bare `VAR=$(failing command)` terminates the step. Every "there is no
 * `-e` here, so it falls through" reading of this repository's workflows is backwards, and this file exists
 * to settle it by execution rather than by argument.
 *
 * ## The incident
 *
 * 2026-07-28: a hosted-zone lookup was placed ahead of the teardown, failed for a reason unrelated to
 * teardown, and took the whole sweep with it. 9 merged PRs were never reclaimed, 27 Fargate tasks kept
 * billing for closed work, and the daily reaper failed 11 times in a row at the same step. The lesson was
 * recorded as an ordering rule; the SAME outcome is reachable without any ordering violation, by letting the
 * lookup abort the step it lives inside. That is what this asserts.
 *
 * ## How it runs
 *
 * The real `run:` body is lifted out of the workflow YAML, `PATH` is pointed at stubs, and it is executed
 * under `bash -e` exactly as Actions would. The stub for `cfn-export.sh` exits non-zero; the stub for the
 * teardown records that it was called. Nothing touches AWS — the stubs are the boundary.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from '../__tests__/serviceSources.js';

const WORKFLOW = path.join(repoRoot, '.github/workflows/sandbox-down.yml');
const workspaces: string[] = [];

afterAll(() => {
    for (const dir of workspaces) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** The `run:` body of the step that tears a preview down, taken from the workflow itself. */
function teardownStepBody(): string {
    const doc = parse(readFileSync(WORKFLOW, 'utf8')) as {
        jobs: Record<string, { steps: { run?: string }[] }>;
    };
    const body = Object.values(doc.jobs)
        .flatMap((job) => job.steps)
        .map((step) => step.run ?? '')
        .find((run) => run.includes('teardown-sandbox-pr.sh'));

    if (body === undefined) {
        throw new Error('sandbox-down.yml no longer has a step running teardown-sandbox-pr.sh');
    }

    return body;
}

/**
 * Run the real step body with the two external commands stubbed.
 *
 * @param lookupExit - What the hosted-zone lookup exits with. 0 is the happy path; non-zero is the case
 *   this file exists for.
 * @returns Whether the teardown was reached, plus the body's own exit status.
 */
function runStep(
    lookupExit: number,
    prNumber = '999999',
): { readonly teardownRan: boolean; readonly status: number | null; readonly target: string } {
    const workspace = mkdtempSync(path.join(tmpdir(), 'sandbox-down-'));

    workspaces.push(workspace);

    const scripts = path.join(workspace, '.github', 'scripts');

    spawnSync('mkdir', ['-p', scripts]);

    const marker = path.join(workspace, 'teardown-was-called');

    writeFileSync(path.join(scripts, 'cfn-export.sh'), `#!/usr/bin/env bash\nexit ${lookupExit}\n`);
    writeFileSync(
        path.join(scripts, 'teardown-sandbox-pr.sh'),
        `#!/usr/bin/env bash\nprintf '%s' "$1" > ${JSON.stringify(marker)}\nexit 0\n`,
    );
    chmodSync(path.join(scripts, 'cfn-export.sh'), 0o755);
    chmodSync(path.join(scripts, 'teardown-sandbox-pr.sh'), 0o755);

    // ⛔ `bash -e`, because that is what GitHub does (`/usr/bin/bash -e {0}`). Running this under a bare
    // `bash` would make the test pass for a body that fails in CI — the precise inversion this file exists
    // to prevent.
    const result = spawnSync('bash', ['-e', '-c', teardownStepBody()], {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...process.env, PR_NUMBER: prNumber, REGION: 'us-east-1' },
    });

    return { teardownRan: existsQuietly(marker), status: result.status, target: readQuietly(marker) };
}

function readQuietly(file: string): string {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        return '';
    }
}

function existsQuietly(file: string): boolean {
    try {
        readFileSync(file);

        return true;
    } catch {
        return false;
    }
}

describe('Sandbox Down reclaims infrastructure even when the DNS lookup fails', () => {
    it('reaches the teardown on the happy path', () => {
        // The control. Without it, a body that never reaches the teardown for an unrelated reason would
        // make the assertion below pass for the wrong reason.
        expect(runStep(0).teardownRan).toBe(true);
    });

    it('⛔ still reaches the teardown when the hosted-zone lookup EXITS NON-ZERO', () => {
        // The 2026-07-28 shape. A DNS lookup must never be able to cancel the reclamation of stacks,
        // databases, ECR repositories and log groups — none of which need a hosted zone.
        expect(runStep(3).teardownRan).toBe(true);
    });

    it('builds the token from the digits, so the teardown is aimed at pr-{N}', () => {
        // The positive half of layer 2: not merely "hostile input is refused" but "a legitimate number
        // produces the token the teardown expects". Without this, a validation that rejected EVERYTHING
        // would satisfy every assertion below while reclaiming nothing.
        expect(runStep(0, '91').target).toBe('pr-91');
    });
});

/**
 * ⛔ LAYER 2 of the three in `sandbox-down.yml`'s header, asserted as BEHAVIOUR rather than as shape.
 *
 * `sandboxDestroyTargetSafety.test.ts` proves layer 1 by spawning the teardown script at hostile tokens,
 * and layer 3 by reading the workflows. Layer 2 — "no caller can express a target that is not a PR number"
 * — was asserted only as a SHAPE: that the argument is a shell variable. Nothing ran a hostile value
 * through the step and watched it be refused, which means the claim in the file's header was prose.
 *
 * `workflow_dispatch` types every input as a string whatever `type:` says, so `pr` arrives as literally what
 * a human typed into the box.
 */
describe('layer 2 — the step refuses anything that is not digits, before the teardown', () => {
    it.each([
        ['a stage name', 'prod'],
        ['the shared tier', 'sandbox'],
        ['a number with a stage appended', '91 prod'],
        ['path traversal', '../..'],
        ['a glob', '*'],
        ['empty', ''],
        ['a token rather than a number', 'pr-91'],
        ['a negative', '-1'],
        ['a command substitution', '$(echo 91)'],
    ])('refuses %s', (_label, prNumber) => {
        const { teardownRan, status } = runStep(0, prNumber);

        expect(teardownRan, `the teardown RAN for ${JSON.stringify(prNumber)}`).toBe(false);
        expect(status).not.toBe(0);
    });
});
