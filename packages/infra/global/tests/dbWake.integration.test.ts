/**
 * Integration suite for the sandbox DB wake gate's IMPURE half — `db-wake.sh ensure`
 * (`.github/scripts/db-wake.sh`). `__tests__/dbWake.test.ts` covers the pure predicates; this covers
 * everything they cannot see: discovery, the refusal of a non-sandbox identifier BEFORE any mutating call,
 * the `StartDBInstance` call itself, the poll loop, the concurrent-start race, and the bounded timeout.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script (executed as `bash`, not re-implemented), a real child process, real argument
 *   parsing, the real loop and its real deadline arithmetic.
 * - **Stubbed**: the AWS CLI, via an `aws` executable placed FIRST on `PATH`, which records every argv it
 *   is handed. RDS cannot be stood up in a test tier, and this seam is precisely where the script talks to
 *   it — so the stub is what makes "it never called StartDBInstance on prod" an assertion about the wire
 *   rather than about our own reasoning.
 *
 * ⚠️ The child is spawned ASYNCHRONOUSLY and the poll interval is driven to zero through
 * `DB_WAKE_POLL_SECONDS`, so the real loop runs every iteration without the suite sleeping for it.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/db-wake.sh', import.meta.url));

/** The live sandbox instance identifier (verified against the account 2026-08-19). */
const SANDBOX_ID = 'kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk';
/** The live PROD instance identifier — the one nothing here may ever touch. */
const PROD_ID = 'kitchensink-data-prod-databaseb269d8bb-ci1yhovuyivm';

/**
 * A stub `aws` binary. It logs every invocation to `$AWS_STUB_LOG`, answers discovery from
 * `$AWS_STUB_DISCOVERY`, pops a status per `describe` from `$AWS_STUB_STATUS_FILE` (repeating the last
 * one forever), and either accepts or rejects `start-db-instance` per `$AWS_STUB_START`.
 */
const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"\${AWS_STUB_LOG}"

case "$*" in
  *"start-db-instance"*)
    if [ "\${AWS_STUB_START}" = 'FAIL' ]; then
      echo "An error occurred (InvalidDBInstanceState): Instance is not in a stopped state." >&2
      exit 254
    fi
    echo '{}'
    exit 0
    ;;
  *"--db-instance-identifier"*)
    # Per-instance describe: pop the head of the status queue, keeping the last entry forever.
    read -r head rest < <(cat "\${AWS_STUB_STATUS_FILE}")
    if [ -n "$rest" ]; then printf '%s\\n' "$rest" >"\${AWS_STUB_STATUS_FILE}"; fi
    if [ "$head" = 'FAIL' ]; then
      echo "An error occurred (DBInstanceNotFound)" >&2
      exit 254
    fi
    printf '%s\\n' "$head"
    exit 0
    ;;
  *)
    # Discovery.
    if [ "\${AWS_STUB_DISCOVERY}" = 'FAIL' ]; then
      echo "An error occurred (AccessDenied)" >&2
      exit 254
    fi
    printf '%s\\n' "\${AWS_STUB_DISCOVERY}"
    exit 0
    ;;
esac
`;

interface EnsureResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
    /** Every argv the stub `aws` was invoked with, newline-separated. */
    readonly awsCalls: string;
}

let workdir: string;
let binDir: string;

beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'db-wake-'));
    // A directory holding ONLY the stub, prepended to PATH, so a real AWS CLI is shadowed and this suite
    // cannot reach a real account even by accident.
    binDir = join(workdir, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);
});

afterAll(() => {
    // The temp dir is left for post-mortem; the OS reclaims it.
});

/**
 * Run the real `ensure` subcommand against the stub CLI.
 *
 * @param options - Discovery output, the status queue the poll loop will observe, whether
 *   `start-db-instance` is rejected, and the timeout bound.
 * @returns Exit status, stdout, stderr and the recorded AWS calls.
 * @sideEffect Spawns `bash` and writes to a temp directory.
 */
const ensure = async (options: {
    readonly discovery?: string;
    readonly statuses: readonly string[];
    readonly startFails?: boolean;
    readonly timeoutSeconds?: number;
}): Promise<EnsureResult> => {
    const token = Math.random().toString(36).slice(2);
    const logFile = join(workdir, `aws-${token}.log`);
    const statusFile = join(workdir, `status-${token}.txt`);
    writeFileSync(logFile, '');
    writeFileSync(statusFile, `${options.statuses.join(' ')}\n`);

    const child = spawn('bash', [SCRIPT, 'ensure', 'us-east-1'], {
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_STUB_LOG: logFile,
            AWS_STUB_STATUS_FILE: statusFile,
            AWS_STUB_DISCOVERY: options.discovery ?? SANDBOX_ID,
            AWS_STUB_START: options.startFails === true ? 'FAIL' : 'OK',
            DB_WAKE_POLL_SECONDS: '0',
            DB_WAKE_TIMEOUT_SECONDS: String(options.timeoutSeconds ?? 60),
        },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
    });

    const status = await new Promise<number>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? -1));
    });

    return { status, stdout, stderr, awsCalls: readFileSync(logFile, 'utf8') };
};

describe('db-wake.sh ensure — the file exists', () => {
    it('is present at .github/scripts/db-wake.sh', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });
});

describe('db_wake_ensure — an already-available instance is a no-op', () => {
    it('exits 0 without issuing StartDBInstance', async () => {
        const result = await ensure({ statuses: ['available'] });

        expect(result.status).toBe(0);
        expect(result.awsCalls).not.toContain('start-db-instance');
    });
});

describe('db_wake_ensure — a stopped instance is woken and waited for', () => {
    it('issues exactly one StartDBInstance for the sandbox instance, then waits for `available`', async () => {
        const result = await ensure({ statuses: ['stopped', 'starting', 'starting', 'available'] });

        expect(result.status).toBe(0);

        const starts = result.awsCalls.split('\n').filter((line) => line.includes('start-db-instance'));

        expect(starts).toHaveLength(1);
        expect(starts[0]).toContain(SANDBOX_ID);
        expect(result.stdout).toContain(SANDBOX_ID);
    });

    // `starting` means someone else (the 09:00 scheduler, or a concurrent workflow) already woke it. Waiting
    // is correct; issuing our own StartDBInstance would be rejected as InvalidDBInstanceState.
    it('waits out a `starting` instance without issuing StartDBInstance at all', async () => {
        const result = await ensure({ statuses: ['starting', 'starting', 'available'] });

        expect(result.status).toBe(0);
        expect(result.awsCalls).not.toContain('start-db-instance');
    });

    // THE 00:31 race: the nightly stop is mid-flight. StartDBInstance on a `stopping` instance is rejected,
    // so the gate must wait for `stopped` first and only then wake it.
    it('waits for a `stopping` instance to reach `stopped` before waking it', async () => {
        const result = await ensure({ statuses: ['stopping', 'stopping', 'stopped', 'starting', 'available'] });

        expect(result.status).toBe(0);
        expect(result.awsCalls.split('\n').filter((line) => line.includes('start-db-instance'))).toHaveLength(1);
    });
});

describe('db_wake_ensure — race tolerance: a rejected StartDBInstance is not a failed job', () => {
    // Two workflows can reach `stopped` simultaneously; the loser's StartDBInstance returns
    // InvalidDBInstanceState. That is the CORRECT outcome — the instance is coming up — so it must not fail
    // the deploy. The loop, not the call, is the authority.
    it('tolerates InvalidDBInstanceState and succeeds once the instance becomes available', async () => {
        const result = await ensure({ statuses: ['stopped', 'starting', 'available'], startFails: true });

        expect(result.status).toBe(0);
        expect(result.awsCalls).toContain('start-db-instance');
    });
});

describe('db_wake_ensure — the wait is BOUNDED and the timeout is loud', () => {
    // An unbounded wait converts a fast failure into a six-hour job. Past the bound the gate annotates and
    // exits non-zero, naming the instance and the last status it saw.
    it('fails with ::error:: when the instance never becomes available', async () => {
        const result = await ensure({ statuses: ['stopped'], startFails: true, timeoutSeconds: 0 });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
        expect(`${result.stdout}${result.stderr}`).toContain(SANDBOX_ID);
        expect(`${result.stdout}${result.stderr}`).toMatch(/stopped/);
    });
});

describe('db_wake_ensure — a terminal status fails immediately instead of waiting out the clock', () => {
    it.each(['failed', 'deleting', 'incompatible-network'])(
        'fails fast on %s and never issues a start',
        async (status) => {
            const result = await ensure({ statuses: [status] });

            expect(result.status).not.toBe(0);
            expect(`${result.stdout}${result.stderr}`).toContain('::error::');
            expect(result.awsCalls).not.toContain('start-db-instance');
        },
    );
});

describe('⛔ db_wake_ensure — prod is structurally unreachable', () => {
    // The server-side query already filters to the sandbox prefix; this proves the SECOND, independent
    // guard — the client-side re-assertion — by feeding discovery an identifier the query could not have
    // returned. Nothing mutating may be issued, for prod OR for the sandbox instance beside it.
    it('refuses to act when discovery returns the prod instance', async () => {
        const result = await ensure({ discovery: PROD_ID, statuses: ['stopped'] });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
        expect(result.awsCalls).not.toContain('start-db-instance');
    });

    it('refuses the whole run when discovery mixes a prod instance in with the sandbox one', async () => {
        const result = await ensure({ discovery: `${SANDBOX_ID}\t${PROD_ID}`, statuses: ['stopped'] });

        expect(result.status).not.toBe(0);
        expect(result.awsCalls).not.toContain('start-db-instance');
    });
});

describe('db_wake_ensure — discovery problems fail loudly rather than silently skipping the wake', () => {
    // A silent skip here reproduces the exact incident: the deploy proceeds, the migration Trigger times
    // out against a stopped instance, and the rollback wedges the stack.
    it('fails when no sandbox instance is discovered', async () => {
        const result = await ensure({ discovery: '', statuses: ['available'] });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
    });

    it('fails when the discovery call itself fails', async () => {
        const result = await ensure({ discovery: 'FAIL', statuses: ['available'] });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
    });
});
