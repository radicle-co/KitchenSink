/**
 * Which Maestro flows branch, in the one sense both the recorder and the narrowing script need.
 *
 * One run takes one branch. A flow whose commands can differ between runs may show screens in one run that another run
 * does not, so a run cannot prove a screen is unneeded. Three things branch: a `when:` condition, a `while:` loop and a
 * step marked `optional: true`. A flow branches if it does, or if any flow it runs does, however deep.
 */
import { parseAllDocuments } from 'yaml';

import type { MaestroFlowGraph } from './maestroFlows.js';

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};

function branches(node: unknown): boolean {
    if (Array.isArray(node)) {
        return node.some(branches);
    }

    return Object.entries(asRecord(node)).some(
        ([key, value]) =>
            key === 'when' || key === 'while' || (key === 'optional' && value === true) || branches(value),
    );
}

/**
 * Whether one flow file branches.
 *
 * @param text - The flow's YAML, config document and commands.
 * @returns True when it has a `when:`, a `while:` or an `optional: true`.
 * @throws When the text is not valid YAML: reading it as "plain" would let a branching flow narrow.
 */
export function isBranching(text: string): boolean {
    return parseAllDocuments(text).some((document) => {
        if (document.errors.length > 0) {
            throw new Error(`error: invalid YAML: ${document.errors[0]?.message ?? 'unknown'}`);
        }

        return branches(document.toJS());
    });
}

/**
 * The top-level flows that branch, in their own file or in any flow they run.
 *
 * @param flows - The flow graph: the top-level flows and what each runs.
 * @param read - Reads a flow file by its repo-relative path.
 * @returns Ids of the branching flows.
 */
export function branchingFlows(
    flows: Pick<MaestroFlowGraph, 'tests' | 'runsOf'>,
    read: (path: string) => string,
): ReadonlySet<string> {
    return new Set(
        [...flows.tests].flatMap(([file, id]) =>
            [file, ...flows.runsOf(file)].some((path) => isBranching(read(path))) ? [id] : [],
        ),
    );
}
