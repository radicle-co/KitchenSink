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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const jobTimeout = (parse(readFileSync(GATE_YML, 'utf8')) as { jobs: { gate: { 'timeout-minutes': number } } }).jobs
    .gate['timeout-minutes'];

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

    const run = spawnSync('/usr/bin/jq', ['-e', filter, file], { encoding: 'utf8' });

    // A missing jq must fail the test, not read as "no retry".
    expect(run.error).toBeUndefined();

    return run.status === 0;
}

/** Runs the `retry` step's own shell with a temp RUNNER_TEMP and GITHUB_OUTPUT, and returns what it wrote to the output. */
function retryStepOutput(executionFile: string | undefined, judgeOutput = ''): string {
    const retry = step('retry');
    const dir = mkdtempSync(path.join(tmpdir(), 'gateJudgeRetryStep-'));
    dirs.push(dir);
    const output = path.join(dir, 'output');

    if (executionFile !== undefined) {
        writeFileSync(path.join(dir, 'claude-execution-output.json'), executionFile);
    }

    const run = spawnSync('/bin/bash', ['-c', retry.run ?? ''], {
        encoding: 'utf8',
        env: {
            PATH: '/usr/bin:/bin',
            RUNNER_TEMP: dir,
            GITHUB_OUTPUT: output,
            ...retry.env,
            JUDGE_OUTPUT: judgeOutput,
        },
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
    const runLines = (verdict.run ?? '').split('\n');
    const start = runLines.findIndex((line) => line.trimStart().startsWith('if !') && line.includes('jq'));
    const end = runLines.findIndex((line, index) => index > start && line.trim() === 'fi');

    if (start === -1 || end === -1) {
        throw new Error('the verdict step has no jq shape check');
    }

    const script = `post() { echo "posted $*"; }\n${runLines.slice(start, end + 1).join('\n')}\necho accepted\n`;
    const run = spawnSync('/bin/bash', ['-c', script], {
        encoding: 'utf8',
        env: { ...verdict.env, PATH: '/usr/bin:/bin', STRUCTURED_OUTPUT: structuredOutput },
    });

    expect(run.error).toBeUndefined();

    if (run.status === 0 && run.stdout.includes('posted failure')) {
        return 'failed';
    }

    // Accepted only when the script ran to its end: exit 0 and the last line is `accepted`.
    return run.status === 0 && run.stdout.trimEnd().endsWith('accepted') ? 'accepted' : 'failed';
}

interface ChoiceInput {
    readonly retryRan: string;
    readonly retryOutcome: string;
    readonly retryOutput: string;
    readonly firstOutcome: string;
    readonly firstOutput?: string;
}

/**
 * Runs the verdict step's own selection block and returns what it chose: `<outcome> <output>`, or the fail-closed
 * description that names the run that failed.
 */
function verdictChoice(input: ChoiceInput): string {
    const run = (step('verdict').run ?? '').split('\n');
    const start = run.findIndex((line) => line.includes('RETRY_RAN'));
    const end = run.findIndex((line, index) => index > start && line.trim() === 'fi');

    if (start === -1 || end === -1) {
        throw new Error('the verdict step has no selection block on RETRY_RAN');
    }

    const script = [
        ...run.slice(start, end + 1),
        'if [ "$JUDGE_OUTCOME" != success ]; then',
        '    echo "failed: $WHICH step ended as $JUDGE_OUTCOME"',
        'else',
        `    printf '%s %s' "$JUDGE_OUTCOME" "$STRUCTURED_OUTPUT"`,
        'fi',
    ].join('\n');
    const out = spawnSync('/bin/bash', ['-c', script], {
        encoding: 'utf8',
        env: {
            PATH: '/usr/bin:/bin',
            FIRST_OUTCOME: input.firstOutcome,
            FIRST_OUTPUT: input.firstOutput ?? '',
            RETRY_RAN: input.retryRan,
            RETRY_OUTCOME: input.retryOutcome,
            RETRY_OUTPUT: input.retryOutput,
        },
    });

    expect(out.error).toBeUndefined();
    expect(out.status, out.stderr).toBe(0);

    return out.stdout;
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

    it('retries only when the retry step says so, and only after the first judge failed or finished without an output', () => {
        const condition = step('judge-retry').if ?? '';

        expect(condition).toContain("steps.retry.outputs.retry == 'true'");
        expect(step('retry').if ?? '').toContain("steps.judge.outcome == 'failure'");
    });

    it('also runs the retry check when the judge SUCCEEDED with an empty structured output, and only then', () => {
        // The action fails the step when it lacks the structured output, but a step can also succeed with none: the
        // run that posted `failure` with FIRST_OUTCOME=success and an empty FIRST_OUTPUT was that shape.
        expect(step('retry').if).toBe(
            "${{ !cancelled() && (steps.judge.outcome == 'failure' || (steps.judge.outcome == 'success' && steps.judge.outputs.structured_output == '')) }}",
        );
    });

    it('hands the retry step the first judge output through env, so bash decides on a real empty string', () => {
        expect(step('retry').env?.['JUDGE_OUTPUT']).toBe('${{ steps.judge.outputs.structured_output }}');
    });

    it('does not start a judge for a run a newer push cancelled: both new steps use !cancelled(), not always()', () => {
        for (const id of ['retry', 'judge-retry']) {
            // Mutation: always() would run a full model judge for a head nobody waits for.
            expect(step(id).if, id).toContain('!cancelled()');
            expect(step(id).if, id).not.toContain('always()');
        }
    });

    it('gives both judge steps the same action, tools, model, schema and trust settings', () => {
        expect(judgeSteps).toHaveLength(2);

        const [first, second] = judgeSteps;

        expect(second.uses).toBe(first.uses);
        expect(second.with?.['claude_args']).toBe(first.with?.['claude_args']);
        expect(second.with?.['allowed_non_write_users']).toBe(first.with?.['allowed_non_write_users']);
        expect(second.with?.['claude_code_oauth_token']).toBe(first.with?.['claude_code_oauth_token']);
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

    it('reads both judge answers in the verdict step through env and chooses between them in bash', () => {
        const verdict = step('verdict');
        const env = verdict.env ?? {};

        expect(env['FIRST_OUTCOME']).toBe('${{ steps.judge.outcome }}');
        expect(env['FIRST_OUTPUT']).toBe('${{ steps.judge.outputs.structured_output }}');
        expect(env['RETRY_RAN']).toBe('${{ steps.retry.outputs.retry }}');
        expect(env['RETRY_OUTCOME']).toBe('${{ steps.judge-retry.outcome }}');
        expect(env['RETRY_OUTPUT']).toBe('${{ steps.judge-retry.outputs.structured_output }}');

        for (const name of ['JUDGE_OUTCOME', 'STRUCTURED_OUTPUT']) {
            // No `a && b || c` fallback to the first run's answer: the choice is made in the script.
            expect(env[name], name).toBeUndefined();
        }

        for (const id of ['retry', 'verdict']) {
            expect(step(id).run ?? '', `${id} run`).not.toContain('${{');
        }
    });

    it('names which run failed, and picks the retry answer only when the retry ran', () => {
        expect(
            verdictChoice({ retryRan: 'true', retryOutcome: 'failure', retryOutput: '', firstOutcome: 'success' }),
        ).toMatch(/retry judge.*failure/u);
        expect(
            verdictChoice({
                retryRan: 'true',
                retryOutcome: 'success',
                retryOutput: '{"a":1}',
                firstOutcome: 'failure',
            }),
        ).toBe('success {"a":1}');
        // The retry ran but produced nothing: the first run's output must NOT stand in for it.
        expect(
            verdictChoice({
                retryRan: 'true',
                retryOutcome: 'success',
                retryOutput: '',
                firstOutcome: 'success',
                firstOutput: '{"v":"PASS"}',
            }),
        ).toBe('success ');
        // The first judge SUCCEEDED with no output and the retry ran: the retry's answer is the one that counts.
        expect(
            verdictChoice({
                retryRan: 'true',
                retryOutcome: 'success',
                retryOutput: '{"verdict":"PASS","findings":[]}',
                firstOutcome: 'success',
                firstOutput: '',
            }),
        ).toBe('success {"verdict":"PASS","findings":[]}');
        // The first judge succeeded with no output and no retry ran: the choice is empty, which the shape check fails closed.
        expect(
            verdictChoice({
                retryRan: 'false',
                retryOutcome: '',
                retryOutput: '',
                firstOutcome: 'success',
                firstOutput: '',
            }),
        ).toBe('success ');
        expect(verdictChoice({ retryRan: '', retryOutcome: '', retryOutput: '', firstOutcome: 'failure' })).toMatch(
            /first judge.*failure/u,
        );
        expect(
            verdictChoice({
                retryRan: '',
                retryOutcome: '',
                retryOutput: '',
                firstOutcome: 'success',
                firstOutput: '{"v":1}',
            }),
        ).toBe('success {"v":1}');
    });

    it('keeps the job timeout at least the sum of the step limits', () => {
        const total = steps.reduce((sum, candidate) => sum + (candidate['timeout-minutes'] ?? 0), 0);

        expect(jobTimeout).toBeGreaterThanOrEqual(total);
    });

    describe('the retry filter', () => {
        it('retries a judge that finished with a success result and no structured output', () => {
            expect(retryAllowed(result({ subtype: 'success', is_error: false, num_turns: 16 }))).toBe(true);
        });

        it('does not retry when the first run already wrote BLOCK in prose: a retry would re-roll the verdict', () => {
            const prose = result({
                subtype: 'success',
                is_error: false,
                result: 'Verdict: BLOCK. The diff adds a cast.',
            });

            expect(retryAllowed(prose)).toBe(false);
            expect(retryStepOutput(prose)).toBe('retry=false\n');
        });

        it('still retries a prose result that never says BLOCK', () => {
            expect(retryAllowed(result({ subtype: 'success', is_error: false, result: 'Verdict: PASS.' }))).toBe(true);
        });

        it('does not retry a run that ended over the turn limit', () => {
            expect(retryAllowed(result({ subtype: 'error_max_turns', is_error: false, num_turns: 61 }))).toBe(false);
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

        it('retries a judge that succeeded with an empty output: only the empty string counts as empty', () => {
            const finished = result({ subtype: 'success', is_error: false });

            expect(retryStepOutput(finished, '')).toBe('retry=true\n');
        });

        // A judge that gave ANY output is not retried, valid or not: the verdict step fails an invalid one closed, and a
        // retry of a BLOCK would re-roll the verdict (a verdict exists, so there is nothing missing to ask for again).
        it.each([
            ['an empty object', '{}'],
            ['the text null', 'null'],
            ['a verdict with no findings', '{"verdict":"PASS"}'],
            ['a PASS', '{"verdict":"PASS","findings":[]}'],
            ['a BLOCK', '{"verdict":"BLOCK","findings":[{"severity":"blocking","title":"t","detail":"d"}]}'],
        ])('does not retry when the judge gave %s as its output', (_name, judgeOutput) => {
            const finished = result({ subtype: 'success', is_error: false });

            expect(retryStepOutput(finished, judgeOutput)).toBe('retry=false\n');
        });

        it('does not retry when the judge succeeded with an empty output but left no execution file: the verdict fails closed', () => {
            expect(retryStepOutput(undefined, '')).toBe('retry=false\n');
        });

        it('does not retry an empty output whose prose says BLOCK, and does not retry an error result', () => {
            expect(
                retryStepOutput(result({ subtype: 'success', is_error: false, result: 'BLOCK: a finding' }), ''),
            ).toBe('retry=false\n');
            expect(retryStepOutput(result({ subtype: 'error_max_turns', is_error: true }), '')).toBe('retry=false\n');
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

/**
 * The retry check names which filter clause decided, so the next crash can be told apart: the judge's prose said BLOCK
 * (H1), `structured_output` was `""` or `false` (H2), or jq itself failed and the failure read as "no retry" (H3). Only
 * booleans, exit codes and type names reach the log and the artifact. The prose is model output steered by the diff,
 * so a line of it that starts with `::` would be a runner command: it must never be printed or uploaded.
 */
describe('the retry evidence', () => {
    const PROSE = '::add-mask::leaky SECRET-PROSE-MARKER no BLOCK here';

    interface EvidenceRun {
        readonly stdout: string;
        readonly stderr: string;
        readonly output: string;
        readonly projection: string | undefined;
    }

    function runRetryStep(executionFile: string | undefined, judgeOutput = ''): EvidenceRun {
        const retry = step('retry');
        const dir = mkdtempSync(path.join(tmpdir(), 'gateJudgeRetryEvidence-'));
        dirs.push(dir);
        const output = path.join(dir, 'output');

        if (executionFile !== undefined) {
            writeFileSync(path.join(dir, 'claude-execution-output.json'), executionFile);
        }

        const run = spawnSync('/bin/bash', ['-c', retry.run ?? ''], {
            encoding: 'utf8',
            env: {
                PATH: '/usr/bin:/bin',
                RUNNER_TEMP: dir,
                GITHUB_OUTPUT: output,
                ...retry.env,
                JUDGE_OUTPUT: judgeOutput,
            },
        });

        expect(run.status, run.stderr).toBe(0);

        const projectionPath = path.join(dir, 'gateRetryEvidence.json');
        let projection: string | undefined;

        try {
            projection = readFileSync(projectionPath, 'utf8');
        } catch {
            projection = undefined;
        }

        return { stdout: run.stdout, stderr: run.stderr, output: readFileSync(output, 'utf8'), projection };
    }

    const evidence = (run: EvidenceRun): Record<string, string> =>
        Object.fromEntries(
            run.stdout
                .split('\n')
                .filter((line) => line.startsWith('retry-evidence '))
                .map((line) => {
                    const [name = '', ...value] = line.slice('retry-evidence '.length).split('=');

                    return [name, value.join('=')];
                }),
        );

    it('says which clause failed when the prose mentions BLOCK (H1)', () => {
        const run = runRetryStep(result({ subtype: 'success', is_error: false, result: PROSE }));

        expect(run.output).toBe('retry=false\n');
        expect(evidence(run)).toMatchObject({
            subtype_success: 'true',
            is_error_false: 'true',
            structured_absent: 'true',
            result_mentions_block: 'true',
            filter: 'false',
        });
    });

    it("says BLOCK is mentioned when the card's own report spine is echoed (H1)", () => {
        const spine = '### Verdict\nPASS WITH FINDINGS\n\nTemplate: [BLOCK | PASS WITH FINDINGS | PASS]';
        const run = runRetryStep(result({ subtype: 'success', is_error: false, result: spine }));

        expect(run.output).toBe('retry=false\n');
        expect(evidence(run)['result_mentions_block']).toBe('true');
    });

    it('keeps the projection when the result text is not a string', () => {
        const run = runRetryStep(result({ subtype: 'success', is_error: false, result: 7 }));

        expect(JSON.parse(run.projection ?? 'null')).toMatchObject({
            result_type: 'number',
            result_mentions_block: null,
        });
    });

    it('says an empty-string structured output is present, not absent (H2)', () => {
        const run = runRetryStep(result({ subtype: 'success', is_error: false, structured_output: '', result: 'ok' }));

        expect(run.output).toBe('retry=false\n');
        expect(evidence(run)).toMatchObject({
            structured_absent: 'false',
            structured_empty_string: 'true',
            structured_output_type: 'string',
        });
    });

    it('says jq itself failed, and not that a clause was false (H3)', () => {
        const run = runRetryStep(
            JSON.stringify(['not an object', { type: 'result', subtype: 'success', is_error: false, result: 'ok' }]),
        );

        expect(run.output).toBe('retry=false\n');
        expect(evidence(run)['filter']).toMatch(/^error:[2-5]$/u);
    });

    it('says the file is missing, and still writes retry=false', () => {
        const run = runRetryStep(undefined);

        expect(run.output).toBe('retry=false\n');
        expect(evidence(run)['file_present']).toBe('false');
        expect(run.projection).toBeUndefined();
    });

    it('keeps the retry decision for the retry shape', () => {
        const run = runRetryStep(result({ subtype: 'success', is_error: false, result: 'a report' }));

        expect(run.output).toBe('retry=true\n');
        expect(evidence(run)['filter']).toBe('true');
    });

    it('never prints the prose, on stdout or stderr', () => {
        const run = runRetryStep(result({ subtype: 'success', is_error: false, result: PROSE }));

        expect(run.stdout).not.toContain('SECRET-PROSE-MARKER');
        expect(run.stderr).not.toContain('SECRET-PROSE-MARKER');
        expect(run.stdout.split('\n').filter((line) => line.startsWith('::'))).toEqual([]);
    });

    it('writes a projection with the clause facts and no prose', () => {
        const run = runRetryStep(
            result({ subtype: 'success', is_error: false, num_turns: 30, result: PROSE, session_id: 'SECRET-SESSION' }),
        );
        const projection = JSON.parse(run.projection ?? 'null') as Record<string, unknown>;

        expect(Object.keys(projection).sort((a, b) => a.localeCompare(b))).toEqual([
            'is_error',
            'num_turns',
            'result_length',
            'result_mentions_block',
            'result_type',
            'structured_output_type',
            'subtype',
        ]);
        expect(projection).toMatchObject({
            subtype: 'success',
            is_error: false,
            num_turns: 30,
            structured_output_type: 'null',
            result_type: 'string',
            result_mentions_block: true,
        });
        expect(run.projection).not.toContain('SECRET');
    });

    it('logs nothing and writes no projection when the first judge already gave an output', () => {
        const run = runRetryStep(result({ subtype: 'success', is_error: false }), '{"verdict":"PASS"}');

        expect(run.output).toBe('retry=false\n');
        expect(run.stdout).toBe('');
        expect(run.projection).toBeUndefined();
    });

    it('maps an unknown subtype to other, so the projection is prose-free by construction', () => {
        const run = runRetryStep(result({ subtype: '::add-mask::SECRET-SUBTYPE', is_error: false }));

        expect(run.projection).toContain('"subtype": "other"');
        expect(run.projection).not.toContain('SECRET');
    });

    it('uploads only the projection, for three days, and never fails the job for a missing file', () => {
        const upload = steps.find((candidate) => candidate.name === 'Keep the retry evidence');

        expect(upload?.uses).toMatch(/^actions\/upload-artifact@[0-9a-f]{40}/u);
        expect(upload?.with).toMatchObject({
            path: '${{ runner.temp }}/gateRetryEvidence.json',
            'retention-days': 3,
            'if-no-files-found': 'ignore',
        });
        expect(upload?.if).toContain('!cancelled()');
        // An artifact-service error or a re-run name clash must never fail the GATE job.
        expect(upload?.['continue-on-error']).toBe(true);
        // A re-run keeps the run, and upload-artifact refuses a second artifact of one name unless it overwrites.
        expect(upload?.with).toMatchObject({ overwrite: true });
    });
});
