/**
 * Integration suite for `.github/scripts/teardown-sandbox-pr.sh` §0c and §1 — waking the shared tier, and
 * reclaiming every per-PR logical database through the PLATFORM REAPER.
 *
 * ⚠️ REWRITTEN 2026-09-04 (ADR-0031). This file used to prove that §1 discovered a drop door on each of the
 * PR's OWN stacks and invoked it. It now proves the opposite of the first half and more of the second: §1
 * invokes ONE reaper, published by `kitchensink-data-sandbox`, and it does so **whether or not the PR still
 * owns a stack** — which is the whole point, and the case the old shape could not reach.
 *
 * ## The three defects it exists for
 *
 * **1. Half the databases were never dropped.** §1 originally hardcoded `kitchensink-food-service-$PR` and
 * the output key `FoodMigrationFunctionName`. `RecipeServiceStack` has exported `RecipeMigrationFunctionName`
 * since it shipped and `recipe-service`'s migrate handler implements `action: 'drop'` — and nothing ever
 * invoked it. Every reaped recipe preview left `kitchensink_recipes_pr_{N}` behind, silently.
 *
 * **2. A door inside a stack cannot open once the stack is gone.** The shape that fixed defect 1 —
 * discovering doors by the output pattern `^[A-Za-z]+MigrationFunctionName$` across the PR's own stacks —
 * still reclaimed nothing for a PR whose stack was already deleted or resting in `DELETE_FAILED` /
 * `UPDATE_ROLLBACK_FAILED` (which publishes no outputs), and nothing at all for the databases stranded while
 * `RecipeMigrationFunctionName` went uninvoked. Those are not edge cases: they are precisely the population
 * the reaper was built for, and `reaps a PR whose stacks are ALL GONE` is the assertion that says so.
 *
 * **3. The drop could not have worked at its most common trigger time anyway.** A preview expires at 00:00
 * America/New_York, `SandboxSchedulerStack`'s STOP schedule fires at 00:00 America/New_York, and
 * `sandbox-reconcile.yml` runs at :17 — so the reconciler invokes an in-VPC Lambda against a database that
 * was stopped seventeen minutes earlier. The reaper is in-VPC too, so §0c's wake is as load-bearing as ever.
 *
 * `perPrDatabaseDropDoors.test.ts` proves the CONVENTION statically — the reaper's register covers every
 * database family the infra tree derives, and the script names no per-service door. It cannot prove the
 * script's control flow: that the reaper is found and invoked with this PR's token and no other, that the
 * wake precedes it, or that a failure does not take the rest of the teardown with it. That is this file.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the teardown script and the `sandbox-wake.sh`, `ecs-quiesce.sh` and `pr-scope.sh` it invokes,
 *   executed as `bash` in a child process. Never re-implemented.
 * - **Stubbed**: `aws`, `gh` and `npx`, as executables placed first on `PATH`. The `aws` stub logs every
 *   invocation and answers from canned fixtures.
 *
 * The call LOG is the assertion surface, exactly as in `ecsQuiesce.integration.test.ts`: the guarantees under
 * test are *which* functions were invoked, *with what payload*, and *in what order*, and a test that only
 * checked the exit status would pass a script that dropped nothing.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. §1 reverted to discovering doors across `$PR_STACKS` → `reaps a PR whose stacks are ALL GONE` fails,
 *      and `invokes exactly ONE function` reports the two per-service migration runners. This is the
 *      red-before-green run for the defect ADR-0031 exists for.
 *   2. The payload's `pr` field dropped → `hands the reaper THIS PR's token and no other` fails, and the
 *      reaper would reap whatever a token-less drop resolved to (it refuses; the point is the script must
 *      not rely on that).
 *   3. The §0c wake moved BELOW §1 → `wakes the shared tier BEFORE it invokes the reaper` fails.
 *   4. The wake's `|| teardown_failed=1` branch changed to `exit 1` → `a failed wake does not stop the stack
 *      deletes` fails, and the stacks leak — the 2026-07-28 incident shape that
 *      `sandboxReclamationReachability.test.ts` invariant 1 exists to forbid.
 *   5a. Either drop-failure branch left at `::warning::` with no `teardown_failed=1` → `a failed invoke fails
 *      the run` / `a drop the FUNCTION rejected fails the run too` fail. Owner ruling, 2026-09-03.
 *   5b. The failed drop changed from `teardown_failed=1` to `exit 1` → `a failed drop still does not stop the
 *      stack deletes` fails. The ruling makes the run RED; it does not make the step ABORT.
 *   6. The absent-reaper branch softened to a `::warning::` or a silent skip → `an ABSENT reaper is an error`
 *      fails, which is the shape where a platform stack that has not deployed ADR-0031 yet leaks every
 *      preview's database behind a green teardown.
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
 * `describe-stacks` is routed on the `--query` it carries, because the script asks that one verb two
 * different questions — a stack's Environment tag, and a stack's outputs — and answering them alike would
 * make the reaper lookup pass for the wrong reason.
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
            # The script's query FILTERS by OutputKey, so the stub answers per key rather than dumping the
            # whole outputs file — otherwise a bogus "function name" (the first line of the file) is what
            # gets invoked, and the suite passes for a script that looked up the wrong thing.
            *PerPrDatabaseReaperFunctionName*) cat "$AWS_STUB_DIR/reaper-$stack" 2>/dev/null || echo 'None' ;;
            *Outputs*) cat "$AWS_STUB_DIR/outputs-$stack" 2>/dev/null || echo 'None' ;;
        esac
        ;;
    'lambda invoke')
        # \`AWS_STUB_DROP\` selects the failure mode, because the two the script distinguishes are NOT the
        # same shape: \`aws lambda invoke\` exits 0 when the FUNCTION threw, reporting the throw in its own
        # stdout, so a test that only made the CLI exit non-zero would never reach the \`FunctionError\` arm.
        case "\${AWS_STUB_DROP:-}" in
            invoke-fails)
                echo 'Unknown options: --cli-binary-format' >&2
                exit 254
                ;;
            function-error)
                for arg in "$@"; do
                    case "$arg" in /*.json) echo '{"errorMessage":"boom"}' > "$arg" ;; esac
                done
                echo '{"StatusCode":200,"FunctionError":"Unhandled"}'
                ;;
            *)
                for arg in "$@"; do
                    case "$arg" in
                        /*.json) echo '{"action":"drop","dropped":["kitchensink_food_pr_73"]}' > "$arg" ;;
                    esac
                done
                ;;
        esac
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
    /** Captured separately: the diagnostics §1 prints for a failed invoke go to STDERR. */
    readonly stderr: string;
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

    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, calls };
}

/** The PLATFORM data stack, which is where the reaper lives — never a stack the PR owns. */
const REAPER_FIXTURE: Fixtures = {
    'reaper-kitchensink-data-sandbox': 'kitchensink-data-sandbox-reaper',
};

/** The two stacks a PR that deployed both feature services owns, plus the tags and outputs they publish. */
const BOTH_SERVICES: Fixtures = {
    ...REAPER_FIXTURE,
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

/** Every `--function-name` the run invoked, in order. */
const invokedFunctions = (calls: readonly string[]): readonly string[] =>
    calls
        .filter((call) => call.startsWith('lambda invoke'))
        .map((call) => /--function-name (\S+)/.exec(call)?.[1] ?? '');

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

describe('teardown reclaims per-PR databases through the reaper (ADR-0031)', () => {
    it('invokes exactly ONE function — the platform reaper, never a per-service migration runner', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);

        // ⛔ Set equality. "Contains the reaper" would pass a script that ALSO kept invoking the two
        // per-service doors, which is the second authority ADR-0031 exists to remove.
        expect(invokedFunctions(calls)).toEqual(['kitchensink-data-sandbox-reaper']);
    });

    it("hands the reaper THIS PR's token and no other", () => {
        const { calls } = run('pr-73', BOTH_SERVICES);
        const invoke = calls.find((call) => call.startsWith('lambda invoke')) ?? '';

        expect(invoke).toContain('"action":"drop"');
        expect(invoke).toContain('"pr":"pr-73"');
    });

    it('⛔ reaps a PR whose stacks are ALL GONE — the case a per-stack door could never reach', () => {
        // THE reason this capability exists. A PR whose stack was already deleted, or reaped while
        // `RecipeMigrationFunctionName` went uninvoked, owns a logical database and nothing that can open it.
        // Under the old shape this run invoked nothing and reported success.
        const { calls, stdout } = run('pr-73', { ...REAPER_FIXTURE, ...BOTH_SERVICES, stacks: '' });

        expect(invokedFunctions(calls)).toEqual(['kitchensink-data-sandbox-reaper']);
        expect(stdout).toContain('[db-drop]');
    });

    it('⛔ reaps a PR whose stack is wedged and publishes NO outputs', () => {
        // A stack in DELETE_FAILED / UPDATE_ROLLBACK_FAILED answers `describe-stacks --query Outputs` with
        // nothing, so door discovery found no door — while the database it created is very much there.
        const { calls } = run('pr-73', {
            ...BOTH_SERVICES,
            'outputs-kitchensink-food-service-pr-73': 'None',
            'outputs-kitchensink-recipe-service-pr-73': 'None',
        });

        expect(invokedFunctions(calls)).toEqual(['kitchensink-data-sandbox-reaper']);
    });

    it('reads the reaper from the PLATFORM stack, not from anything the PR owns', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);

        expect(indexOfCall(calls, 'describe-stacks', 'kitchensink-data-sandbox', 'Outputs')).toBeGreaterThanOrEqual(0);
    });

    it('never reaches into a stack that is not this PR"s', () => {
        const { calls } = run('pr-73', BOTH_SERVICES);

        expect(indexOfCall(calls, 'delete-stack', 'kitchensink-alb-sandbox')).toBe(-1);
    });

    it('⛔ an ABSENT reaper is an ERROR — the databases are being left behind', () => {
        // The platform stack has not deployed ADR-0031 yet, or the output was renamed. Either way this PR's
        // databases stay on the shared instance, so a silent skip here would be the green-check-over-a-leak
        // shape the whole teardown path has been rebuilt twice to remove.
        const { status, stdout, calls } = run('pr-73', {
            ...BOTH_SERVICES,
            'reaper-kitchensink-data-sandbox': 'None',
        });

        expect(stdout).toContain('publishes no PerPrDatabaseReaperFunctionName');
        expect(invokedFunctions(calls)).toEqual([]);
        expect(status).not.toBe(0);
        // …and the rest of the teardown still runs.
        expect(indexOfCall(calls, 'delete-stack', 'kitchensink-food-service-pr-73')).toBeGreaterThanOrEqual(0);
    });
});

describe('teardown wakes the shared tier before it needs it', () => {
    it('wakes the shared tier BEFORE it invokes the reaper', () => {
        // The reaper is VPC-attached and the shared sandbox RDS is stopped nightly (ADR-0007), so without
        // the wake this drop cannot work at its most common trigger time.
        const { calls } = run('pr-73', BOTH_SERVICES);
        const wake = indexOfCall(calls, 'rds describe-db-instances');
        const drop = indexOfCall(calls, 'lambda invoke');

        expect(wake, 'the wake must happen at all').toBeGreaterThanOrEqual(0);
        expect(drop).toBeGreaterThan(wake);
    });

    it('drops BEFORE the stacks are deleted — now a preference, still asserted', () => {
        // ⚠️ No longer a PRECONDITION: the reaper is not torn down with the PR, so a drop after §2 would
        // still work. It stays ahead of §2 because §2 waits on each delete and a wedged stack can consume
        // the whole run, which would cost the drop its turn.
        const { calls } = run('pr-73', BOTH_SERVICES);

        expect(indexOfCall(calls, 'lambda invoke')).toBeGreaterThanOrEqual(0);
        expect(indexOfCall(calls, 'delete-stack')).toBeGreaterThanOrEqual(0);
        expect(indexOfCall(calls, 'lambda invoke')).toBeLessThan(indexOfCall(calls, 'delete-stack'));
    });

    it('a failed invoke fails the run, exactly as a failed wake does', () => {
        // ⛔ Owner ruling, 2026-09-03: a failed drop and a failed wake are BOTH errors. The severities used
        // to disagree, and backwards — the wake, which exists for no other purpose than to make the drop
        // possible, failed the run while the drop it was serving only warned.
        const { status, stdout } = run('pr-73', BOTH_SERVICES, { AWS_STUB_DROP: 'invoke-fails' });

        expect(stdout).toContain('::error::could not invoke');
        expect(stdout).toContain('will be left behind');
        expect(status, 'a leaked per-PR database is not a silent outcome').not.toBe(0);
    });

    it('names AWS CLI v1 as the cause when that is what happened', () => {
        // ⚠️ Cost a real diagnosis on 2026-08-27: the invoke failed with `Unknown options:
        // --cli-binary-format` because the operator's shell resolved AWS CLI v1, and the message named the
        // function but not the one fact that identified the cause in seconds.
        const { stderr } = run('pr-73', BOTH_SERVICES, { AWS_STUB_DROP: 'invoke-fails' });

        // STDERR, deliberately: the reason lines are the ones that used to go to /dev/null, and asserting
        // them on stdout would pass while they were being discarded again.
        expect(stderr).toContain('CLI v1');
        expect(stderr).toContain('--cli-binary-format');
    });

    it('a drop the FUNCTION rejected fails the run too — the CLI exiting 0 is not success', () => {
        // `aws lambda invoke` exits 0 when the function THREW; the throw is reported in its stdout. Reading
        // the exit status alone reports a successful drop for a database that is still there.
        const { status, stdout } = run('pr-73', BOTH_SERVICES, { AWS_STUB_DROP: 'function-error' });

        expect(stdout).toContain('::error::per-PR DB drop for pr-73 returned a FunctionError');
        expect(status, 'a FunctionError means the databases survived — the run must go red').not.toBe(0);
    });

    it('a failed drop still does not stop the stack deletes', () => {
        // The same invariant the wake carries: red at the END, never an abort. Everything that needs no
        // database must still be reclaimed, or one failed drop leaks the stacks, ECR repos and log groups
        // too — the 2026-07-28 shape.
        const { calls } = run('pr-73', BOTH_SERVICES, { AWS_STUB_DROP: 'invoke-fails' });

        expect(indexOfCall(calls, 'delete-stack', 'kitchensink-food-service-pr-73')).toBeGreaterThanOrEqual(0);
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
