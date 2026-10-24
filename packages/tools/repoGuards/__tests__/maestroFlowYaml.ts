/**
 * Reading the committed Maestro flows as YAML, for the guards that judge their commands (`maestroScrollThenTap.test.ts`,
 * `maestroOpenListPick.test.ts`). Parsed, never grepped, so a comment or a change of quoting cannot hide a command.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseAllDocuments } from 'yaml';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const FLOW_ROOT = 'packages/apps/commise/mobile/.maestro';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Whether a `runFlow` path names a flow. By file NAME, not by `common/…`: the flows beside a shared step in
 * `recipes/common/` call it by its bare name, and a suffix test on `common/…` silently missed those calls. Pure.
 */
export const namesFlow = (path: string, name: string): boolean => path === name || path.endsWith(`/${name}`);

/** The text a selector names: a bare string, or a `{ text }` selector. Pure. */
export function textOf(selector: unknown): string | undefined {
    if (typeof selector === 'string') {
        return selector;
    }

    return isRecord(selector) && typeof selector['text'] === 'string' ? selector['text'] : undefined;
}

/** Whether a command is `launchApp`, bare or with options. Pure. */
export const isLaunch = (command: unknown): boolean =>
    command === 'launchApp' || (isRecord(command) && 'launchApp' in command);

/** A `launchApp` command's options, or none for the bare form. Pure. */
export const launchOptions = (command: unknown): Record<string, unknown> =>
    isRecord(command) && isRecord(command['launchApp']) ? command['launchApp'] : {};

/** Every array in a parsed YAML value (every command list, however deeply a runFlow or repeat nests it). Pure. */
export function* commandLists(value: unknown): Generator<readonly unknown[]> {
    if (Array.isArray(value)) {
        yield value;

        for (const item of value) {
            yield* commandLists(item);
        }
    } else if (isRecord(value)) {
        for (const item of Object.values(value)) {
            yield* commandLists(item);
        }
    }
}

/**
 * Parse every YAML document in a flow, failing on any syntax error. Pure.
 *
 * @param file - The flow's path, for the error.
 * @param source - The flow's YAML.
 * @returns One parsed value per document.
 * @throws When the source does not parse.
 */
export function parseFlow(file: string, source: string): readonly unknown[] {
    return parseAllDocuments(source).map((document) => {
        if (document.errors.length > 0) {
            throw new Error(`${file} does not parse: ${document.errors.map((e) => e.message).join('; ')}`);
        }

        return document.toJS() as unknown;
    });
}

/**
 * Every committed flow, repo-relative.
 *
 * @sideEffect Spawns `git ls-files`, so a flow that is not in the index is not judged.
 */
export function committedFlowFiles(): readonly string[] {
    return execFileSync('git', ['ls-files', `${FLOW_ROOT}/**/*.yaml`, `${FLOW_ROOT}/*.yaml`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    })
        .split('\n')
        .filter((line) => line.length > 0);
}
