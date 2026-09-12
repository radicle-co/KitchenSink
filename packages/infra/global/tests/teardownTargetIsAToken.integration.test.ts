// @vitest-environment node
/**
 * Integration guard: whatever a caller COMPUTES, the value it hands the teardown is a `pr-{N}` token.
 *
 * ## What this replaces, and why
 *
 * `sandboxDestroyTargetSafety.test.ts` layer 3 asked a textual question — does any tier word appear on a
 * teardown path — by reading the workflow YAML. That catches the copy-paste it was written for, and a
 * review broke it by mutation while the suite stayed green: a caller that built its target by
 * concatenation, read it from a file, or routed it through `env:` indirection would pass, because the
 * literal never appears.
 *
 * The honest form of the question is not "is a forbidden word written down" but "what actually arrives at
 * the deletion script". That is answerable only by execution, so this file executes: each caller's real
 * `run:` body, under `bash -e` as Actions runs it, with `teardown-sandbox-pr.sh` replaced by a stub that
 * records every argument it is handed.
 *
 * ⛔ Layer 1 (the script's own `pr_scope_is_token`) is unaffected and remains the last line. This is
 * defence in depth being made real rather than advertised: layer 1 refuses a bad token at run time; this
 * asserts no caller produces one in the first place.
 *
 * ## The callers, and the hostile input each one can actually receive
 *
 * | caller | where its target comes from | what is fed here |
 * |---|---|---|
 * | `sandbox-deploy.yml` › `cleanup` | `pr-${{ github.event.pull_request.number }}` | stage names, spaces, globs |
 * | `sandbox-deploy.yml` › `reap-abandoned` | tokens discovered from AWS and `gh` | stack names carrying tier words |
 * | `sandbox-down.yml` › `down` | the `pr` dispatch input | covered in `sandboxDownReclaims` |
 *
 * ⚠️ `reap-abandoned` is the interesting one: its targets are DISCOVERED, so the hostile input is not a
 * human typing but an account containing `kitchensink-identity-service-sandbox` and
 * `kitchensink-data-prod`. Those must never reach the teardown, and the assertion is not that they are
 * refused later — it is that they are never handed over.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { repoRoot } from '../__tests__/serviceSources.js';

let workdir = '';

afterEach(() => {
    if (workdir !== '') {
        rmSync(workdir, { recursive: true, force: true });
        workdir = '';
    }
});

/** The `run:` body of the step in `<workflow>`'s `<job>` that invokes the teardown. */
function teardownStep(workflow: string, job: string): string {
    const doc = parse(readFileSync(path.join(repoRoot, '.github/workflows', workflow), 'utf8')) as {
        jobs: Record<string, { steps?: { run?: string }[] }>;
    };
    // ⚠️ A body that INVOKES the script, not merely one that mentions it. Every caller begins with
    // `chmod +x …teardown-sandbox-pr.sh`, so matching on the mention alone is right, but the earlier
    // version excluded any body whose FIRST line was a chmod — which is all of them.
    const invokes = (run: string): boolean =>
        run.split('\n').some((line) => line.includes('teardown-sandbox-pr.sh') && !/\bchmod\b/u.test(line));
    const body = (doc.jobs[job]?.steps ?? []).map((step) => step.run ?? '').find(invokes);

    if (body === undefined) {
        throw new Error(`${workflow}:${job} no longer has a step invoking teardown-sandbox-pr.sh`);
    }

    return body;
}

/**
 * Execute a caller's body with every external command stubbed, and report what the teardown was handed.
 *
 * @param body - The real `run:` text.
 * @param environment - Values the job would supply.
 * @param stubs - Extra executables to place ahead of the real ones on `PATH`.
 * @returns One entry per teardown invocation, in order.
 * @sideEffect Creates a temporary directory and runs bash in it.
 */
function targetsHandedToTeardown(
    body: string,
    environment: Record<string, string>,
    stubs: Record<string, string> = {},
): readonly string[] {
    workdir = mkdtempSync(path.join(tmpdir(), 'teardown-target-'));

    const scripts = path.join(workdir, '.github', 'scripts');
    const bin = path.join(workdir, 'bin');
    const log = path.join(workdir, 'handed-over');

    mkdirSync(scripts, { recursive: true });
    mkdirSync(bin, { recursive: true });

    // The stub that IS the assertion: it records its first argument and succeeds.
    writeFileSync(
        path.join(scripts, 'teardown-sandbox-pr.sh'),
        `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(log)}\nexit 0\n`,
    );
    chmodSync(path.join(scripts, 'teardown-sandbox-pr.sh'), 0o755);

    // Real helpers the bodies source for their scope rules — copied, never stubbed: the point is to run
    // the caller's OWN filtering, not a convenient imitation of it.
    for (const helper of ['pr-scope.sh', 'cfn-resting-states.sh']) {
        const source = path.join(repoRoot, '.github/scripts', helper);

        if (existsSync(source)) {
            writeFileSync(path.join(scripts, helper), readFileSync(source, 'utf8'));
            chmodSync(path.join(scripts, helper), 0o755);
        }
    }

    for (const [name, script] of Object.entries({ gh: 'exit 0', aws: 'exit 0', npx: 'exit 0', ...stubs })) {
        writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${script}\n`);
        chmodSync(path.join(bin, name), 0o755);
    }

    spawnSync('bash', ['-e', '-c', body], {
        cwd: workdir,
        encoding: 'utf8',
        env: { ...process.env, ...environment, PATH: `${bin}:${process.env['PATH'] ?? ''}` },
    });

    return existsSync(log)
        ? readFileSync(log, 'utf8')
              .split('\n')
              .filter((line) => line !== '')
        : [];
}

/** The one shape a teardown target may ever have. */
const TOKEN = /^pr-[0-9]+$/u;

describe('sandbox-deploy.yml › cleanup — the on-close path', () => {
    /**
     * ⚠️ WHAT THIS JOB ACTUALLY RELIES ON, measured rather than assumed.
     *
     * The first version of this test expected `cleanup` to FILTER a hostile target. It does not: it hands
     * `$PR` to the script verbatim, and `pr-prod`, `sandbox` and `pr-91 prod` all arrive there unchanged.
     * That is not a defect, but it is not the property the layer-3 docstring implied either — the job's
     * safety comes from two things it does not do itself:
     *
     *   1. its target is `pr-${{ github.event.pull_request.number }}`, and GitHub types that field as an
     *      integer, so the hostile value has no way in;
     *   2. layer 1 refuses anything that is not a token, at the script.
     *
     * So the honest assertions are: the value is passed through UNTRANSFORMED (nothing is smuggled in by
     * concatenation on the way), and a non-token that does arrive is refused by the real script rather than
     * acted on. Writing it the other way round would have recorded a guarantee this job does not give.
     */
    it.each([
        ['a normal PR number', 'pr-91'],
        ['a stage name in the number', 'pr-prod'],
        ['a tier word outright', 'sandbox'],
        ['an appended stage', 'pr-91 prod'],
    ])('passes %s through untransformed — no concatenation on the way', (_label, pr) => {
        const handed = targetsHandedToTeardown(teardownStep('sandbox-deploy.yml', 'cleanup'), {
            PR: pr,
            REGION: 'us-east-1',
        });

        expect(handed).toEqual([pr]);
    });

    it('⛔ and the REAL script refuses every non-token this job could pass it', () => {
        // The other half, run against the actual `teardown-sandbox-pr.sh` rather than the stub — because
        // "cleanup does not validate" is only safe if something downstream does.
        for (const hostile of ['pr-prod', 'sandbox', 'pr-91 prod', 'prod']) {
            const result = spawnSync('bash', [path.join(repoRoot, '.github/scripts/teardown-sandbox-pr.sh'), hostile], {
                encoding: 'utf8',
                timeout: 20_000,
                env: { ...process.env, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_PROFILE: '' },
            });

            expect(result.status, `${hostile} was not refused`).toBe(2);
        }
    });
});

describe('sandbox-deploy.yml › reap-abandoned — the discovered path', () => {
    it('⛔ never hands over a shared or production stack it discovered', () => {
        // The hostile input here is not a human — it is an ACCOUNT. These are real stack names from the
        // live account, alongside one genuine preview, and the sweep must pick out exactly the preview.
        const discovered = [
            'kitchensink-identity-service-sandbox',
            'kitchensink-data-prod',
            'kitchensink-alb-sandbox',
            'kitchensink-cost-guardrails',
            'kitchensink-recipe-service-pr-91',
        ].join('\t');

        const handed = targetsHandedToTeardown(
            teardownStep('sandbox-deploy.yml', 'reap-abandoned'),
            {
                REGION: 'us-east-1',
                // ⚠️ Every variable the body reads must be present: it runs under `set -u`, so one missing
                // name aborts before the loop and the sweep hands over NOTHING — which is precisely the
                // vacuous pass the positive control below exists to catch. `REPOSITORY` was the one missing.
                REPOSITORY: 'radicle-co/KitchenSink',
                GH_TOKEN: 'stub',
                PREVIEW_HOSTED_ZONE_ID: 'Z0',
                STALE_DAYS: '7',
                STALE_ORPHAN_DAYS: '3',
            },
            {
                aws: `printf '%s' ${JSON.stringify(discovered)}`,
                // Every PR reads as closed long ago, so the sweep is maximally eager to reap.
                gh: `printf '%s' '{"state":"closed","closed_at":"2020-01-01T00:00:00Z","updated_at":"2020-01-01T00:00:00Z"}'`,
            },
        );

        // ⛔ THE POSITIVE CONTROL FIRST. Without it this assertion is vacuous: a sweep that hands over
        // NOTHING satisfies "hands over no shared stack" perfectly, and the first version of this test did
        // exactly that — a mutation that removed the `pr-[0-9]+` filter entirely left it green.
        expect(handed, 'the sweep reached no teardown at all, so this proves nothing').toContain('pr-91');
        expect(handed.filter((target) => !TOKEN.test(target))).toEqual([]);
    });
});
