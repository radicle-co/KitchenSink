/**
 * Execute ONE workflow step's `run:` body under real bash, the way a GitHub runner does, and read back what
 * it wrote to `$GITHUB_OUTPUT`.
 *
 * Guards that prove a workflow DECISION (a stage refusal, a target resolution) run the workflow's own bash
 * rather than re-implementing it — the posture `maestroStageGuard.test.ts` and `deployGate.test.ts` set.
 * Three guards needed the same mechanics, so it lives here once.
 *
 * ⚠️ Only a step whose side effects are confined to `$GITHUB_OUTPUT` and stdout may be handed to this. A
 * guard must never run a workflow's installs, deletions or network calls on the machine running the guard.
 * `node` can be stubbed on `PATH` for steps that resolve an origin through `printPublicOrigin.mjs`: the stub
 * prints `https://<second argument>.origin.example.test`, so a stubbed origin still says which service asked.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** What one step run observed. */
export interface StepOutcome {
    readonly status: number;
    /** `key=value` lines the step appended to `$GITHUB_OUTPUT`, last writer wins. */
    readonly outputs: Readonly<Record<string, string>>;
    /** stdout followed by stderr, for assertion messages and annotation checks. */
    readonly log: string;
}

/**
 * Run a step body under `bash -e -o pipefail` in a throwaway directory.
 *
 * @param body - The step's `run:` text, verbatim.
 * @param env - The step's environment. Only `PATH` and `GITHUB_OUTPUT` are added.
 * @returns The exit status, the outputs written, and the combined log.
 * @sideEffect Creates and removes a temp directory, writes a script and a `node` stub, spawns bash.
 */
export function runWorkflowStep(body: string, env: Readonly<Record<string, string>>): StepOutcome {
    const dir = mkdtempSync(join(tmpdir(), 'workflow-step-'));

    try {
        const bin = join(dir, 'bin');
        const outputFile = join(dir, 'github_output');

        mkdirSync(bin);
        writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\necho "https://$2.origin.example.test"\n', {
            mode: 0o755,
        });
        writeFileSync(outputFile, '');
        writeFileSync(join(dir, 'step.sh'), body);

        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'step.sh'], {
            cwd: dir,
            encoding: 'utf8',
            env: { PATH: `${bin}:${process.env['PATH'] ?? ''}`, GITHUB_OUTPUT: outputFile, ...env },
        });
        const outputs = Object.fromEntries(
            readFileSync(outputFile, 'utf8')
                .split('\n')
                .filter((line) => line.includes('='))
                .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
        );

        return { status: result.status ?? -1, outputs, log: `${result.stdout}${result.stderr}` };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
