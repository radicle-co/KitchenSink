/**
 * Reads the real repository for `narrowRows`: the registry, the flow graph, and from it which screens a flow's sub-flows
 * supply and which flows branch.
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { branchingFlows } from './branchingFlows.js';
import { parseCoverage } from './coverageTable.js';
import { maestroFlowGraph } from './maestroFlows.js';
import { type Evidence, type NarrowInput } from './narrowFlowRows.js';
import { plannedFlows } from './plannedFlows.js';

const MOBILE = 'packages/apps/commise/mobile';
export const FLOW_TABLE_PATH = `${MOBILE}/tests/e2e/maestroFlowScreens.tsv`;

const idOf = (file: string): string => file.slice(`${MOBILE}/.maestro/`.length).replace(/\.ya?ml$/u, '');

/**
 * Builds the input of `narrowRows` from the repository and two platforms' evidence.
 *
 * @sideEffect Reads the registry and every flow file, and runs the Maestro runner's pure `plan` subcommand.
 * @param repo - The repository root.
 * @param android - Android's recorder evidence.
 * @param ios - iOS's recorder evidence.
 * @returns The input, and the registry text for rewriting.
 */
export function loadNarrowInput(
    repo: string,
    android: Evidence,
    ios: Evidence,
): { readonly input: NarrowInput; readonly text: string } {
    const read = (path: string): string => readFileSync(join(repo, path), 'utf8');
    const text = read(FLOW_TABLE_PATH);
    const table = parseCoverage(text, FLOW_TABLE_PATH);
    const files = globSync(`${MOBILE}/.maestro/**/*`, { cwd: repo }).sort();
    const flows = maestroFlowGraph({
        dir: `${MOBILE}/.maestro`,
        files,
        read,
        topLevel: plannedFlows(repo),
    });
    const topLevel = new Set([...flows.tests.values()]);
    const subflows = new Set([...table.keys()].filter((id) => !topLevel.has(id)));
    const fileOf = (id: string): string => `${MOBILE}/.maestro/${id}.yaml`;
    const runsOfId = (id: string): readonly string[] => flows.runsOf(fileOf(id)).map(idOf);

    return {
        text,
        input: {
            table,
            subflows,
            android,
            ios,
            suppliedBySubflows: (flow) =>
                new Set(runsOfId(flow).flatMap((sub) => [...(subflows.has(sub) ? (table.get(sub) ?? []) : [])])),
            branching: branchingFlows(flows, read),
        },
    };
}
