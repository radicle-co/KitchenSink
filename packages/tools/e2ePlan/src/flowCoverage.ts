/**
 * The screens each top-level Maestro flow is covered for: its own row, the rows of every sub-flow it runs, and the
 * screens every flow passes through. The one place that combines them, so the selector and the screen recorder's check
 * read the same set.
 */
import type { CoverageTable } from './coverageTable.js';
import type { MaestroFlowGraph } from './maestroFlows.js';

export interface FlowCoverageInput {
    readonly flows: Pick<MaestroFlowGraph, 'tests' | 'runsOf'>;
    readonly table: CoverageTable;
    /** A flow file's id, the key of its row. */
    readonly idOf: (file: string) => string;
    /** Screens added to every flow (every flow signs in through Home). */
    readonly passThrough: readonly string[];
}

/**
 * Combines the rows.
 *
 * @param input - The flow graph, the registry and the pass-through screens.
 * @returns Each top-level flow's id to its combined screens.
 */
export function flowCoverage(input: FlowCoverageInput): Map<string, Set<string>> {
    return new Map(
        [...input.flows.tests].map(([file, id]) => {
            const screens = new Set<string>([...(input.table.get(id) ?? []), ...input.passThrough]);

            for (const sub of input.flows.runsOf(file)) {
                (input.table.get(input.idOf(sub)) ?? new Set<string>()).forEach((screen) => screens.add(screen));
            }

            return [id, screens] as const;
        }),
    );
}
