/**
 * Integration suite for `.github/scripts/teardown-sandbox-pr.sh` §0c and §1 — waking the shared tier, and
 * dropping EVERY per-PR logical database rather than food's alone.
 *
 * ## The two defects it exists for
 *
 * **1. Half the databases were never dropped.** §1 hardcoded `kitchensink-food-service-$PR` and the output
 * key `FoodMigrationFunctionName`. `RecipeServiceStack` has exported `RecipeMigrationFunctionName` since it
 * shipped and `recipe-service`'s migrate handler implements `action: 'drop'` — and nothing ever invoked it.
 * Every reaped recipe preview left `kitchensink_recipes_pr_{N}` behind, silently: the script reported
 * success for dropping what it was told to drop, the stack deleted cleanly, and a logical database is not a
 * CloudFormation resource so nothing in the console showed it.
 *
 * **2. The drop could not have worked at its most common trigger time anyway.** A preview expires at 00:00
 * America/New_York, `SandboxSchedulerStack`'s STOP schedule fires at 00:00 America/New_York, and
 * `sandbox-reconcile.yml` runs at :17 — so the reconciler invokes an in-VPC Lambda against a database that
 * was stopped seventeen minutes earlier. Nothing in either reclamation path woke the tier.
 *
 * `perPrDatabaseDropDoors.test.ts` proves the CONVENTION statically — every per-PR database has a drop door
 * and the script names none of them individually. It cannot prove the script's control flow: that the doors
 * are found across ALL of the PR's stacks, that the wake precedes the drop, or that a wake failure does not
 * take the rest of the teardown with it. That is what this file is for.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the teardown script and the `sandbox-wake.sh`, `ecs-quiesce.sh` and `pr-scope.sh` it invokes,
 *   executed as `bash` in a child process. Never re-implemented.
 * - **Stubbed**: `aws`, `gh` and `npx`, as executables placed first on `PATH`. The `aws` stub logs every
 *   invocation and answers from canned fixtures.
 *
 * The call LOG is the assertion surface, exactly as in `ecsQuiesce.integration.test.ts`: the guarantees under
 * test are *which* functions were invoked and *in what order*, and a test that only checked the exit status
 * would pass a script that dropped nothing.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. §1's discovery reverted to the hardcoded `FoodMigrationFunctionName` query → `drops the database
 *      behind EVERY migration-runner output` fails, naming the recipe function. This is the red-before-green
 *      run for the real defect.
 *   2. The `[[ $key =~ $DROP_DOOR_PATTERN ]]` filter removed → `invokes nothing for an output that is not a
 *      drop door` fails, and the script invokes `{"action":"drop"}` at a service URL output.
 *   3. The §0c wake moved BELOW §1 → `wakes the shared tier BEFORE it invokes any drop` fails.
 *   4. The wake's `|| teardown_failed=1` branch changed to `exit 1` → `a failed wake does not stop the stack
 *      deletes` fails, and the stacks leak — the 2026-07-28 incident shape that
 *      `sandboxReclamationReachability.test.ts` invariant 1 exists to forbid.
 *   5. `PR_STACKS` computed twice (once per section) instead of shared → not detectable here, and
 *      deliberately so: it is a consistency property, asserted by construction in the script rather than by
 *      a test that would have to race the API.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/teardown-sandbox-pr.sh', import.meta.url));

let workdir: string;
let binDir: string;
let logFile: string;

/**
 * A stub `aws` that logs every call and answers from files the test writes.
 *
 * `describe-stacks` is routed on the `--query` it carries, because the script asks that one verb three
 * different questions — the Environment tag, and the outputs — and answering them alike would make the
 * outputs test pass for the wrong reason.
 */
const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AWS_CALL_LOG"
case "$1 $2" in
    'rds describe-db-instances')
        case "$*" in
            *DBInstanceStatus*) echo 'available' ;;
            *) cat "$AWS_STUB_DIR/db-instances" 2>/dev/null || true ;;
        esac
        ;;
    'ec2 describe-instances')
        case "$*" in
            *State.Name*) echo 'running' ;;
            *) cat "$AWS_STUB_DIR/nat-instances" 2>/dev/null || true ;;
        esac
        ;;
    'cloudformation list-stacks') cat "$AWS_STUB_DIR/stacks" 2>/dev/null || true ;;
    'cloudformation describe-stacks')
        stack=''
        for arg in "$@"; do
            [ "$prev" = '--stack-name' ] && stack="$arg"
            prev="$arg"
        done
        case "$*" in
            *Tags*) cat "$AWS_STUB_DIR/tag-$stack" 2>/dev/null || echo 'None' ;;
            *Outputs*) cat "$AWS_STUB_DIR/outputs-$stack" 2>/dev/null || true ;;
        esac
        ;;
    'lambda invoke')
        for arg in "$@"; do
            case "$arg" in /*.json) echo '{"dropped":"dropped"}' > "$arg" ;; esac
        done
        ;;
    *) : ;;
esac
exit 0
`;

/** `gh` and `npx` are stubbed to succeed and log, so sections 0/0b never dominate the assertions. */
const TRIVIAL_STUB = `#!/usr/bin/env bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$AWS_CALL_LOG"
exit 0
`;

interface RunResult {
    readonly status: number;
    readonly stdout: string;
    /** Every stubbed invocation, in order, one argv string per line. */
    readonly calls: readonly string[];
}

/** Fixture files the `aws` stub reads, keyed by the name it looks them up under. */
type Fixtures = Readonly<Record<string, string>>;

/** Run the real teardown script with the stub CLIs first on PATH. */
function run(token: string, fixtures: Fixtures, env: Readonly<Record<string, string>> = {}): RunResult {
    for (const [name, value] of Object.entries(fixtures)) {
        writeFileSync(join(workdir, name), `${value}\n`);
    }

    const result = spawnSync('bash', [SCRIPT, token, 'us-east-1'], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
            AWS_CALL_LOG: logFile,
            AWS_STUB_DIR: workdir,
            // Section 0 needs these to reach its (stubbed) `npx`; without them it reports an error and the
            // exit status stops being a signal about anything below.
            PREVIEW_ZONE: 'sandbox.commise.app',
            PREVIEW_HOSTED_ZONE_ID: 'Z0000000000000000000',
            VERCEL_TOKEN: 'stub',
            VERCEL_PROJECT_ID: 'stub',
            // Section 0b warns and skips without this, which is its documented unset behaviour.
            GH_ENVIRONMENT_ADMIN_TOKEN: '',
            SANDBOX_WAKE_TIMEOUT_SECONDS: '5',
            SANDBOX_WAKE_POLL_SECONDS: '1',
            ...env,
        },
    });

    const calls = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
              .split('\n')
              .filter((line) => line.length > 0)
        : [];

    return { status: result.status ?? -1, stdout: result.stdout, calls };
}

/** The two stacks a PR that deployed both feature services owns, plus the tags and outputs they publish. */
const BOTH_SERVICES: Fixtures = {
    'db-instances': 'kitchensink-data-sandbox-db',
    'nat-instances': 'i-0nat\tGlobal-sandbox-NatInstance',
    stacks: 'kitchensink-food-service-pr-73\tkitchensink-recipe-service-pr-73\tkitchensink-alb-sandbox',
    'tag-kitchensink-food-service-pr-73': 'pr-73',
    'tag-kitchensink-recipe-service-pr-73': 'pr-73',
    'tag-kitchensink-alb-sandbox': 'global',
    'outputs-kitchensink-food-service-pr-73': [
        'FoodServiceUrl\thttps://food-pr-73.commise.app',
        'FoodMigrationFunctionName\tfood-migrate-pr-73',
    ].join('\n'),
    'outputs-kitchensink-recipe-service-pr-73': [
        'RecipeServiceUrl\thttps://recipe-pr-73.commise.app',
        'RecipeMigrationFunctionName\trecipe-migrate-pr-73',
    ].join('\n'),
};

/** Index of the first call whose argv contains every fragment, or -1. */
const indexOfCall = (calls: readonly string[], ...fragments: readonly string[]): number =>
    calls.findIndex((call) => fragments.every((fragment) => call.includes(fragment)));

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'teardown-db-'));
    binDir = join(workdir, 'bin');
    logFile = join(workdir, 'calls.log');
    mkdirSync(binDir);

    for (const [name, body] of [
        ['aws', AWS_STUB],
        ['gh', TRIVIAL_STUB],
        ['npx', TRIVIAL_STUB],
    ] as const) {
        const file = join(binDir, name);
        writeFileSync(file, body);
        chmodSync(file, 0o755);
    }
});

describe('teardown drops every per-PR logical database (ADR-0006)', () => {
    it('drops the database behind EVERY migration-runner output, not just food"s', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);
        const invoked = calls
            .filter((call) => call.startsWith('lambda invoke'))
            .map((call) => /--function-name (\S+)/.exec(call)?.[1] ?? '');

        // ⛔ Set equality. "Contains recipe" would pass a script that also invoked something it should not,
        // and "contains food" is what passed for two months while recipe leaked.
        expect([...invoked].sort()).toEqual(['food-migrate-pr-73', 'recipe-migrate-pr-73']);
    });

    it('invokes nothing for an output that is not a drop door', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);

        expect(indexOfCall(calls, 'lambda invoke', 'commise.app')).toBe(-1);
    });

    it('drops BEFORE the stack that owns the runner is deleted', () => {
        // The runner is the only thing that can reach the PRIVATE_ISOLATED RDS, and it is torn down with its
        // stack. After the delete, the database can only be removed by redeploying that service.
        const { calls } = run('pr-73', BOTH_SERVICES);

        expect(indexOfCall(calls, 'lambda invoke', 'recipe-migrate-pr-73')).toBeGreaterThanOrEqual(0);
        expect(indexOfCall(calls, 'delete-stack')).toBeGreaterThanOrEqual(0);
        expect(indexOfCall(calls, 'lambda invoke', 'recipe-migrate-pr-73')).toBeLessThan(
            indexOfCall(calls, 'delete-stack'),
        );
    });

    it('finds a drop door on a stack matched by TAG, which no name rule would catch', () => {
        // `kitchensink-recipe-service-pr-73` is suffix-named, so `pr_scope_belongs` (a PREFIX rule) does not
        // match it — it is reachable only through the App-level Environment tag. Section 1 shares section 2's
        // discovery precisely so it inherits that, and this is the assertion that says so.
        const { calls } = run('pr-73', { ...BOTH_SERVICES, 'tag-kitchensink-recipe-service-pr-73': 'None' });
        const invoked = calls
            .filter((call) => call.startsWith('lambda invoke'))
            .map((call) => /--function-name (\S+)/.exec(call)?.[1] ?? '');

        expect(invoked).not.toContain('recipe-migrate-pr-73');
    });

    it('never reaches into a stack that is not this PR"s', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);

        expect(indexOfCall(calls, 'delete-stack', 'kitchensink-alb-sandbox')).toBe(-1);
        expect(indexOfCall(calls, 'lambda invoke', 'sandbox')).toBe(-1);
    });

    it('says so plainly when the PR owns no database at all', () => {
        // The common case: a web-only or docs-only PR. Saying nothing reads as a step that was skipped.
        const { stdout } = run('pr-73', {
            ...BOTH_SERVICES,
            stacks: 'kitchensink-alb-sandbox',
        });

        expect(stdout).toContain('no per-PR database to drop');
    });
});

describe('teardown wakes the shared tier before it needs it', () => {
    it('wakes the shared tier BEFORE it invokes any drop', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);
        const wake = indexOfCall(calls, 'rds describe-db-instances');
        const drop = indexOfCall(calls, 'lambda invoke');

        expect(wake, 'the wake must happen at all').toBeGreaterThanOrEqual(0);
        expect(drop).toBeGreaterThan(wake);
    });

    it('a failed wake does not stop the stack deletes', () => {
        // ⛔ The invariant `sandboxReclamationReachability.test.ts` exists for, applied one layer in. On
        // 2026-07-28 a prerequisite step failed and took nine PRs' worth of reclamation with it. Stacks, ECR
        // repos and log groups need no database, so a wake that cannot complete costs the DROP and nothing
        // else — while still failing the run at the end.
        const { status, calls, stdout } = run('pr-73', { ...BOTH_SERVICES, 'db-instances': '' });

        expect(stdout).toContain('could not wake the shared sandbox tier');
        expect(indexOfCall(calls, 'delete-stack', 'kitchensink-food-service-pr-73')).toBeGreaterThanOrEqual(0);
        expect(status, 'the run must still go red — a leaked database is not a silent outcome').not.toBe(0);
    });
});
