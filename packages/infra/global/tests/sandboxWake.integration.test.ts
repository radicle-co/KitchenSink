/**
 * Integration suite for the sandbox STATUS CHECK's IMPURE half, `sandboxWake.sh check`
 * (`.github/scripts/sandboxWake.sh`). `__tests__/sandboxWake.test.ts` covers the pure predicates; this covers what
 * they cannot see: discovery, the refusal of a non-sandbox identifier, the exit-code contract (0 up, 3 down,
 * 1 error), the bounded wait on a `starting` resource, the pre-midnight headroom, and the property the owner
 * ruled on 2026-10-12: the check NEVER starts anything.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script (executed as `bash`, not re-implemented), a real child process, real argument parsing,
 *   the real poll loop and its real deadline arithmetic.
 * - **Stubbed**: the AWS CLI, via an `aws` executable placed FIRST on `PATH`, which records every argv it is
 *   handed. RDS and EC2 cannot be stood up in a test tier, and this seam is precisely where the script talks to
 *   them, so the stub is what makes "it issued nothing but describe calls" an assertion about the wire.
 *   The stub answers a `describe` and nothing else; any other verb exits 99, so a start would also fail the run.
 *
 * ⚠️ The child is spawned ASYNCHRONOUSLY and the poll interval is driven to zero through
 * `SANDBOX_WAKE_POLL_SECONDS`, so the real loop runs every iteration without the suite sleeping for it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandboxWake.sh', import.meta.url));

/** The live sandbox instance identifier (verified against the account 2026-08-19). */
const SANDBOX_ID = 'kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk';
/** The live PROD instance identifier, the one nothing here may ever read as "the sandbox". */
const PROD_ID = 'kitchensink-data-prod-databaseb269d8bb-ci1yhovuyivm';
/** The live sandbox NAT instance and its `Name` tag (verified against the account 2026-08-23). */
const SANDBOX_NAT_ID = 'i-0b126b357d15b35fd';
const SANDBOX_NAT_NAME = 'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance';
/** The live PROD NAT: running, and the one instance a status check must never mistake for the sandbox's. */
const PROD_NAT_ID = 'i-0d654e6d9f819b231';
const PROD_NAT_NAME = 'Global-prod/Network-prod/Vpc/publicSubnet1/NatInstance';

/** Exit codes of `check`, as the script documents them. */
const UP = 0;
const ERROR = 1;
const DOWN = 3;

/**
 * A stub `aws` binary. It logs every invocation to `$AWS_STUB_LOG`, answers discovery from
 * `$AWS_STUB_DISCOVERY` / `$AWS_STUB_NAT_DISCOVERY`, pops a status per per-resource `describe` from
 * `$AWS_STUB_STATUS_FILE` / `$AWS_STUB_NAT_STATE_FILE` (repeating the last one forever), and rejects every verb
 * that is not a `describe` with exit 99.
 */
const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"\${AWS_STUB_LOG}"

case "$*" in
  *"ec2 describe-instances"*"--instance-ids"*)
    read -r head rest < <(cat "\${AWS_STUB_NAT_STATE_FILE}")
    if [ -n "$rest" ]; then printf '%s\\n' "$rest" >"\${AWS_STUB_NAT_STATE_FILE}"; fi
    if [ "$head" = 'FAIL' ]; then
      echo "An error occurred (InvalidInstanceID.NotFound)" >&2
      exit 254
    fi
    printf '%s\\n' "$head"
    exit 0
    ;;
  *"ec2 describe-instances"*)
    if [ "\${AWS_STUB_NAT_DISCOVERY}" = 'FAIL' ]; then
      echo "An error occurred (UnauthorizedOperation)" >&2
      exit 254
    fi
    printf '%s\\n' "\${AWS_STUB_NAT_DISCOVERY}"
    exit 0
    ;;
  *"rds describe-db-instances"*"--db-instance-identifier"*)
    read -r head rest < <(cat "\${AWS_STUB_STATUS_FILE}")
    if [ -n "$rest" ]; then printf '%s\\n' "$rest" >"\${AWS_STUB_STATUS_FILE}"; fi
    if [ "$head" = 'FAIL' ]; then
      echo "An error occurred (DBInstanceNotFound)" >&2
      exit 254
    fi
    printf '%s\\n' "$head"
    exit 0
    ;;
  *"rds describe-db-instances"*)
    if [ "\${AWS_STUB_DISCOVERY}" = 'FAIL' ]; then
      echo "An error occurred (AccessDenied)" >&2
      exit 254
    fi
    printf '%s\\n' "\${AWS_STUB_DISCOVERY}"
    exit 0
    ;;
  *)
    echo "stub aws: refusing a verb that is not a describe: $*" >&2
    exit 99
    ;;
esac
`;

interface CheckResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
    /** Every argv the stub `aws` was invoked with, newline-separated. */
    readonly awsCalls: string;
}

let workdir: string;
let binDir: string;

beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'sandbox-check-'));
    // A directory holding ONLY the stub, prepended to PATH, so a real AWS CLI is shadowed and this suite
    // cannot reach a real account even by accident.
    binDir = join(workdir, 'bin');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, 'aws'), AWS_STUB);
    chmodSync(join(binDir, 'aws'), 0o755);
});

afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
});

/**
 * Run the real `check` subcommand against the stub CLI.
 *
 * @param options - Discovery output, the status queues the poll loop will observe, and the timeout bound.
 * @returns Exit status, stdout, stderr and the recorded AWS calls.
 * @sideEffect Spawns `bash` and writes to a temp directory.
 */
const check = async (options: {
    readonly discovery?: string;
    readonly statuses: readonly string[];
    readonly timeoutSeconds?: number;
    readonly natDiscovery?: string;
    readonly natStates?: readonly string[];
    readonly requiredHeadroomSeconds?: number;
}): Promise<CheckResult> => {
    const token = Math.random().toString(36).slice(2);
    const logFile = join(workdir, `aws-${token}.log`);
    const statusFile = join(workdir, `status-${token}.txt`);
    const natStateFile = join(workdir, `nat-state-${token}.txt`);
    writeFileSync(logFile, '');
    writeFileSync(statusFile, `${options.statuses.join(' ')}\n`);
    // ⚠️ The NAT defaults to an already-running instance so that every RDS case asserts exactly what it says.
    // A default of `stopped` would make each of them silently also a NAT test.
    writeFileSync(natStateFile, `${(options.natStates ?? ['running']).join(' ')}\n`);

    const child = spawn('bash', [SCRIPT, 'check', 'us-east-1'], {
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_STUB_LOG: logFile,
            AWS_STUB_STATUS_FILE: statusFile,
            AWS_STUB_DISCOVERY: options.discovery ?? SANDBOX_ID,
            AWS_STUB_NAT_STATE_FILE: natStateFile,
            AWS_STUB_NAT_DISCOVERY: options.natDiscovery ?? `${SANDBOX_NAT_ID}\t${SANDBOX_NAT_NAME}`,
            SANDBOX_WAKE_POLL_SECONDS: '0',
            SANDBOX_WAKE_TIMEOUT_SECONDS: String(options.timeoutSeconds ?? 60),
            // ⛔ Zero headroom by DEFAULT. Left at its 45-minute production default, every case would answer
            // `down` whenever the suite happened to run in the band before 00:00 ET, which is when this repo's CI
            // does run. A suite whose verdict depends on the hour is a suite nobody trusts.
            SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS: String(options.requiredHeadroomSeconds ?? 0),
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

/** Every AWS call a run made, as non-empty lines. */
const callsOf = (result: CheckResult): readonly string[] => result.awsCalls.split('\n').filter((line) => line !== '');

/** Both streams, for message assertions. */
const outputOf = (result: CheckResult): string => `${result.stdout}${result.stderr}`;

describe('sandboxWake.sh check — the file exists', () => {
    it('is present at .github/scripts/sandboxWake.sh', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });
});

describe('sandbox_wake_check — up: database available AND NAT running', () => {
    it('exits 0', async () => {
        const result = await check({ statuses: ['available'], natStates: ['running'] });

        expect(result.status).toBe(UP);
        expect(result.stdout).toContain('is available');
    });
});

describe('⛔ sandbox_wake_check — it NEVER starts anything (owner ruling 2026-10-12)', () => {
    // Every combination the old `ensure` would have acted on. The stub exits 99 on any non-describe verb AND
    // logs it, so a start fails this assertion twice over.
    it.each([
        ['a stopped database', ['stopped'], ['running']],
        ['a stopped NAT', ['available'], ['stopped']],
        ['both stopped', ['stopped'], ['stopped']],
        ['a stopping database', ['stopping'], ['running']],
        ['a starting database', ['starting', 'available'], ['running']],
        ['a failed database', ['failed'], ['running']],
    ] as const)('issues only describe calls for %s', async (_label, statuses, natStates) => {
        const result = await check({ statuses, natStates });
        const calls = callsOf(result);

        expect(calls.length).toBeGreaterThan(0);
        expect(calls.filter((call) => !/^(rds|ec2) describe-/u.test(call))).toEqual([]);
        expect(result.awsCalls).not.toMatch(/start-|stop-|modify-/u);
    });
});

describe('sandbox_wake_check — down: exit 3, never an error', () => {
    it('a stopped database is DOWN', async () => {
        const result = await check({ statuses: ['stopped'] });

        expect(result.status).toBe(DOWN);
        expect(outputOf(result)).toContain(SANDBOX_ID);
        expect(outputOf(result)).not.toContain('::error::');
    });

    // `stopping` is the nightly stop mid-flight: it will be `stopped` in a minute, so waiting on it is waiting
    // for nothing. It is answered at once, from the first describe.
    it('a stopping database is DOWN immediately, without a second look', async () => {
        const result = await check({ statuses: ['stopping', 'stopped'] });

        expect(result.status).toBe(DOWN);
        expect(callsOf(result).filter((call) => call.includes('--db-instance-identifier'))).toHaveLength(1);
    });

    it('a stopped NAT is DOWN even though the database is available', async () => {
        const result = await check({ statuses: ['available'], natStates: ['stopped'] });

        expect(result.status).toBe(DOWN);
        expect(outputOf(result)).toContain(SANDBOX_NAT_ID);
    });

    it('a stopping NAT is DOWN', async () => {
        expect((await check({ statuses: ['available'], natStates: ['stopping'] })).status).toBe(DOWN);
    });

    // A deploy needs both; a check that stopped at the first verdict would send the operator back for a second
    // round trip to learn the second.
    it('names the database AND the NAT when both are down', async () => {
        const result = await check({ statuses: ['stopped'], natStates: ['stopped'] });

        expect(result.status).toBe(DOWN);
        expect(outputOf(result)).toContain(SANDBOX_ID);
        expect(outputOf(result)).toContain(SANDBOX_NAT_ID);
    });
});

describe('sandbox_wake_check — a resource that is STARTING is waited for, bounded', () => {
    it('waits out a starting database and answers up', async () => {
        const result = await check({ statuses: ['starting', 'starting', 'available'] });

        expect(result.status).toBe(UP);
        expect(callsOf(result).filter((call) => call.includes('--db-instance-identifier')).length).toBeGreaterThan(2);
    });

    it('waits out a pending NAT and answers up', async () => {
        const result = await check({ statuses: ['available'], natStates: ['pending', 'pending', 'running'] });

        expect(result.status).toBe(UP);
    });

    // An unbounded wait converts a fast answer into a six-hour job. Past the bound the check ERRORS (a resource
    // stuck mid-start is an anomaly, not "down") and names the resource and the last status it saw.
    it('errors, loudly and bounded, when the database never leaves `starting`', async () => {
        const result = await check({ statuses: ['starting'], timeoutSeconds: 0 });

        expect(result.status).toBe(ERROR);
        expect(outputOf(result)).toContain('::error::');
        expect(outputOf(result)).toContain(SANDBOX_ID);
        expect(outputOf(result)).toContain('starting');
    });

    it('errors, bounded, when the NAT never leaves `pending`', async () => {
        const result = await check({ statuses: ['available'], natStates: ['pending'], timeoutSeconds: 0 });

        expect(result.status).toBe(ERROR);
        expect(outputOf(result)).toContain(SANDBOX_NAT_ID);
    });

    it('errors when the status cannot be read before the bound', async () => {
        const result = await check({ statuses: ['FAIL'], timeoutSeconds: 0 });

        expect(result.status).toBe(ERROR);
        expect(outputOf(result)).toContain('UNREADABLE');
    });
});

describe('sandbox_wake_check — a terminal state is an ERROR, in seconds', () => {
    it.each(['failed', 'deleting', 'incompatible-network'])('database %s', async (status) => {
        const result = await check({ statuses: [status] });

        expect(result.status).toBe(ERROR);
        expect(outputOf(result)).toContain('::error::');
    });

    it('a terminated NAT', async () => {
        const result = await check({ statuses: ['available'], natStates: ['terminated'] });

        expect(result.status).toBe(ERROR);
    });
});

describe('⛔ sandbox_wake_check — prod is structurally unreachable', () => {
    // The server-side query already filters to the sandbox prefix; this proves the SECOND, independent guard
    // by feeding discovery an identifier the query could not have returned. Reading prod's `available` would
    // report a stopped sandbox as up.
    it('refuses when discovery returns the prod instance, and never describes it', async () => {
        const result = await check({ discovery: PROD_ID, statuses: ['available'] });

        expect(result.status).toBe(ERROR);
        expect(outputOf(result)).toContain('::error::');
        expect(result.awsCalls).not.toContain(`--db-instance-identifier ${PROD_ID}`);
    });

    it('refuses the whole run when discovery mixes a prod instance in with the sandbox one', async () => {
        const result = await check({ discovery: `${SANDBOX_ID}\t${PROD_ID}`, statuses: ['available'] });

        expect(result.status).toBe(ERROR);
    });

    it('refuses when NAT discovery returns the prod NAT', async () => {
        const result = await check({
            statuses: ['available'],
            natDiscovery: `${PROD_NAT_ID}\t${PROD_NAT_NAME}`,
            natStates: ['running'],
        });

        expect(result.status).toBe(ERROR);
        expect(result.awsCalls).not.toContain(`--instance-ids ${PROD_NAT_ID}`);
    });

    it('refuses the whole run when NAT discovery mixes the prod NAT in with the sandbox one', async () => {
        const result = await check({
            statuses: ['available'],
            natDiscovery: `${SANDBOX_NAT_ID}\t${SANDBOX_NAT_NAME}\n${PROD_NAT_ID}\t${PROD_NAT_NAME}`,
        });

        expect(result.status).toBe(ERROR);
    });

    // A name carrying BOTH markers is the case a bare `contains('sandbox')` admits; the prod veto alone refuses it.
    it('refuses a NAT whose name carries both markers', async () => {
        const result = await check({
            statuses: ['available'],
            natDiscovery: `${SANDBOX_NAT_ID}\tGlobal-prod/Network-sandbox/Vpc/publicSubnet1/NatInstance`,
        });

        expect(result.status).toBe(ERROR);
    });
});

describe('sandbox_wake_check — discovery problems are errors, not silent "up" or "down"', () => {
    it('errors when no sandbox instance is discovered', async () => {
        const result = await check({ discovery: '', statuses: ['available'] });

        expect(result.status).toBe(ERROR);
        expect(outputOf(result)).toContain('::error::');
    });

    it('errors when the discovery call itself fails', async () => {
        expect((await check({ discovery: 'FAIL', statuses: ['available'] })).status).toBe(ERROR);
    });

    it('errors when no sandbox NAT is discovered', async () => {
        expect((await check({ statuses: ['available'], natDiscovery: '' })).status).toBe(ERROR);
    });

    it('errors when the NAT discovery call itself fails', async () => {
        expect((await check({ statuses: ['available'], natDiscovery: 'FAIL' })).status).toBe(ERROR);
    });
});

/**
 * ⛔ THE HEADROOM RULE, kept from the 2026-09-05 wedge. A caller that would still be running at 00:00 ET is told
 * the sandbox is DOWN (exit 3), so nothing deploys across the nightly stop. The check no longer waits for the
 * boundary: there is no wake to follow it.
 *
 * ⚠️ The wall clock is a genuine input, and the suite says so. A `crossing` verdict can only be forced when the
 * live headroom is below the largest headroom the script accepts (79200 s), which is true for 22 of every 24
 * hours. Both arms assert something substantive, and the arm taken is named in the failure message.
 */
describe('sandbox_wake_check — a caller that would CROSS the 00:00 ET stop is told "down"', () => {
    /** The largest headroom the script will accept as a request; one more is misuse. */
    const MAX_ACCEPTED_HEADROOM = 79_200;

    /**
     * The seconds remaining before the next 00:00 ET stop, read from the real script.
     *
     * @returns Live headroom in seconds.
     * @sideEffect Spawns `bash`.
     */
    const liveHeadroom = (): number => {
        const now = Math.floor(Date.now() / 1000);
        const boundary = Number(
            spawnSync('bash', [SCRIPT, 'next-stop', String(now)], { encoding: 'utf8' }).stdout.trim(),
        );

        return boundary - now;
    };

    it('answers 3 with no AWS call at all — or, inside the post-midnight band, answers up', async () => {
        const headroom = liveHeadroom();
        const forcesCrossing = headroom + 1 < MAX_ACCEPTED_HEADROOM;

        const result = await check({
            statuses: ['available'],
            // One second more than remains: `crossing` by construction, for any clock outside the band.
            requiredHeadroomSeconds: forcesCrossing ? headroom + 1 : MAX_ACCEPTED_HEADROOM - 1,
        });

        if (forcesCrossing) {
            expect(result.status, `crossing arm (headroom ${headroom}s): the check must say DOWN`).toBe(DOWN);
            expect(outputOf(result)).toContain('00:00 America/New_York');
            // Decided before any describe: the answer does not depend on RDS or EC2 at all.
            expect(callsOf(result)).toEqual([]);

            return;
        }

        expect(result.status, `clear arm (headroom ${headroom}s): the check must say UP`).toBe(UP);
    });

    // The negative case, and it holds at EVERY hour: a caller that declares no headroom requirement must never
    // be refused. This keeps the rule from becoming a nightly outage of its own.
    it('does not fire for a caller with zero required headroom, at any hour', async () => {
        const result = await check({ statuses: ['available'] });

        expect(result.status).toBe(UP);
        expect(outputOf(result)).not.toContain('00:00 America/New_York');
    });

    // ⛔ A headroom no schedule can ever satisfy is a configuration error, not a verdict. Answering `down` to it
    // would refuse every caller at every hour, forever, behind a plausible-looking message.
    it('treats an unsatisfiable required headroom as misuse rather than refusing forever', async () => {
        const result = await check({ statuses: ['available'], requiredHeadroomSeconds: MAX_ACCEPTED_HEADROOM });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('can never be satisfied');
        expect(callsOf(result)).toEqual([]);
    });
});
