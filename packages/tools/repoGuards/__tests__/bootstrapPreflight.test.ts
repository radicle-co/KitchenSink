/**
 * The CI preflight that every `cdk deploy` runs first (`.github/scripts/bootstrapPreflight.sh`, ADR-0065).
 *
 * Until the owner runs the bootstrap runbook, a deploy through a KitchenSink qualifier dies at AssumeRole on a
 * role that does not exist. The preflight must turn that into an `::error::` naming the qualifier and the runbook,
 * and it must NEVER read "I could not tell" as "present". The script runs as real bash against a stubbed `aws`,
 * and its stage→qualifier rule is held equal to `qualifierForStage` (the TypeScript authority) over a table.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QUALIFIERS, qualifierForStage } from '@kitchensink/cdk-bootstrap/qualifiers';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/bootstrapPreflight.sh', import.meta.url));
const ACCOUNT = '123456789012';

interface FakeAws {
    /** `get-caller-identity`: `[exit status, stdout]`. */
    readonly identity: readonly [number, string];
    /** `assume-role`: `[exit status, stdout]`. */
    readonly assume: readonly [number, string];
}

interface Outcome {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly assumeArgs: string;
}

const PRESENT: FakeAws = {
    identity: [0, ACCOUNT],
    assume: [
        0,
        `arn:aws:sts::${ACCOUNT}:assumed-role/cdk-ksnonprod-deploy-role-${ACCOUNT}-us-east-1/bootstrapPreflight`,
    ],
};

/**
 * Run the script with an `aws` stub on PATH.
 *
 * @sideEffect Creates and removes a temp directory, spawns bash.
 */
function run(args: readonly string[], fake: FakeAws): Outcome {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-preflight-'));

    try {
        const log = join(dir, 'assumeArgs');
        const stub = [
            '#!/usr/bin/env bash',
            'case "$2" in',
            `get-caller-identity) printf '%s' '${fake.identity[1]}'; exit ${fake.identity[0]} ;;`,
            `assume-role) printf '%s ' "$@" > '${log}'; printf '%s' '${fake.assume[1]}'; exit ${fake.assume[0]} ;;`,
            'esac',
            'exit 99',
        ].join('\n');

        writeFileSync(join(dir, 'aws'), stub);
        chmodSync(join(dir, 'aws'), 0o755);
        writeFileSync(log, '');

        const result = spawnSync('bash', [SCRIPT, ...args], {
            encoding: 'utf8',
            env: { PATH: `${dir}:${process.env['PATH'] ?? ''}` },
        });
        const assumeArgs = spawnSync('cat', [log], { encoding: 'utf8' }).stdout;

        return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, assumeArgs };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('bootstrapPreflight.sh check', () => {
    it('passes when the qualifier deploy role can be assumed, and asks for exactly that role', () => {
        const outcome = run(['check', 'sandbox', 'us-east-1'], PRESENT);

        expect(outcome.status).toBe(0);
        expect(outcome.assumeArgs).toContain(
            `arn:aws:iam::${ACCOUNT}:role/cdk-ksnonprod-deploy-role-${ACCOUNT}-us-east-1`,
        );
    });

    it('fails with an ::error:: naming the qualifier and the runbook when the role cannot be assumed', () => {
        const outcome = run(['check', 'pr-7', 'us-east-1'], {
            ...PRESENT,
            assume: [254, 'An error occurred (AccessDenied) when calling the AssumeRole operation'],
        });

        expect(outcome.status).toBe(1);
        expect(outcome.stderr).toContain('::error');
        expect(outcome.stderr).toContain('ksnonprod');
        expect(outcome.stderr).toContain('docs/runbooks/cdkBootstrapQualifiers.md');
    });

    it('checks the production qualifier for prod and the account qualifier for the account app', () => {
        const prod = run(['check', 'prod', 'us-east-1'], { ...PRESENT, assume: [254, 'denied'] });
        const account = run(['check', 'account', 'us-east-1'], { ...PRESENT, assume: [254, 'denied'] });

        expect(prod.stderr).toContain('ksprod');
        expect(account.stderr).toContain('ksaccount');
    });

    it('treats an unreadable account as not bootstrapped, never as present', () => {
        const outcome = run(['check', 'sandbox', 'us-east-1'], {
            ...PRESENT,
            identity: [255, 'Unable to locate credentials'],
        });

        expect(outcome.status).toBe(1);
        expect(outcome.stderr).toContain('::error');
        expect(outcome.stderr).toContain('ksnonprod');
    });

    it('treats a malformed account answer as unreadable', () => {
        expect(run(['check', 'sandbox', 'us-east-1'], { ...PRESENT, identity: [0, 'None'] }).status).toBe(1);
    });

    it('treats a zero exit with an empty or non-ARN answer as NOT present', () => {
        expect(run(['check', 'sandbox', 'us-east-1'], { ...PRESENT, assume: [0, ''] }).status).toBe(1);
        expect(run(['check', 'sandbox', 'us-east-1'], { ...PRESENT, assume: [0, 'None'] }).status).toBe(1);
    });

    it('refuses misuse: no stage, empty stage or no region', () => {
        expect(run(['check'], PRESENT).status).toBe(2);
        expect(run(['check', '', 'us-east-1'], PRESENT).status).toBe(2);
        expect(run(['check', 'sandbox'], PRESENT).status).toBe(2);
        expect(run(['bogus'], PRESENT).status).toBe(2);
    });
});

describe('bootstrapPreflight.sh qualifier: the shell twin of qualifierForStage', () => {
    const stages = ['prod', 'sandbox', 'pr-1', 'pr-91', 'Prod', 'production', 'prod ', 'prod-2', 'global', 'dev'];

    it.each(stages)('answers what the TypeScript authority answers for %j', (stage) => {
        const outcome = run(['qualifier', stage], PRESENT);

        expect(outcome.status).toBe(0);
        expect(outcome.stdout.trim()).toBe(qualifierForStage(stage));
    });

    it('answers the account qualifier for the stage-less account app', () => {
        expect(run(['qualifier', 'account'], PRESENT).stdout.trim()).toBe(QUALIFIERS.account);
    });
});
