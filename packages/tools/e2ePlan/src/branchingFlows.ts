/**
 * Which Maestro flows branch, in the one sense both the recorder and the narrowing script need.
 *
 * One run takes one branch. A flow whose commands can differ between runs may show screens in one run that another run
 * does not, so a run cannot prove a screen is unneeded. Three things branch: a `when:` condition, a `while:` loop and a
 * step marked `optional: true`. A flow branches if it does, or if any flow it runs does, however deep.
 */
import { parseAllDocuments } from 'yaml';

import type { MaestroFlowGraph } from './maestroFlows.js';

import { asRecord } from './asRecord.js';

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
 * The top-level flows that branch, in their own file or in a flow they run.
 *
 * A helper in `opaque` (a sub-flow with a row of its own in the registry) is not looked into, and neither is anything
 * it runs: its row names every screen its branches can reach, and that row is added to every flow that runs it. A
 * helper a flow runs by another route is still looked into.
 *
 * @param flows - The flow graph: the top-level flows and what each runs.
 * @param read - Reads a flow file by its repo-relative path.
 * @param opaque - Files of the helpers that answer for their own branches.
 * @returns Ids of the branching flows.
 */
export function branchingFlows(
    flows: Pick<MaestroFlowGraph, 'tests' | 'runsDirectlyOf'>,
    read: (path: string) => string,
    opaque: ReadonlySet<string> = new Set(),
): ReadonlySet<string> {
    const branches = (file: string, seen: Set<string>): boolean => {
        if (seen.has(file)) {
            return false;
        }

        seen.add(file);

        return (
            isBranching(read(file)) ||
            flows.runsDirectlyOf(file).some((child) => !opaque.has(child) && branches(child, seen))
        );
    };

    return new Set([...flows.tests].flatMap(([file, id]) => (branches(file, new Set()) ? [id] : [])));
}

/**
 * The files of the registry rows that are not top-level flows: the helpers that answer for their own branches.
 *
 * @param table - The registry (id to screens).
 * @param tests - The top-level flow files and their ids.
 * @param fileOf - The file of a flow id.
 * @returns The helper files, to pass as `opaque` to {@link branchingFlows}.
 */
export function rowedHelperFiles(
    table: ReadonlyMap<string, ReadonlySet<string>>,
    tests: ReadonlyMap<string, string>,
    fileOf: (id: string) => string,
): ReadonlySet<string> {
    const topLevel = new Set(tests.values());

    return new Set([...table.keys()].filter((id) => !topLevel.has(id)).map(fileOf));
}
