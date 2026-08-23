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
