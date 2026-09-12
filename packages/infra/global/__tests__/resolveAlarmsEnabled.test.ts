/**
 * `.github/scripts/resolveAlarmsEnabled.sh` — the one way a deploy path turns the stage's SSM alarm switch into the
 * `ALARMS_ENABLED` the CDK apps read at synth (`alarmFeatureFlag.test.ts` holds every deploy path to it). Run as the
 * real script, with a stub `aws` on `PATH`, so the parameter name, the fail-closed default and the export are the
 * script's own.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github/scripts/resolveAlarmsEnabled.sh');

/** How the stub `aws` answers: a parameter value, or one of AWS's error codes on stderr with a non-zero exit. */
type StubAnswer =
    | { readonly value: string }
    | { readonly error: 'ParameterNotFound' | 'AccessDeniedException' | 'ThrottlingException' };

/**
 * Run the script with a stub `aws` that answers as `answer` says.
 *
 * @param args - The script's arguments.
 * @param answer - What the stub `aws ssm get-parameter` does.
 * @returns The exit status, what the script exported, and the arguments the stub received.
 * @sideEffect Writes a temp directory.
 */
function run(args: readonly string[], answer: StubAnswer) {
    const directory = mkdtempSync(path.join(tmpdir(), 'alarms-flag-'));
    const envFile = path.join(directory, 'github_env');
    const calls = path.join(directory, 'aws_calls');
    const stub = path.join(directory, 'aws');

    writeFileSync(envFile, '');
    writeFileSync(
        stub,
        'error' in answer
            ? `#!/usr/bin/env bash\necho "$@" >> '${calls}'\necho 'An error occurred (${answer.error}) when calling the GetParameter operation' >&2\nexit 254\n`
            : `#!/usr/bin/env bash\necho "$@" >> '${calls}'\necho '${answer.value}'\n`,
    );
    chmodSync(stub, 0o755);

    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { PATH: `${directory}:${process.env['PATH'] ?? ''}`, GITHUB_ENV: envFile },
    });
    const exported = readFileSync(envFile, 'utf8');
    let asked = '';

    try {
        asked = readFileSync(calls, 'utf8');
    } catch {
        asked = '';
    }

    return { status: result.status, exported, asked };
}

describe('resolveAlarmsEnabled.sh', () => {
    it('exports the stage parameter it reads', () => {
        const { status, exported, asked } = run(['prod'], { value: 'true' });

        expect(status).toBe(0);
        expect(exported).toContain('ALARMS_ENABLED');
        expect(exported).toContain('true');
        expect(asked).toContain('/kitchensink/prod/observability/alarms-enabled');
    });

    it('reads an ABSENT parameter as false: a stage that never set it deploys no alarms', () => {
        const { status, exported } = run(['sandbox'], { error: 'ParameterNotFound' });

        expect(status).toBe(0);
        expect(exported).toContain('ALARMS_ENABLED');
        expect(exported).toContain('false');
        expect(exported).not.toContain('true');
    });

    // Any other failure stops the deploy. Read as false, one throttled or denied call would have CloudFormation delete
    // a stage's live alarms on that deploy.
    it.each(['AccessDeniedException', 'ThrottlingException'] as const)(
        'fails the step on %s and exports nothing',
        (error) => {
            const { status, exported } = run(['prod'], { error });

            expect(status).not.toBe(0);
            expect(exported).toBe('');
        },
    );

    it.each([[[]], [['']], [['prod', 'extra']]])('refuses a call with arguments %j, asking AWS nothing', (args) => {
        const { status, exported, asked } = run(args, { value: 'true' });

        expect(status).toBe(2);
        expect(exported).toBe('');
        expect(asked).toBe('');
    });
});
