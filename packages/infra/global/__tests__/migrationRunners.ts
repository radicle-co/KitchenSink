/**
 * WHICH STACKS CAN A DEPLOY PIPELINE ASK TO MIGRATE — derived once, for the two guards that ask.
 *
 * There are two different questions about migration runners, and conflating them is what let one runner go
 * uncovered for as long as it did:
 *
 *   - who AUTHORS a runner (`src/**\/migrate/handler.ts`) — `prodDeployMigrationOrder.test.ts`'s
 *     `runnerPackages()`, which is the right axis for "does this service's SQL have a step at all";
 *   - who DEPLOYS one, and publishes the `CfnOutput` that makes it reachable — this module.
 *
 * They are not the same set. `RecipeWorkersStack` deploys `recipe-service`'s bundle deliberately ("the
 * runner has to be deployed WITH the SQL it applies"), so it authors no handler and is invisible to the
 * first question while being fully subject to the second.
 *
 * The output shape is the SAME one `.github/scripts/teardown-sandbox-pr.sh` §1 matches to find per-PR
 * database drop doors. Stating it once here is what keeps the teardown path and the safety-net path from
 * disagreeing about which runners exist — the divergence that put `RecipeWorkersMigrationFunctionName`
 * inside teardown's reach and outside every deploy's.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The logical id of a migration-runner output, as both teardown and the deploy nets spell it. */
export const RUNNER_OUTPUT = /new CfnOutput\(\s*this,\s*'([A-Za-z]+MigrationFunctionName)'/g;

/**
 * Tracked CDK stack sources, repo-relative.
 *
 * @sideEffect Shells out to git.
 */
export function stackSources(): readonly string[] {
    return execFileSync('git', ['ls-files', '*/infra/lib/*.ts'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.length > 0);
}

/** Every migration-runner output logical id the given sources publish. Pure. */
export function publishedRunnerOutputs(read: (file: string) => string, files: readonly string[]): readonly string[] {
    const found = files.flatMap((file) => [...read(file).matchAll(RUNNER_OUTPUT)].map((match) => match[1] ?? ''));

    return [...new Set(found)].filter((name) => name.length > 0).sort();
}

/** The service directory names whose infra publishes such an output. Pure over the given sources. */
export function runnerDeployingPackages(read: (file: string) => string, files: readonly string[]): readonly string[] {
    const owners = files
        .filter((file) => publishedRunnerOutputs(read, [file]).length > 0)
        .map((file) => file.split('/')[2] ?? '');

    return [...new Set(owners)].filter((name) => name.length > 0).sort();
}

/**
 * Read a repo-relative file.
 *
 * @sideEffect Reads from disk.
 */
export const readRepoFile = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8');
