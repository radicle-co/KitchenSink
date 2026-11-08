/**
 * The reference graph of the Maestro flows: which flow runs which sub-flow, script or media file.
 *
 * Maestro flows are YAML, so the import graph does not see them. A changed sub-flow changes every top-level flow that
 * runs it, however deep, so the selector walks this graph backwards exactly as it walks the import graph.
 */
import { posix } from 'node:path';

import { parseAllDocuments } from 'yaml';

import type { Terminals } from './reachability.js';

/** Where the Maestro flows live. The one spelling of the path. */
export const MAESTRO_DIR = 'packages/apps/commise/mobile/.maestro';

/** A flow file's id, the key of its registry row: `recipes/rating` for `<MAESTRO_DIR>/recipes/rating.yaml`. */
export const flowIdOf = (file: string): string => file.slice(`${MAESTRO_DIR}/`.length).replace(/\.ya?ml$/u, '');

/** The file of a flow id. */
export const flowFileOf = (id: string): string => `${MAESTRO_DIR}/${id}.yaml`;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Readonly<Record<string, unknown>>)
        : {};

/** The file a `runFlow` or `runScript` command names, written either as a string or as a map with a `file`. */
const fileOf = (value: unknown): string | undefined => {
    const direct = typeof value === 'string' ? value : asRecord(value)['file'];

    return typeof direct === 'string' ? direct : undefined;
};

function collect(node: unknown, found: string[]): void {
    if (Array.isArray(node)) {
        node.forEach((item) => collect(item, found));

        return;
    }

    for (const [key, value] of Object.entries(asRecord(node))) {
        if (key === 'runFlow' || key === 'runScript') {
            const file = fileOf(value);

            if (file !== undefined) {
                found.push(file);
            }
        }

        if (key === 'addMedia' && Array.isArray(value)) {
            found.push(...value.filter((item): item is string => typeof item === 'string'));
        }

        collect(value, found);
    }
}

/**
 * Reads the files a flow runs.
 *
 * @param text - The flow's YAML, config document and commands.
 * @returns The referenced paths exactly as written, in order, each once.
 * @throws When the text is not valid YAML: reading it as "references nothing" would hide a flow from the graph.
 */
export function flowReferences(text: string): readonly string[] {
    const found: string[] = [];

    for (const document of parseAllDocuments(text)) {
        if (document.errors.length > 0) {
            throw new Error(`error: invalid YAML: ${document.errors[0]?.message ?? 'unknown'}`);
        }

        collect(document.toJS(), found);
    }

    return [...new Set(found)];
}

export interface MaestroFlowGraphInput {
    /** The repo-relative folder the flows live in. */
    readonly dir: string;
    /** Every repo-relative file under it. */
    readonly files: readonly string[];
    readonly read: (path: string) => string;
    /** The ids (`recipes/rating`) of the flows a run starts, as the runner's own plan lists them. */
    readonly topLevel: readonly string[];
}

export interface MaestroFlowGraph {
    readonly has: (file: string) => boolean;
    readonly importersOf: (file: string) => readonly string[];
    /** The flow files a flow runs, however deep, sorted. Scripts and media are not flows and are left out. */
    readonly runsOf: (file: string) => readonly string[];
    /** The flow files a flow runs by itself, one step down, sorted. */
    readonly runsDirectlyOf: (file: string) => readonly string[];
    readonly problems: readonly string[];
    /** The top-level flow files, as the tests a backwards walk ends at. */
    readonly tests: Terminals['tests'];
}

/**
 * Builds the reference graph.
 *
 * @param input - The flows folder, its files, and which flows are top-level.
 * @returns The graph, with a problem for every reference or flow it cannot resolve.
 */
export function maestroFlowGraph(input: MaestroFlowGraphInput): MaestroFlowGraph {
    const present = new Set(input.files);
    const importers = new Map<string, Set<string>>();
    const runs = new Map<string, Set<string>>();
    const problems: string[] = [];

    for (const file of input.files.filter((path) => /\.ya?ml$/u.test(path))) {
        for (const reference of flowReferences(input.read(file))) {
            const target = posix.normalize(posix.join(posix.dirname(file), reference));

            if (reference.includes('${') || !present.has(target)) {
                problems.push(`${file} runs ${reference}, which is not a file under ${input.dir}`);
            } else {
                importers.set(target, (importers.get(target) ?? new Set()).add(file));
                runs.set(file, (runs.get(file) ?? new Set()).add(target));
            }
        }
    }

    const tests = new Map<string, string>();

    for (const id of input.topLevel) {
        const file = `${input.dir}/${id}.yaml`;

        if (present.has(file)) {
            tests.set(file, id);
        } else {
            problems.push(`top-level flow ${id} has no file ${file}`);
        }
    }

    return {
        has: (file) => present.has(file),
        importersOf: (file) => [...(importers.get(file) ?? [])].sort(),
        runsDirectlyOf: (file) => [...(runs.get(file) ?? [])].filter((target) => /\.ya?ml$/u.test(target)).sort(),
        runsOf: (file) => {
            const seen = new Set<string>();
            const queue = [file];

            for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
                for (const target of runs.get(next) ?? []) {
                    if (!seen.has(target)) {
                        seen.add(target);
                        queue.push(target);
                    }
                }
            }

            return [...seen].filter((target) => /\.ya?ml$/u.test(target)).sort();
        },
        problems: problems.sort(),
        tests,
    };
}
