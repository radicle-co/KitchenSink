/**
 * Repo-wide guard: the sandbox STATUS CHECK (`.github/scripts/sandboxWake.sh check`).
 *
 * ## What changed, and the ruling behind it (owner, 2026-10-12)
 *
 * This script used to WAKE the sandbox: `ensure` started the stopped RDS instance and the stopped NAT before a
 * deploy or a test run. The owner ruled that the sandbox starts ONLY by hand (the Sandbox Up workflow) and that
 * no push, schedule or test job may start it: "There should not be a wake of CI push. I never authorized that."
 * (docs/plans/2026-10-12-001-fix-sandbox-manual-start-plan.md, D2.) `ensure`, `db_wake_start` and
 * `nat_wake_start` are deleted. What is left answers one question, "is the sandbox up?", and issues only
 * `describe` calls: exit 0 up, 3 down (or inside the pre-midnight headroom), 1 error, 2 misuse.
 *
 * ## The incidents that still shape it
 *
 * - 2026-09-05: a deploy that STARTED before 00:00 ET and CROSSED the nightly stop wedged
 *   `kitchensink-data-sandbox` in UPDATE_ROLLBACK_FAILED. The headroom rule survives, and now answers "down"
 *   for a caller that would not finish before the stop, instead of waiting for the boundary.
 * - The sandbox VPC has no interface endpoints (ADR-0004), so every VPC Lambda reaches AWS through the sandbox
 *   NAT. "Up" therefore means the database AND the NAT.
 *
 * ## Why the predicates are executed as real `bash`
 *
 * Same reason as `prScope.test.ts` and `deployGate.test.ts`: a TypeScript re-implementation would be a SECOND
 * copy of a decision that could drift from the one CI actually runs. The decision half (`classify`,
 * `is-sandbox-instance`) is PURE; everything that touches RDS and EC2 lives in `check` and is covered by
 * `tests/sandboxWake.integration.test.ts`.
 *
 * ## The scoping rule is a SAFETY boundary
 *
 * The account holds exactly two DB instances, `kitchensink-data-prod-…` and `kitchensink-data-sandbox-…`. Prod
 * is never stopped, so a check that read it would report "up" for a sandbox that is down. `check` therefore
 * takes NO instance identifier: it DISCOVERS instances and refuses every one that is not sandbox-scoped.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/sandboxWake.sh', import.meta.url));

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
 * Identifiers the check must REFUSE. The prod instance is the one that matters; the rest are the near-misses a
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

describe('sandboxWake.sh — the file exists where the workflows invoke it from', () => {
    it('is present at .github/scripts/sandboxWake.sh', () => {
        expect(existsSync(SCRIPT), `expected the sandbox status check at ${SCRIPT}`).toBe(true);
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

describe('db_wake_classify — every RDS lifecycle status maps to exactly one verdict', () => {
    it('reports `ready` for an instance that is already available', () => {
        expect(run('classify', 'available').stdout).toBe('ready');
    });

    // Owner ruling 2026-10-12: nothing here starts anything, so a stopped instance is simply DOWN.
    it.each(['stopped', 'stopping'])(
        'reports `down` for the status %s — waiting on a stop would be waiting on nothing',
        (status) => {
            expect(run('classify', status).stdout).toBe('down');
        },
    );

    it('has no `wake` verdict any more', () => {
        const verdicts = ['available', 'stopped', 'stopping', 'starting', 'failed', 'banana'].map(
            (status) => run('classify', status).stdout,
        );

        expect(verdicts).not.toContain('wake');
    });

    it.each([
        'starting',
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

    // An unrecognised status is `fatal` ON PURPOSE. Both alternatives end in an error; `fatal` ends it in
    // seconds with the status named, while `wait` burns the whole timeout first and says the same thing.
    it('reports `fatal` for a status it does not recognise', () => {
        expect(run('classify', 'banana').stdout).toBe('fatal');
    });

    it('treats a missing status as misuse', () => {
        expect(run('classify').status).toBe(2);
    });
});

describe('sandboxWake.sh — misuse fails loudly instead of guessing', () => {
    it('refuses an unknown subcommand', () => {
        expect(run('nonsense').status).toBe(2);
    });

    it('refuses `check` without a region', () => {
        expect(run('check').status).toBe(2);
    });

    // The whole point of the discovery design: there is no identifier argument to get wrong.
    it('refuses `check` when handed an instance identifier', () => {
        expect(run('check', 'us-east-1', 'kitchensink-data-prod-databaseb269d8bb-ci1yhovuyivm').status).toBe(2);
    });
});

/**
 * ⛔ OWNER RULING 2026-10-12: NOTHING IN CI STARTS THE SANDBOX. The script is read as TEXT, comments included,
 * so the verbs cannot come back under a comment that "explains" them, and a subcommand cannot be re-added.
 */
describe('sandboxWake.sh — it can only LOOK', () => {
    it('contains no start verb for RDS or EC2, and no `ensure`, `wake` function or stop/modify verb', () => {
        const source = readFileSync(SCRIPT, 'utf8');

        for (const forbidden of [
            'start-db-instance',
            'start-instances',
            'stop-db-instance',
            'stop-instances',
            'modify-db-instance',
            'db_wake_start',
            'nat_wake_start',
            'sandbox_wake_ensure',
            'nat_wake_ensure',
        ]) {
            expect(source, `${forbidden} must not appear in the status check`).not.toContain(forbidden);
        }
    });

    it('has no `ensure` subcommand: it is refused as misuse', () => {
        expect(run('ensure', 'us-east-1').status).toBe(2);
    });

    it('the only AWS verbs it names are describe calls', () => {
        const verbs = [...readFileSync(SCRIPT, 'utf8').matchAll(/\baws (rds|ec2) ([a-z-]+)/gu)].map(
            (match) => `${match[1]} ${match[2]}`,
        );

        expect(verbs.length).toBeGreaterThan(0);
        expect(
            verbs.filter((verb) => !verb.endsWith(' describe-db-instances') && !verb.endsWith(' describe-instances')),
        ).toEqual([]);
    });
});

/**
 * ⛔ THE NAT IS HALF OF "UP". The sandbox VPC has no interface endpoints (ADR-0004: $14.60/month/stage against a
 * $3-4/month NAT), so every VPC-attached Lambda reaches Secrets Manager, SQS and Clerk through one `t4g.nano`.
 * Measured 2026-08-23: the database was `available`, the NAT was `stopped`, and a migration died in the
 * Secrets Manager fetch with `ETIMEDOUT` before it ever reached Postgres. A check that only looked at RDS
 * would have said "up".
 *
 * ## The predicate mirrors `selectSandboxNatInstances`
 *
 * `lib/sandbox-scheduler/scheduler.ts` identifies the NAT by a DISABLED source/destination check plus a
 * `sandbox` marker in the `Name` tag. This is the same rule in the runtime CI uses, with one tightening: a name
 * carrying `prod` is refused outright. Reading the prod NAT would report "up" for a sandbox that is down.
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

    it.each(['stopped', 'stopping'])('reports `down` for the state %s', (state) => {
        expect(run('classify-ec2', state).stdout).toBe('down');
    });

    // `shutting-down` resolves to `terminated`, which is fatal; waiting names the real state in the error.
    it.each(['pending', 'shutting-down', 'UNREADABLE'])('reports `wait` for the transient state %s', (state) => {
        expect(run('classify-ec2', state).stdout).toBe('wait');
    });

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
 * | `03:52:52` | 23:52:52 | the wake gate reports `available (ready)` + NAT `running (ready)`        |
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
 * rather than only inside `check`.
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
