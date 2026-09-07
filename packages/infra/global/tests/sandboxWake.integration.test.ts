/**
 * Integration suite for the sandbox DB wake gate's IMPURE half — `sandbox-wake.sh ensure`
 * (`.github/scripts/sandbox-wake.sh`). `__tests__/sandboxWake.test.ts` covers the pure predicates; this covers
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
 * `SANDBOX_WAKE_POLL_SECONDS`, so the real loop runs every iteration without the suite sleeping for it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandbox-wake.sh', import.meta.url));

/** The live sandbox instance identifier (verified against the account 2026-08-19). */
const SANDBOX_ID = 'kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk';
/** The live PROD instance identifier — the one nothing here may ever touch. */
const PROD_ID = 'kitchensink-data-prod-databaseb269d8bb-ci1yhovuyivm';
/** The live sandbox NAT instance and its `Name` tag (verified against the account 2026-08-23). */
const SANDBOX_NAT_ID = 'i-0b126b357d15b35fd';
const SANDBOX_NAT_NAME = 'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance';
/** The live PROD NAT — running, and the one instance a wake must never reach. */
const PROD_NAT_ID = 'i-0d654e6d9f819b231';
const PROD_NAT_NAME = 'Global-prod/Network-prod/Vpc/publicSubnet1/NatInstance';

/**
 * A stub `aws` binary. It logs every invocation to `$AWS_STUB_LOG`, answers discovery from
 * `$AWS_STUB_DISCOVERY`, pops a status per `describe` from `$AWS_STUB_STATUS_FILE` (repeating the last
 * one forever), and either accepts or rejects `start-db-instance` per `$AWS_STUB_START`.
 */
const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >>"\${AWS_STUB_LOG}"

case "$*" in
  *"ec2 start-instances"*)
    if [ "\${AWS_STUB_NAT_START}" = 'FAIL' ]; then
      echo "An error occurred (IncorrectInstanceState): The instance is not in a stopped state." >&2
      exit 254
    fi
    echo '{}'
    exit 0
    ;;
  *"ec2 describe-instances"*"--instance-ids"*)
    # Per-NAT describe: pop the head of the state queue, keeping the last entry forever.
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
    # NAT discovery.
    if [ "\${AWS_STUB_NAT_DISCOVERY}" = 'FAIL' ]; then
      echo "An error occurred (UnauthorizedOperation)" >&2
      exit 254
    fi
    printf '%s\\n' "\${AWS_STUB_NAT_DISCOVERY}"
    exit 0
    ;;
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
    workdir = mkdtempSync(join(tmpdir(), 'sandbox-wake-'));
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
    readonly natDiscovery?: string;
    readonly natStates?: readonly string[];
    readonly natStartFails?: boolean;
    readonly requiredHeadroomSeconds?: number;
    readonly maxBoundaryWaitSeconds?: number;
}): Promise<EnsureResult> => {
    const token = Math.random().toString(36).slice(2);
    const logFile = join(workdir, `aws-${token}.log`);
    const statusFile = join(workdir, `status-${token}.txt`);
    const natStateFile = join(workdir, `nat-state-${token}.txt`);
    writeFileSync(logFile, '');
    writeFileSync(statusFile, `${options.statuses.join(' ')}\n`);
    // ⚠️ The NAT half defaults to an already-running instance so that every RDS case above keeps
    // asserting exactly what it asserted before this half existed. A default of `stopped` would make
    // each of them silently also a NAT-wake test, which is how a suite stops meaning what it says.
    writeFileSync(natStateFile, `${(options.natStates ?? ['running']).join(' ')}\n`);

    const child = spawn('bash', [SCRIPT, 'ensure', 'us-east-1'], {
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_STUB_LOG: logFile,
            AWS_STUB_STATUS_FILE: statusFile,
            AWS_STUB_DISCOVERY: options.discovery ?? SANDBOX_ID,
            AWS_STUB_START: options.startFails === true ? 'FAIL' : 'OK',
            AWS_STUB_NAT_STATE_FILE: natStateFile,
            AWS_STUB_NAT_DISCOVERY: options.natDiscovery ?? `${SANDBOX_NAT_ID}\t${SANDBOX_NAT_NAME}`,
            AWS_STUB_NAT_START: options.natStartFails === true ? 'FAIL' : 'OK',
            SANDBOX_WAKE_POLL_SECONDS: '0',
            SANDBOX_WAKE_TIMEOUT_SECONDS: String(options.timeoutSeconds ?? 60),
            // ⛔ Zero headroom by DEFAULT, so every case above asserts exactly what it asserted before the
            // headroom gate existed. Left at its 45-minute production default, each of them would BLOCK for
            // up to 45 minutes of wall clock whenever the suite happened to run in the band before 00:00 ET
            // — which is precisely when this repo's CI does run (the incident this gate exists for was a
            // 23:52 ET job). A suite whose duration depends on the hour is a suite nobody trusts.
            SANDBOX_WAKE_REQUIRED_HEADROOM_SECONDS: String(options.requiredHeadroomSeconds ?? 0),
            SANDBOX_WAKE_STOP_SETTLE_SECONDS: '0',
            SANDBOX_WAKE_MAX_BOUNDARY_WAIT_SECONDS: String(options.maxBoundaryWaitSeconds ?? 0),
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

describe('sandbox-wake.sh ensure — the file exists', () => {
    it('is present at .github/scripts/sandbox-wake.sh', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });
});

describe('sandbox_wake_ensure — an already-available instance is a no-op', () => {
    it('exits 0 without issuing StartDBInstance', async () => {
        const result = await ensure({ statuses: ['available'] });

        expect(result.status).toBe(0);
        expect(result.awsCalls).not.toContain('start-db-instance');
    });
});

describe('sandbox_wake_ensure — a stopped instance is woken and waited for', () => {
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

describe('sandbox_wake_ensure — race tolerance: a rejected StartDBInstance is not a failed job', () => {
    // Two workflows can reach `stopped` simultaneously; the loser's StartDBInstance returns
    // InvalidDBInstanceState. That is the CORRECT outcome — the instance is coming up — so it must not fail
    // the deploy. The loop, not the call, is the authority.
    it('tolerates InvalidDBInstanceState and succeeds once the instance becomes available', async () => {
        const result = await ensure({ statuses: ['stopped', 'starting', 'available'], startFails: true });

        expect(result.status).toBe(0);
        expect(result.awsCalls).toContain('start-db-instance');
    });
});

describe('sandbox_wake_ensure — the wait is BOUNDED and the timeout is loud', () => {
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

describe('sandbox_wake_ensure — a terminal status fails immediately instead of waiting out the clock', () => {
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

describe('⛔ sandbox_wake_ensure — prod is structurally unreachable', () => {
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

describe('sandbox_wake_ensure — discovery problems fail loudly rather than silently skipping the wake', () => {
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

/**
 * ⛔ THE NAT HALF. Everything above proves the database is awake; none of it would have caught the
 * 2026-08-23 failure, because the database WAS awake and the deploy still died — in Secrets Manager,
 * before Postgres, because the sandbox NAT was stopped and the VPC has no interface endpoints (ADR-0004).
 *
 * These cases mirror the RDS ones deliberately: the same no-op, wake, race, bound and scope shapes, against
 * the other resource. The mirroring is the point — the incident happened because one resource had a gate
 * and its neighbour did not.
 */
describe('sandbox_wake_ensure — the NAT half', () => {
    it('is a no-op when the NAT is already running', async () => {
        const result = await ensure({ statuses: ['available'], natStates: ['running'] });

        expect(result.status).toBe(0);
        expect(result.awsCalls).not.toContain('start-instances');
    });

    it('issues exactly one StartInstances for a stopped NAT, then waits for `running`', async () => {
        const result = await ensure({
            statuses: ['available'],
            natStates: ['stopped', 'pending', 'pending', 'running'],
        });

        expect(result.status).toBe(0);

        const starts = result.awsCalls.split('\n').filter((line) => line.includes('start-instances'));

        expect(starts).toHaveLength(1);
        expect(starts[0]).toContain(SANDBOX_NAT_ID);
    });

    // The same mid-stop race the RDS half handles: StartInstances on a `stopping` instance is rejected, so
    // the gate waits for `stopped` and only then wakes it.
    it('waits for a `stopping` NAT to reach `stopped` before waking it', async () => {
        const result = await ensure({
            statuses: ['available'],
            natStates: ['stopping', 'stopping', 'stopped', 'pending', 'running'],
        });

        expect(result.status).toBe(0);
        expect(result.awsCalls.split('\n').filter((line) => line.includes('start-instances'))).toHaveLength(1);
    });

    it('tolerates a rejected StartInstances and succeeds once the NAT is running', async () => {
        const result = await ensure({
            statuses: ['available'],
            natStates: ['stopped', 'pending', 'running'],
            natStartFails: true,
        });

        expect(result.status).toBe(0);
        expect(result.awsCalls).toContain('start-instances');
    });

    it('fails loudly, and bounded, when the NAT never reaches `running`', async () => {
        const result = await ensure({
            statuses: ['available'],
            natStates: ['stopped'],
            natStartFails: true,
            timeoutSeconds: 0,
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
        expect(`${result.stdout}${result.stderr}`).toContain(SANDBOX_NAT_ID);
    });

    it('fails fast on a terminated NAT rather than waiting out the clock', async () => {
        const result = await ensure({ statuses: ['available'], natStates: ['terminated'] });

        expect(result.status).not.toBe(0);
        expect(result.awsCalls).not.toContain('start-instances');
    });

    it('fails when no sandbox NAT is discovered — a silent skip IS the incident', async () => {
        const result = await ensure({ statuses: ['available'], natDiscovery: '' });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
    });

    it('fails when the NAT discovery call itself fails', async () => {
        const result = await ensure({ statuses: ['available'], natDiscovery: 'FAIL' });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
    });
});

/**
 * ⛔ The prod NAT is live in this account and is never stopped, so a wake that reached it could only ever be
 * a mistake. The server-side filter narrows to a `sandbox` Name tag; these feed discovery values that filter
 * could not have returned, which is what proves the CLIENT-side re-assertion is doing real work.
 */
describe('⛔ sandbox_wake_ensure — the prod NAT is structurally unreachable', () => {
    it('refuses to act when NAT discovery returns the prod NAT', async () => {
        const result = await ensure({
            statuses: ['available'],
            natDiscovery: `${PROD_NAT_ID}\t${PROD_NAT_NAME}`,
            natStates: ['stopped'],
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain('::error::');
        expect(result.awsCalls).not.toContain('start-instances');
    });

    it('refuses the whole run when discovery mixes the prod NAT in with the sandbox one', async () => {
        const result = await ensure({
            statuses: ['available'],
            natDiscovery: `${SANDBOX_NAT_ID}\t${SANDBOX_NAT_NAME}\n${PROD_NAT_ID}\t${PROD_NAT_NAME}`,
            natStates: ['stopped'],
        });

        expect(result.status).not.toBe(0);
        expect(result.awsCalls).not.toContain('start-instances');
    });

    // A name carrying BOTH markers is the case a bare `contains('sandbox')` admits — the prod veto is the
    // only thing that refuses it, and this is what fails if someone removes that veto as redundant.
    it('refuses a NAT whose name carries both markers', async () => {
        const result = await ensure({
            statuses: ['available'],
            natDiscovery: `${SANDBOX_NAT_ID}\tGlobal-prod/Network-sandbox/Vpc/publicSubnet1/NatInstance`,
            natStates: ['stopped'],
        });

        expect(result.status).not.toBe(0);
        expect(result.awsCalls).not.toContain('start-instances');
    });
});

/**
 * The composition rule: a deploy needs BOTH. A gate that reported only the first failure would send the
 * operator back for a second round trip to learn the second.
 */
describe('sandbox_wake_ensure — both halves are reported in one run', () => {
    it('names the database AND the NAT when both are unreachable', async () => {
        const result = await ensure({
            statuses: ['stopped'],
            startFails: true,
            natStates: ['stopped'],
            natStartFails: true,
            timeoutSeconds: 0,
        });

        expect(result.status).not.toBe(0);

        const output = `${result.stdout}${result.stderr}`;

        expect(output).toContain(SANDBOX_ID);
        expect(output).toContain(SANDBOX_NAT_ID);
    });

    it('still fails when only the NAT is unreachable, even though the database is available', async () => {
        const result = await ensure({
            statuses: ['available'],
            natStates: ['stopped'],
            natStartFails: true,
            timeoutSeconds: 0,
        });

        expect(result.status).not.toBe(0);
        expect(`${result.stdout}${result.stderr}`).toContain(SANDBOX_NAT_ID);
    });
});

/**
 * ⛔ THE HEADROOM GATE — the 2026-09-05 wedge of `kitchensink-data-sandbox`.
 *
 * Run 33943032063 of `sandbox-identity-deploy.yml` passed the wake gate at 03:52:52Z with a TRUE
 * `available (ready)`; the scheduler issued `StopDBInstance` at 04:00:07Z; CloudFormation's
 * `ModifyDBInstance` died at 04:02:11Z on `Cannot modify a stopped DB Instance`, and the rollback failed the
 * same way. Neither of the two gates this file already covers could have caught it — both were green.
 *
 * The verdict itself is pinned against literal epochs (including both DST changeover nights) in
 * `__tests__/sandboxWake.test.ts`. What is proven HERE is the wiring: that `ensure` consults it, honours a
 * `crossing` verdict by refusing rather than falling through, and issues NOTHING mutating while it does.
 *
 * ⚠️ The wall clock is a genuine input to this gate, and the suite says so rather than pretending otherwise.
 * A `crossing` verdict can only be forced when the live headroom is below the largest headroom the gate will
 * accept (`SANDBOX_WAKE_MIN_SCHEDULE_PERIOD_SECONDS`, 79200) — true for 22 of every 24 hours, and false for
 * the ~2 hours just after 00:00 ET, when the next stop is nearly a full day away. Both arms assert
 * something substantive, and the arm taken is named in the failure message.
 */
describe('sandbox_wake_ensure — a deploy that would CROSS the 00:00 ET stop is refused, not waved through', () => {
    /** The largest headroom the gate will accept as a request; one more is misuse. */
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

    it('refuses, mutates nothing, and names the boundary — or, inside the post-midnight band, proceeds', async () => {
        const headroom = liveHeadroom();
        const forcesCrossing = headroom + 1 < MAX_ACCEPTED_HEADROOM;

        const result = await ensure({
            statuses: ['available'],
            // One second more than remains: `crossing` by construction, for any clock outside the band.
            requiredHeadroomSeconds: forcesCrossing ? headroom + 1 : MAX_ACCEPTED_HEADROOM - 1,
            maxBoundaryWaitSeconds: 0,
        });

        if (forcesCrossing) {
            expect(result.status, `crossing arm (headroom ${headroom}s): the gate must FAIL`).toBe(1);
            expect(result.stdout).toContain('Waiting for the boundary');
            expect(result.stdout).toContain('did not reach the 00:00 America/New_York boundary');
            // ⛔ The whole point: nothing was started, and no deploy was allowed past.
            expect(result.awsCalls).not.toContain('start-db-instance');
            expect(result.awsCalls).not.toContain('start-instances');

            return;
        }

        expect(result.status, `clear arm (headroom ${headroom}s): the gate must PASS`).toBe(0);
        expect(result.stdout).not.toContain('Waiting for the boundary');
    });

    // The negative case, and it holds at EVERY hour: a caller that declares no headroom requirement must
    // never be delayed or refused. This is what keeps the gate from becoming a nightly outage of its own.
    it('does not fire for a caller with zero required headroom, at any hour', async () => {
        const result = await ensure({ statuses: ['available'] });

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain('Waiting for the boundary');
        expect(result.stdout).toContain('is available');
    });

    // ⛔ A headroom no schedule can ever satisfy is a configuration error, not a verdict. Answering
    // `crossing` to it would refuse every deploy at every hour, forever, behind a plausible-looking message.
    it('treats an unsatisfiable required headroom as misuse rather than refusing forever', async () => {
        const result = await ensure({ statuses: ['available'], requiredHeadroomSeconds: MAX_ACCEPTED_HEADROOM });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('can never be satisfied');
        expect(result.awsCalls).not.toContain('start-db-instance');
    });
});
