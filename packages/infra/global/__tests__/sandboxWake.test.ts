/**
 * Repo-wide guard: the sandbox database WAKE gate (`.github/scripts/sandbox-wake.sh`).
 *
 * ## The incident this exists to prevent
 *
 * ADR-0007 stops the sandbox RDS instance nightly (00:00–09:00 ET). ADR-0022 moved schema migrations
 * INSIDE the deploy, as an `aws-cdk-lib/triggers` Trigger the ECS service depends on. Composed, those two
 * accepted decisions produce a failure neither predicted: a deploy that lands inside the shutdown window
 * runs its migration Trigger against a STOPPED instance, gets `connect ETIMEDOUT 10.1.4.241:5432`, and
 * fails the stack update — and then the ROLLBACK fails for exactly the same reason, leaving the stack in
 * `UPDATE_ROLLBACK_FAILED`. Observed 00:31 EDT on `kitchensink-recipe-service-pr-91`; recovery needed a
 * hand-run `continue-update-rollback --resources-to-skip RecipeSchemaMigrations`, and every sandbox deploy
 * in between failed on the wedged state rather than on anything in the diff.
 *
 * `SandboxSchedulerStack` already holds BOTH `rds:StopDBInstance` and `rds:StartDBInstance` — nothing woke
 * the instance ON DEMAND. This script is that missing half.
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `prScope.test.ts` and `deployGate.test.ts`: a TypeScript re-implementation would be a
 * SECOND copy of a decision that could drift from the one CI actually runs. These tests shell out to the
 * real script. The decision half (`classify`, `is-sandbox-instance`) is PURE; everything that touches RDS
 * lives in `ensure` and is covered by `tests/sandboxWake.integration.test.ts`.
 *
 * ## The scoping rule is a SAFETY boundary
 *
 * The account holds exactly two DB instances — `kitchensink-data-prod-…` and `kitchensink-data-sandbox-…`
 * — and prod's is never stopped, so a wake that reached it could only ever be a mistake. `ensure` therefore
 * takes NO instance identifier at all: it DISCOVERS instances and refuses every one that is not
 * sandbox-scoped, so there is no argument a caller could typo into prod.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandbox-wake.sh', import.meta.url));

/**
 * Run a subcommand of the real script.
 *
 * @param args - The subcommand and its arguments.
 * @returns Trimmed stdout, stderr, and the exit status.
 * @sideEffect Spawns `bash`.
 */
const run = (...args: readonly string[]): { stdout: string; stderr: string; status: number } => {
    const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

    if (result.error) {
        throw result.error;
    }

    return { stdout: (result.stdout ?? '').trim(), stderr: result.stderr ?? '', status: result.status ?? -1 };
};

/** Identifiers that ARE the shared sandbox instance (CDK generates `{stackName}-{logicalId}-{hash}`). */
const SANDBOX_IDENTIFIERS = ['kitchensink-data-sandbox', 'kitchensink-data-sandbox-databaseb269d8bb-p76w6xmz1xlk'];

/**
 * Identifiers a wake must REFUSE. The prod instance is the one that matters; the rest are the near-misses a
 * bare `contains`/prefix rule would let through.
 */
const REFUSED_IDENTIFIERS = [
    'kitchensink-data-prod-databaseb269d8bb-ci1yhovuyivm',
    'kitchensink-data-prod',
    'kitchensink-data-sandboxprod',
    'kitchensink-data-sandbox2-databaseb269d8bb-aaaa',
    'my-kitchensink-data-sandbox-databaseb269d8bb-aaaa',
    'sandbox',
    'kitchensink-data-sandbox ',
    'kitchensink-data-sandbox*',
    'kitchensink-data-sandbox-../prod',
    'KITCHENSINK-DATA-SANDBOX-DATABASE',
];

describe('sandbox-wake.sh — the file exists where the workflows invoke it from', () => {
    it('is present at .github/scripts/sandbox-wake.sh', () => {
        expect(existsSync(SCRIPT), `expected the sandbox DB wake gate at ${SCRIPT}`).toBe(true);
    });
});

describe('db_wake_is_sandbox_instance — the prod database is structurally unreachable', () => {
    it.each(SANDBOX_IDENTIFIERS)('accepts the shared sandbox instance %s', (identifier) => {
        expect(run('is-sandbox-instance', identifier).status).toBe(0);
    });

    // THE safety assertion. `kitchensink-data-prod-…` is a real, live instance in the same account and the
    // same region; the only thing between this script and it is this predicate.
    it.each(REFUSED_IDENTIFIERS)('refuses %j', (identifier) => {
        expect(run('is-sandbox-instance', identifier).status).toBe(1);
    });

    it('treats a missing identifier as misuse, not as "no"', () => {
        expect(run('is-sandbox-instance').status).toBe(2);
    });
});

describe('db_wake_classify — every RDS lifecycle status maps to exactly one action', () => {
    it('reports `ready` for an instance that is already available', () => {
        expect(run('classify', 'available').stdout).toBe('ready');
    });

    it('reports `wake` for a stopped instance — the ONLY status that may issue StartDBInstance', () => {
        expect(run('classify', 'stopped').stdout).toBe('wake');
    });

    // `stopping` is the 00:31 race: the nightly scheduler is mid-stop. StartDBInstance would be rejected
    // with InvalidDBInstanceState, so the correct move is to wait for `stopped` and then start.
    it.each([
        'starting',
        'stopping',
        'creating',
        'rebooting',
        'modifying',
        'backing-up',
        'maintenance',
        'renaming',
        'resetting-master-credentials',
        'storage-optimization',
        'upgrading',
        'configuring-enhanced-monitoring',
        'configuring-iam-database-auth',
        'configuring-log-exports',
        'converting-to-vpc',
        'moving-to-vpc',
        'storage-config-upgrade',
        'delete-precheck',
        'UNREADABLE',
    ])('reports `wait` for the transient status %s', (status) => {
        expect(run('classify', status).stdout).toBe('wait');
    });

    it.each([
        'deleting',
        'failed',
        'incompatible-network',
        'incompatible-parameters',
        'incompatible-option-group',
        'incompatible-restore',
        'inaccessible-encryption-credentials',
        'inaccessible-encryption-credentials-recoverable',
        'insufficient-capacity',
        'restore-error',
        'storage-full',
    ])('reports `fatal` for the terminal status %s', (status) => {
        expect(run('classify', status).stdout).toBe('fatal');
    });

    // An unrecognised status is `fatal` ON PURPOSE. Both alternatives end red; `fatal` ends red in seconds
    // with the status named, while `wait` burns the whole timeout first and says the same thing.
    it('reports `fatal` for a status it does not recognise', () => {
        expect(run('classify', 'banana').stdout).toBe('fatal');
    });

    it('treats a missing status as misuse', () => {
        expect(run('classify').status).toBe(2);
    });
});

describe('sandbox-wake.sh — misuse fails loudly instead of guessing', () => {
    it('refuses an unknown subcommand', () => {
        expect(run('nonsense').status).toBe(2);
    });

    it('refuses `ensure` without a region', () => {
        expect(run('ensure').status).toBe(2);
    });

    // The whole point of the discovery design: there is no identifier argument to get wrong.
    it('refuses `ensure` when handed an instance identifier', () => {
        expect(run('ensure', 'us-east-1', 'kitchensink-data-prod-databaseb269d8bb-ci1yhovuyivm').status).toBe(2);
    });
});

/**
 * ⛔ THE SECOND HALF OF THE SAME INCIDENT — and the reason this file is no longer called `dbWake`.
 *
 * The gate above woke the sandbox DATABASE and, by its own header, deliberately "never touches ECS or the
 * NAT instance". That reasoning was wrong, and the branch's CI proved it: `SandboxSchedulerStack` stops the
 * sandbox NAT **instance** on the same nightly schedule, and the sandbox VPC has NO interface endpoints
 * (ADR-0004 forbids them on cost grounds — $14.60/month/stage against a $3–4/month NAT). So every
 * VPC-attached Lambda reaches Secrets Manager, SQS and the Clerk API through that one `t4g.nano`.
 *
 * Measured, not inferred, on 2026-08-23:
 *
 *   - the sandbox DB was `available` (the gate above had done its job, and the RDS event log confirms
 *     `DB instance started` at 04:13Z),
 *   - `i-0b126b357d15b35fd` — `Global-sandbox/…/NatInstance` — was `stopped`,
 *   - `describe-vpc-endpoints` on the sandbox VPC returned NOTHING,
 *   - and invoking the identity migration runner by hand returned
 *     `TimeoutError … AggregateError [ETIMEDOUT] at internalConnectMultiple`.
 *
 * Note the shape of that error: no address. The 00:31 incident named `10.1.4.241:5432` because it really
 * was Postgres refusing; this one dies BEFORE Postgres, in the Secrets Manager fetch that resolves
 * `DB_SECRET_ARN`. A wake gate that only ever looks at RDS reports success and the deploy still fails.
 *
 * ## The predicate mirrors `selectSandboxNatInstances`, and only ever STARTS
 *
 * `lib/sandbox-scheduler/scheduler.ts` identifies the NAT by a DISABLED source/destination check plus a
 * `sandbox` marker in the `Name` tag. This is the same rule in the runtime CI actually uses — the same
 * bash-vs-TypeScript duality already accepted for the RDS predicate — with one tightening: a name carrying
 * `prod` is refused outright. The prod NAT is live in this account, and while STARTING an already-running
 * instance is harmless, a scope surprise is refused rather than worked around.
 */
describe('nat_wake_is_sandbox_nat — the prod NAT is structurally unreachable', () => {
    it.each([
        'Global-sandbox/Network-sandbox/Vpc/publicSubnet1/NatInstance',
        'global-sandbox/network-sandbox/vpc/publicsubnet1/natinstance',
        'kitchensink-sandbox-nat',
    ])('accepts the sandbox NAT named %j', (nameTag) => {
        expect(run('is-sandbox-nat', nameTag).status).toBe(0);
    });

    it.each([
        'Global-prod/Network-prod/Vpc/publicSubnet1/NatInstance',
        // ⛔ Carries BOTH markers. A bare `contains('sandbox')` admits it; the prod veto is what refuses it.
        'Global-prod/Network-sandbox/Vpc/publicSubnet1/NatInstance',
        'kitchensink-production-nat',
        'Global-PROD/NatInstance',
        'some-other-instance',
        '',
    ])('refuses %j', (nameTag) => {
        expect(run('is-sandbox-nat', nameTag).status).not.toBe(0);
    });

    it('treats a missing name tag as misuse, not as "no"', () => {
        expect(run('is-sandbox-nat').status).toBe(2);
    });
});

/**
 * EC2 lifecycle states are a different vocabulary from RDS's, so they get their own classifier rather than
 * being folded into `db_wake_classify` — `stopping` means the same thing in both, but `available` is not an
 * EC2 state and `running` is not an RDS one, and a single table that accepted both would accept nonsense.
 */
describe('nat_wake_classify — every EC2 lifecycle state maps to exactly one action', () => {
    it('reports `ready` for a running instance', () => {
        expect(run('classify-ec2', 'running').stdout).toBe('ready');
    });

    it('reports `wake` for a stopped instance — the ONLY state that may issue StartInstances', () => {
        expect(run('classify-ec2', 'stopped').stdout).toBe('wake');
    });

    // Same race as the RDS half: StartInstances on a `stopping` instance is rejected, so wait for
    // `stopped` and then start it.
    it.each(['pending', 'stopping', 'shutting-down', 'UNREADABLE'])(
        'reports `wait` for the transient state %s',
        (state) => {
            expect(run('classify-ec2', state).stdout).toBe('wait');
        },
    );

    it.each(['terminated', 'banana'])('reports `fatal` for %s', (state) => {
        expect(run('classify-ec2', state).stdout).toBe('fatal');
    });

    it('treats a missing state as misuse', () => {
        expect(run('classify-ec2').status).toBe(2);
    });
});

/**
 * ⛔ THE THIRD INCIDENT — and the one the two gates above CANNOT catch, because both of them passed.
 *
 * Measured on the live account, 2026-09-05, run `33943032063` of `sandbox-identity-deploy.yml`:
 *
 * | UTC        | ET       | what happened                                                              |
 * | ---------- | -------- | -------------------------------------------------------------------------- |
 * | `03:52:09` | 23:52:09 | the job starts                                                              |
 * | `03:52:52` | 23:52:52 | `sandbox-wake.sh ensure` reports `available (ready)` + NAT `running (ready)` |
 * | `04:00:07` | 00:00:07 | the scheduler Lambda issues `StopDBInstance` (ADR-0007's nightly stop)       |
 * | `04:02:11` | 00:02:11 | CloudFormation issues `ModifyDBInstance` on `DatabaseB269D8BB`              |
 * | `04:04:24` | 00:04:24 | `UPDATE_FAILED` — `Cannot modify a stopped DB Instance`                     |
 * | `04:07:05` | 00:07:05 | the rollback re-issues the same modify → `UPDATE_ROLLBACK_FAILED`           |
 *
 * The gate did not fail and was not missing. It answered a question that was TRUE when it was asked and
 * FALSE nine minutes later: a time-of-check-to-time-of-use race against the 00:00 ET boundary. Every
 * artefact written before this — the script header, ADR-0007's 2026-08-23 update, ADR-0028 §"Cost" — frames
 * the hazard as "a deploy that LANDS inside the window". This is a deploy that STARTS OUTSIDE it and
 * CROSSES IN, which no wake can fix, because there is nothing to wake at the moment of the check.
 *
 * ⚠️ Note also that the failing operation is NOT the ADR-0022 migration Trigger. It is CloudFormation's own
 * `ModifyDBInstance` on the RDS resource in `DataStack`, which is entered on EVERY data-stack deploy
 * (verified over nine consecutive updates on 2026-09-04). So the exposure does not depend on a stack owning
 * a migration Trigger, and the error string is different (`Cannot modify a stopped DB Instance`, not
 * `connect ETIMEDOUT`) — which is why a reader searching for the known symptom finds nothing.
 *
 * The cure is that the gate must stop asserting "the database is up NOW" and start asserting "the database
 * will STILL be up when the caller is done" — a headroom check against the next 00:00 America/New_York.
 * That decision is pure and calendar-dependent, so it is exposed as its own subcommand and tested here
 * rather than only inside `ensure`.
 */
describe('sandbox_wake_next_stop — the next 00:00 America/New_York, DST and all', () => {
    // Epochs are pinned as literals with their ET rendering in the name: a helper that recomputed them
    // would share any bug with the code under test.
    it.each([
        // The incident itself: 23:52:52 EDT → the stop 7m08s later.
        [1788580372, 1788580800, '2026-09-04 23:52:52 EDT → 2026-09-05 00:00 EDT'],
        // Just past a boundary: the next stop is a full day out, which is what makes a woken instance safe.
        [1788582600, 1788667200, '2026-09-05 00:30 EDT → 2026-09-06 00:00 EDT'],
        [1788616800, 1788667200, '2026-09-05 10:00 EDT → 2026-09-06 00:00 EDT'],
        // Winter — the offset is EST, so a UTC-arithmetic implementation lands an hour wrong.
        [1768451400, 1768453200, '2026-01-14 23:30 EST → 2026-01-15 00:00 EST'],
    ])('next-stop(%d) = %d   (%s)', (now, expected) => {
        expect(run('next-stop', String(now)).stdout).toBe(String(expected));
    });

    // ⛔ The boundary is STRICTLY after `now`. At exactly 00:00 the stop for that midnight has fired; the
    // one that matters is tomorrow's. An inclusive comparison answers `now`, which makes the headroom zero
    // for the whole second and refuses a deploy that is in fact perfectly safe.
    it('answers TOMORROW when handed the boundary instant itself', () => {
        expect(run('next-stop', '1788580800').stdout).toBe('1788667200');
    });

    // ⛔ THE DST CASES. These are the reason this is `TZ=America/New_York` date arithmetic and not
    // `now - (now % 86400)`: the interval between two consecutive stops is 82800s across spring-forward and
    // 90000s across fall-back, and a fixed 86400 is wrong on both nights in opposite directions.
    it('spans only 22 hours across spring-forward (2026-03-08)', () => {
        const answer = Number(run('next-stop', '1772949600').stdout);

        expect(answer, '2026-03-08 01:00 EST → 2026-03-09 00:00 EDT').toBe(1773028800);
        expect(answer - 1772949600).toBe(79_200);
    });

    it('spans 25 hours across fall-back (2026-11-01)', () => {
        const answer = Number(run('next-stop', '1793505600').stdout);

        expect(answer, '2026-11-01 00:00 EDT → 2026-11-02 00:00 EST').toBe(1793595600);
        expect(answer - 1793505600).toBe(90_000);
    });

    it.each([[], ['banana'], ['1788580372x'], ['-1']])('treats %j as misuse', (...args) => {
        expect(run('next-stop', ...(args as string[])).status).toBe(2);
    });
});

describe('sandbox_wake_headroom — would the database still be up when the caller finishes?', () => {
    // ⛔ THE NON-VACUITY CASE. These are the exact inputs of run 33943032063. If this ever reports `clear`,
    // the guard has stopped guarding the incident it was written for.
    it('reports `crossing` for the 23:52:52 EDT deploy that wedged kitchensink-data-sandbox', () => {
        expect(run('headroom', '1788580372', '2700').stdout).toBe('crossing');
    });

    // The other side: a mid-morning deploy has fourteen hours of headroom and must not be delayed.
    it('reports `clear` for a 10:00 EDT deploy', () => {
        expect(run('headroom', '1788616800', '2700').stdout).toBe('clear');
    });

    // The comparison is `>=`, so a caller that fits EXACTLY proceeds. Asserted from both sides, one second
    // apart, because an off-by-one here is invisible in production until the night it is not.
    it('reports `clear` when the headroom is exactly what was asked for', () => {
        expect(run('headroom', String(1788580800 - 2700), '2700').stdout).toBe('clear');
    });

    it('reports `crossing` one second short of that', () => {
        expect(run('headroom', String(1788580800 - 2700 + 1), '2700').stdout).toBe('crossing');
    });

    // ⛔ A headroom at or beyond the schedule's own period can NEVER be satisfied — waiting for the boundary
    // would leave the caller in `crossing` again and loop forever. That is misuse, not a verdict.
    it.each(['86400', '90000'])('refuses an unsatisfiable headroom of %s seconds', (required) => {
        expect(run('headroom', '1788616800', required).status).toBe(2);
    });

    it.each([[], ['1788580372'], ['1788580372', 'banana'], ['banana', '2700']])('treats %j as misuse', (...args) => {
        expect(run('headroom', ...(args as string[])).status).toBe(2);
    });
});
