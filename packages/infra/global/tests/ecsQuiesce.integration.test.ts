/**
 * Integration suite for `.github/scripts/ecs-quiesce.sh` — the ordering fix that lets a per-PR stack delete
 * actually complete.
 *
 * ## The defect it exists for
 *
 * Deleting a per-PR service stack failed on its ECS cluster with
 * `AWS::ECS::ClusterCapacityProviderAssociations … DELETE_FAILED — "The specified capacity provider is in use
 * and cannot be removed."` CloudFormation deletes the ECS service before the association, but `DeleteService`
 * returns while tasks are still DRAINING, so the association delete arrives while the FARGATE_SPOT provider is
 * still referenced. Nine stacks across five merged PRs (73, 77, 78, 79, 80 — food and recipe) were sitting in
 * `DELETE_FAILED` on exactly this.
 *
 * It is non-prod-only, and that is why nobody saw it: ADR-0008 puts non-prod on `FARGATE_SPOT`, so the CDK
 * emits `enableFargateCapacityProviders: useSpot` and the association resource exists **only** when spot is
 * on. Confirmed against the live account — `kitchensink-food-service-prod` has no such resource,
 * `kitchensink-food-service-pr-81` does. The cost lever introduced a teardown defect in precisely the stages
 * that get torn down.
 *
 * **A retry cannot fix this, which is why the guarantee under test is ordering.** The delete fails on a
 * precondition that only draining removes; a retry loop re-fails for as long as the reference stands. So these
 * tests assert the ORDER and the WAIT, not merely that some calls were made.
 *
 * ## What is real here, and what is stubbed
 *
 * - **Real**: the script, executed as `bash` (never re-implemented), in a real child process, with the real
 *   `pr-scope.sh` guard it sources.
 * - **Stubbed**: the AWS CLI, via an `aws` executable placed first on `PATH` which appends every invocation to
 *   a log file and answers from canned fixtures. ECS cannot be stood up in a unit-tier run, and this seam is
 *   exactly where the script talks to it.
 *
 * The call LOG is the assertion surface, because the whole point of the script is the sequence of calls. A
 * test that only checked the exit status would pass a script that deleted nothing.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. `--force` dropped from `delete-service` → `deletes every service with --force` fails. (Without it ECS
 *      refuses to delete a service with a non-zero desired count, so the reference survives.)
 *   2. Both `aws ecs wait` calls removed → `waits for services and tasks to settle` fails. This is the
 *      mutation that matters most: without the wait the script returns while the drain is still in flight and
 *      the caller races exactly as CloudFormation did, yet every other assertion here still passes.
 *   3. `stop-task` loop removed → `stops standalone tasks` fails (the food change-refresh RunTask binds
 *      FARGATE_SPOT too, so a live task holds the association just as a service does).
 *   4. `--resource-type-filters ecs:cluster` removed → `scopes discovery to an exact Environment tag and to
 *      clusters only` fails (the stub records the argv verbatim). Discovery is filtered TWICE on purpose —
 *      server-side by that flag and client-side by the `:cluster/` ARN grep — because the tag is also carried
 *      by log groups, task definitions and repositories. Dropping the client-side half instead fails
 *      `ignores non-cluster resources that share the tag`, which is the mutation that proves the second
 *      filter is not redundant.
 *   5. Tag filter changed from `Values=$pr` to a hard-coded prefix form → the same `scopes discovery` test
 *      fails, since it asserts the exact `Key=Environment,Values=pr-73` string.
 *   6. `pr_scope_is_token` guard removed → `refuses a token that is not pr-{N}` fails and the script proceeds
 *      to call AWS with a bare stage name.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../.github/scripts/ecs-quiesce.sh', import.meta.url));

let workdir: string;
let binDir: string;
let logFile: string;

/**
 * A stub `aws` that logs every call and answers ECS/tagging reads from files the test writes. Anything it is
 * not taught to answer prints nothing, which is the same shape as an empty AWS result.
 */
const AWS_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$AWS_CALL_LOG"
case "$1 $2" in
    'resourcegroupstaggingapi get-resources') cat "$AWS_STUB_DIR/clusters" 2>/dev/null || true ;;
    'ecs list-services') cat "$AWS_STUB_DIR/services" 2>/dev/null || true ;;
    'ecs list-tasks') cat "$AWS_STUB_DIR/tasks" 2>/dev/null || true ;;
    *) : ;;
esac
exit 0
`;

interface RunResult {
    readonly status: number;
    readonly stdout: string;
    /** Every `aws` invocation, in order, as a single argv string per line. */
    readonly calls: readonly string[];
}

/** Run the real script with the stub CLI first on PATH. */
function run(token: string, fixtures: { clusters?: string; services?: string; tasks?: string } = {}): RunResult {
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
        },
    });

    const calls = existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
              .split('\n')
              .filter((line) => line.length > 0)
        : [];

    return { status: result.status ?? -1, stdout: result.stdout, calls };
}

const CLUSTER_A = 'arn:aws:ecs:us-east-1:040663841500:cluster/kitchensink-food-service-pr-73-FoodServiceCluster-AAA';
const CLUSTER_B =
    'arn:aws:ecs:us-east-1:040663841500:cluster/kitchensink-recipe-service-pr-73-RecipeServiceCluster-BBB';
const SERVICE_A = 'arn:aws:ecs:us-east-1:040663841500:service/kitchensink-food-service-pr-73-x/FoodApi';
const SERVICE_B = 'arn:aws:ecs:us-east-1:040663841500:service/kitchensink-food-service-pr-73-x/FoodWorker';
const TASK_A = 'arn:aws:ecs:us-east-1:040663841500:task/kitchensink-food-service-pr-73-x/deadbeef';

beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ecs-quiesce-'));
    binDir = join(workdir, 'bin');
    mkdirSync(binDir);
    logFile = join(workdir, 'aws-calls.log');
    const stub = join(binDir, 'aws');
    writeFileSync(stub, AWS_STUB);
    chmodSync(stub, 0o755);
});

describe('ecs-quiesce.sh — draining before the stack delete', () => {
    it('deletes every service with --force', () => {
        const { status, calls } = run('pr-73', { clusters: CLUSTER_A, services: `${SERVICE_A}\t${SERVICE_B}` });

        const deletes = calls.filter((c) => c.startsWith('ecs delete-service'));
        expect(deletes).toHaveLength(2);
        // `--force` is load-bearing: ECS refuses to delete a service whose desired count is non-zero, so
        // without it the capacity-provider reference survives and the stack delete fails exactly as before.
        expect(deletes.every((c) => c.includes('--force'))).toBe(true);
        expect(deletes[0]).toContain(SERVICE_A);
        expect(deletes[1]).toContain(SERVICE_B);
        expect(status).toBe(0);
    });

    it('stops standalone tasks, which hold the capacity provider just as services do', () => {
        const { calls } = run('pr-73', { clusters: CLUSTER_A, tasks: TASK_A });

        const stops = calls.filter((c) => c.startsWith('ecs stop-task'));
        expect(stops).toHaveLength(1);
        expect(stops[0]).toContain(TASK_A);
    });

    it('waits for services and tasks to settle before returning', () => {
        const { calls } = run('pr-73', {
            clusters: CLUSTER_A,
            services: SERVICE_A,
            tasks: TASK_A,
        });

        expect(calls.some((c) => c.startsWith('ecs wait services-inactive'))).toBe(true);
        expect(calls.some((c) => c.startsWith('ecs wait tasks-stopped'))).toBe(true);

        // ORDER is the guarantee, not the mere presence of the calls: the delete/stop are asynchronous, so a
        // wait that ran before them — or not at all — would return mid-drain and reproduce the race.
        const lastMutation = Math.max(
            calls.findLastIndex((c) => c.startsWith('ecs delete-service')),
            calls.findLastIndex((c) => c.startsWith('ecs stop-task')),
        );
        const firstWait = calls.findIndex((c) => c.startsWith('ecs wait'));
        expect(firstWait).toBeGreaterThan(lastMutation);
    });

    it('drains every cluster the PR owns, not just the first', () => {
        const { calls } = run('pr-73', { clusters: `${CLUSTER_A}\t${CLUSTER_B}`, services: SERVICE_A });

        expect(calls.filter((c) => c.startsWith('ecs list-services')).length).toBe(2);
        expect(calls.some((c) => c.includes(CLUSTER_A))).toBe(true);
        expect(calls.some((c) => c.includes(CLUSTER_B))).toBe(true);
    });

    it('scopes discovery to an exact Environment tag and to clusters only', () => {
        const { calls } = run('pr-73', { clusters: CLUSTER_A });

        const discovery = calls.find((c) => c.startsWith('resourcegroupstaggingapi'));
        expect(discovery).toBeDefined();
        // Exact tag VALUE — the same authority that licenses deleting whole stacks. A prefix/glob form here
        // would let pr-7 reach pr-73's clusters.
        expect(discovery).toContain('Key=Environment,Values=pr-73');
        expect(discovery).toContain('--resource-type-filters ecs:cluster');
    });

    it('ignores non-cluster resources that share the tag', () => {
        const logGroup = 'arn:aws:logs:us-east-1:040663841500:log-group:/aws/lambda/kitchensink-recipe-workers-pr-73';
        const { calls } = run('pr-73', { clusters: `${logGroup}\t${CLUSTER_A}` });

        expect(calls.some((c) => c.startsWith('ecs list-services') && c.includes(CLUSTER_A))).toBe(true);
        expect(calls.some((c) => c.includes(logGroup))).toBe(false);
    });

    it('is a clean no-op when the PR owns no cluster', () => {
        const { status, stdout, calls } = run('pr-73', { clusters: '' });

        expect(status).toBe(0);
        expect(stdout).toContain('no ECS clusters tagged Environment=pr-73');
        expect(calls.some((c) => c.startsWith('ecs '))).toBe(false);
    });

    it('makes no AWS call and refuses a token that is not pr-{N}', () => {
        for (const bad of ['sandbox', 'prod', 'global', 'pr-', 'pr-1x', '']) {
            const { status, calls } = run(bad, { clusters: CLUSTER_A });

            expect(status, `token '${bad}' must be refused`).not.toBe(0);
            expect(calls, `token '${bad}' must reach no AWS call`).toEqual([]);
        }
    });
});
