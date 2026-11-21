// @vitest-environment node
/**
 * Repo-wide guard: **`gate.yml` retries the judge once, and only when the judge finished but gave no structured result.**
 *
 * The judge (`anthropics/claude-code-action` with `--json-schema`) sometimes ends in a prose report and never calls the
 * structured output tool. The action then fails the step with "--json-schema was provided but Claude did not return
 * structured_output. Result subtype: success", and the GATE posted `failure` on 7 of 7 sampled runs. The fix has two
 * parts: the prompt's closing paragraph says the final action MUST be the structured output, and the `retry` step
 * reads the action's execution file and allows ONE more judge run for exactly that shape. Every other failure (a
 * timeout, `error_max_turns`, an error result, a missing file) stays fail-closed with no retry (ADR-0098 decision 6).
 *
 * The retry rule is a `jq` filter held in the `retry` step's `env`, so this test runs the very text CI runs against
 * fixtures of the execution file. Nothing else about the model can be proved offline: see the PR for the live runs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const GATE_YML = path.join(repoRoot, '.github/workflows/gate.yml');

interface Step {
    readonly id?: string;
    readonly name?: string;
    readonly if?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly env?: Record<string, string>;
    readonly with?: Record<string, string>;
    readonly 'continue-on-error'?: boolean;
    readonly 'timeout-minutes'?: number;
}

const steps: readonly Step[] = (parse(readFileSync(GATE_YML, 'utf8')) as { jobs: { gate: { steps: Step[] } } }).jobs
    .gate.steps;

const step = (id: string): Step => {
    const found = steps.find((candidate) => candidate.id === id);

    if (found === undefined) {
        throw new Error(`gate.yml has no step with id ${id}`);
    }

    return found;
};

const judgeSteps = steps.filter((candidate) => candidate.uses?.startsWith('anthropics/claude-code-action@'));

const dirs: string[] = [];

afterAll(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** Whether the `retry` step's filter allows a retry for this execution file text; a missing file is `undefined`. */
function retryAllowed(executionFile: string | undefined): boolean {
    const filter = step('retry').env?.['RETRY_FILTER'];

    if (filter === undefined) {
        throw new Error('the retry step has no RETRY_FILTER');
    }

    const dir = mkdtempSync(path.join(tmpdir(), 'gateJudgeRetry-'));
    dirs.push(dir);
    const file = path.join(dir, 'claude-execution-output.json');

    if (executionFile !== undefined) {
        writeFileSync(file, executionFile);
    }

    return spawnSync('/usr/bin/jq', ['-e', filter, file], { encoding: 'utf8' }).status === 0;
}

/** Runs the `retry` step's own shell with a temp RUNNER_TEMP and GITHUB_OUTPUT, and returns what it wrote to the output. */
function retryStepOutput(executionFile: string | undefined): string {
    const retry = step('retry');
    const dir = mkdtempSync(path.join(tmpdir(), 'gateJudgeRetryStep-'));
    dirs.push(dir);
    const output = path.join(dir, 'output');

    if (executionFile !== undefined) {
        writeFileSync(path.join(dir, 'claude-execution-output.json'), executionFile);
    }

    const run = spawnSync('/bin/bash', ['-c', retry.run ?? ''], {
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', RUNNER_TEMP: dir, GITHUB_OUTPUT: output, ...retry.env },
    });

    expect(run.status, run.stderr).toBe(0);

    return readFileSync(output, 'utf8');
}

/**
 * Runs the verdict step's own shape check on a judge output, with the local jq, and returns what it did: `failed` when it
 * posted the fail-closed status, `accepted` when it let the output through to the record.
 */
function verdictCheck(structuredOutput: string): 'failed' | 'accepted' {
    const verdict = step('verdict');
    const check = /^\s*if ! .*\bjq\b.*; then\n[\s\S]*?^\s*fi\n/mu.exec(verdict.run ?? '');

    if (check === null) {
        throw new Error('the verdict step has no jq shape check');
    }

    const script = `post() { echo "posted $*"; }\n${check[0]}\necho accepted\n`;
    const run = spawnSync('/bin/bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...verdict.env, PATH: '/usr/bin:/bin', STRUCTURED_OUTPUT: structuredOutput },
    });

    return run.stdout.includes('posted failure') ? 'failed' : 'accepted';
}

const result = (fields: Record<string, unknown>): string =>
    JSON.stringify([{ type: 'system', subtype: 'init' }, { type: 'assistant' }, { type: 'result', ...fields }]);

describe('gate.yml judge retry', () => {
    it('runs the judge action exactly twice: the judge and one retry, never a loop', () => {
        expect(judgeSteps.map((candidate) => candidate.id)).toEqual(['judge', 'judge-retry']);
    });

    it('lets the job reach the retry: the first judge may fail without ending the job', () => {
        expect(step('judge')['continue-on-error']).toBe(true);
    });

    it('retries only when the retry step says so, and only after the first judge failed', () => {
        const condition = step('judge-retry').if ?? '';

        expect(condition).toContain("steps.retry.outputs.retry == 'true'");
        expect(step('retry').if ?? '').toContain("steps.judge.outcome == 'failure'");
    });

    it('does not start a judge for a run a newer push cancelled: both new steps use !cancelled(), not always()', () => {
        for (const id of ['retry', 'judge-retry']) {
            // Mutation: always() would run a full model judge for a head nobody waits for.
            expect(step(id).if, id).toContain('!cancelled()');
            expect(step(id).if, id).not.toContain('always()');
        }
    });

    it('gives both judge steps the same action, tools, model, schema and trust settings', () => {
        const [first, second] = judgeSteps;

        expect(second?.uses).toBe(first?.uses);
        expect(second?.with?.['claude_args']).toBe(first?.with?.['claude_args']);
        expect(second?.with?.['allowed_non_write_users']).toBe(first?.with?.['allowed_non_write_users']);
        expect(second?.with?.['claude_code_oauth_token']).toBe(first?.with?.['claude_code_oauth_token']);
    });

    it('limits the retry as the first judge is limited, so a hung retry cannot run to the six hour default', () => {
        expect(judgeSteps[0]?.['timeout-minutes']).toBeGreaterThan(0);
        expect(judgeSteps[1]?.['timeout-minutes']).toBe(judgeSteps[0]?.['timeout-minutes']);
    });

    it('keeps the retry prompt equal to the judge prompt plus one closing paragraph', () => {
        const first = (judgeSteps[0]?.with?.['prompt'] ?? '').trimEnd();
        const second = (judgeSteps[1]?.with?.['prompt'] ?? '').trimEnd();

        expect(first.length).toBeGreaterThan(0);
        expect(second.startsWith(first)).toBe(true);
        expect(second.length).toBeGreaterThan(first.length);
    });

    it('ends the judge prompt by requiring the structured output, so prose alone is a failed GATE', () => {
        const prompt = judgeSteps[0]?.with?.['prompt'] ?? '';
        const closing =
            prompt
                .trimEnd()
                .split(/\n\s*\n/u)
                .at(-1) ?? '';

        expect(closing).toMatch(/final\s+action\s+MUST\s+be\s+the\s+structured\s+output/u);
        expect(closing).toMatch(/prose\s+report\s+alone/u);
    });

    it('reads the retry answer in the verdict step through env, never an expression inside run', () => {
        const verdict = step('verdict');

        for (const name of ['STRUCTURED_OUTPUT', 'JUDGE_OUTCOME']) {
            const value = verdict.env?.[name] ?? '';

            expect(value, name).toContain('judge-retry');
            expect(value, name).toContain('steps.judge.');
        }

        for (const id of ['retry', 'verdict']) {
            expect(step(id).run ?? '', `${id} run`).not.toContain('${{');
        }
    });

    describe('the retry filter', () => {
        it('retries a judge that finished with a success result and no structured output', () => {
            expect(retryAllowed(result({ subtype: 'success', is_error: false, num_turns: 16 }))).toBe(true);
        });

        it('does not retry a result that has the structured output', () => {
            expect(
                retryAllowed(
                    result({
                        subtype: 'success',
                        is_error: false,
                        structured_output: { verdict: 'PASS', findings: [] },
                    }),
                ),
            ).toBe(false);
        });

        it.each(['error_max_turns', 'error_during_execution', 'error_max_structured_output_retries'])(
            'does not retry %s',
            (subtype) => {
                expect(retryAllowed(result({ subtype, is_error: true }))).toBe(false);
            },
        );

        it('does not retry a success result that reports is_error', () => {
            expect(retryAllowed(result({ subtype: 'success', is_error: true }))).toBe(false);
        });

        it('does not retry a run with no result entry, an empty file or a missing file', () => {
            expect(retryAllowed(JSON.stringify([{ type: 'system', subtype: 'init' }]))).toBe(false);
            expect(retryAllowed('[]')).toBe(false);
            expect(retryAllowed(undefined)).toBe(false);
        });

        it('reads the last result entry, not an earlier one', () => {
            const earlier = { type: 'result', subtype: 'success', is_error: false };
            const later = { type: 'result', subtype: 'error_max_turns', is_error: true };

            expect(retryAllowed(JSON.stringify([earlier, later]))).toBe(false);
        });

        it.each(['error_max_turns', 'error_during_execution', 'error_max_structured_output_retries'])(
            'does not retry %s even when it does not report is_error',
            (subtype) => {
                // Mutation: drop the subtype test, and an error subtype that leaves is_error false is retried.
                expect(retryAllowed(result({ subtype, is_error: false }))).toBe(false);
            },
        );

        it('finds the result entry wherever it is, not only at the end of the file', () => {
            const messages = [
                { type: 'system', subtype: 'init' },
                { type: 'result', subtype: 'success', is_error: false },
                { type: 'system', subtype: 'cleanup' },
            ];

            // Mutation: drop the select on type, and the last entry (not a result) is read instead.
            expect(retryAllowed(JSON.stringify(messages))).toBe(true);
        });
    });

    describe('the retry step`s own shell', () => {
        it('writes retry=true for the retry shape', () => {
            expect(retryStepOutput(result({ subtype: 'success', is_error: false }))).toBe('retry=true\n');
        });

        it('writes retry=false for an error shape, a result with structured output and a missing file', () => {
            expect(retryStepOutput(result({ subtype: 'error_max_turns', is_error: true }))).toBe('retry=false\n');
            expect(
                retryStepOutput(
                    result({ subtype: 'success', is_error: false, structured_output: { verdict: 'PASS' } }),
                ),
            ).toBe('retry=false\n');
            expect(retryStepOutput(undefined)).toBe('retry=false\n');
        });
    });

    describe('the verdict step`s shape check', () => {
        // jq 1.6 exits 0 for `printf '' | jq -e <filter>`, so the check must refuse an empty or invalid output itself.
        it.each([
            ['an empty output', ''],
            ['text that is not JSON', 'not json'],
            ['a verdict with no findings', '{"verdict":"PASS"}'],
            ['a verdict that is neither PASS nor BLOCK', '{"verdict":"MAYBE","findings":[]}'],
            ['findings that are not a list', '{"verdict":"PASS","findings":{}}'],
        ])('fails closed on %s', (_name, output) => {
            expect(verdictCheck(output)).toBe('failed');
        });

        it.each([
            ['a PASS', '{"verdict":"PASS","findings":[]}'],
            [
                'a BLOCK with a finding',
                '{"verdict":"BLOCK","findings":[{"severity":"blocking","title":"t","detail":"d"}]}',
            ],
        ])('lets %s through', (_name, output) => {
            expect(verdictCheck(output)).toBe('accepted');
        });
    });
});
