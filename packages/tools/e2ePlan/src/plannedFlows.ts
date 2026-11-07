/**
 * The flows a Maestro run starts, from the runner's own plan (`vertical:flow` lines), so the list has one source.
 */
import { execFileSync } from 'node:child_process';

const MOBILE = 'packages/apps/commise/mobile';

/**
 * Asks the runner for its plan.
 *
 * @sideEffect Runs the Maestro runner's pure `plan` subcommand.
 * @param repo - The repository root.
 * @returns The flow ids, such as `recipes/rating`.
 */
export function plannedFlows(repo: string): readonly string[] {
    const output = execFileSync('bash', [`${MOBILE}/tests/e2e/runMaestroFlows.sh`, 'plan'], {
        cwd: repo,
        encoding: 'utf8',
    });

    return output
        .split('\n')
        .filter((line) => line.includes(':'))
        .map((line) => line.slice(line.indexOf(':') + 1));
}
