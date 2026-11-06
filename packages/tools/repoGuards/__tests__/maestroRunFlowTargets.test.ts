/**
 * EVERY MAESTRO `runFlow` NAMES A FLOW THAT EXISTS.
 *
 * Maestro resolves a `runFlow` path against the directory of the flow that calls it, and it checks the path only when it
 * runs that flow: a wrong path is `Invalid File Path` at run time, and nothing earlier says so. `recipes/
 * pastePublishOpenChoices.yaml` called `scrollIntoTapView.yaml` from `recipes/`, where it never was (it lives in
 * `recipes/common/`). The flow was in `KNOWN_UNRUN_FLOWS`, so no run had loaded it until a device pass on 2026-11-06
 * failed it on both platforms before its first step.
 *
 * Both forms are judged: `runFlow: path` and `runFlow: { file: path }`. A `runFlow` with inline `commands` names no file,
 * and its commands are judged where they sit.
 */

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, commandLists, committedFlowFiles, isRecord, parseFlow } from './maestroFlowYaml.js';

/** A floor on the references found across the committed flows, so a parser that found none cannot pass. */
const MIN_REFERENCES = 100;

/** The file a `runFlow` command names, or `undefined` for any other command and for inline `commands`. Pure. */
function runFlowTarget(command: unknown): string | undefined {
    if (!isRecord(command)) {
        return undefined;
    }

    const value = command['runFlow'];

    if (typeof value === 'string') {
        return value;
    }

    return isRecord(value) && typeof value['file'] === 'string' ? value['file'] : undefined;
}

/**
 * Every `runFlow` in one flow whose file is not a committed flow, resolved from the calling flow's directory. Pure.
 *
 * @param file - The calling flow, repo-relative with `/` separators.
 * @param source - Its YAML.
 * @param exists - Whether a repo-relative path is a committed flow.
 * @returns How many references the flow holds, and one message per reference that names no flow.
 */
export function missingRunFlowTargets(
    file: string,
    source: string,
    exists: (path: string) => boolean,
): { readonly references: number; readonly offenders: readonly string[] } {
    const offenders: string[] = [];
    let references = 0;

    for (const document of parseFlow(file, source)) {
        for (const list of commandLists(document)) {
            for (const command of list) {
                const target = runFlowTarget(command);

                if (target === undefined) {
                    continue;
                }

                references += 1;
                const resolved = posix.normalize(posix.join(posix.dirname(file), target));

                if (!exists(resolved)) {
                    offenders.push(`${file}: runFlow names ${target}, and ${resolved} is not a committed flow`);
                }
            }
        }
    }

    return { references, offenders };
}

const FLOWS = 'm/.maestro';
const KNOWN = new Set([`${FLOWS}/auth/signin.yaml`, `${FLOWS}/recipes/common/scroll.yaml`]);
const known = (path: string): boolean => KNOWN.has(path);
const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('missingRunFlowTargets (the rule, on inline flows)', () => {
    it.each([
        ['a sibling name that lives one folder down', '- runFlow: scroll.yaml\n'],
        ['the file form, missing its folder', '- runFlow:\n    file: scroll.yaml\n'],
        ['a path one folder too high', '- runFlow: ../common/scroll.yaml\n'],
        ['a missing file inside inline commands', '- runFlow:\n    commands:\n      - runFlow: gone.yaml\n'],
    ])('refuses %s', (_label, body) => {
        expect(missingRunFlowTargets(`${FLOWS}/recipes/a.yaml`, flow(body), known).offenders).toHaveLength(1);
    });

    it.each([
        ['the folder path', '- runFlow: common/scroll.yaml\n'],
        ['the file form', '- runFlow:\n    file: common/scroll.yaml\n    env:\n      TARGET: Publish\n'],
        ['a path that climbs a folder', '- runFlow: ../auth/signin.yaml\n'],
    ])('allows %s', (_label, body) => {
        const judged = missingRunFlowTargets(`${FLOWS}/recipes/a.yaml`, flow(body), known);

        expect(judged.references).toBe(1);
        expect(judged.offenders).toEqual([]);
    });

    it('reads no file from inline commands alone', () => {
        const judged = missingRunFlowTargets(
            `${FLOWS}/a.yaml`,
            flow('- runFlow:\n    commands:\n      - back\n'),
            known,
        );

        expect(judged).toEqual({ references: 0, offenders: [] });
    });
});

describe('every committed runFlow names a committed flow', () => {
    const files = committedFlowFiles();
    const committed = new Set(files);
    const judged = files.map((file) =>
        missingRunFlowTargets(file, readFileSync(join(REPO_ROOT, file), 'utf8'), (path) => committed.has(path)),
    );

    it('finds the references', () => {
        expect(judged.reduce((sum, { references }) => sum + references, 0)).toBeGreaterThanOrEqual(MIN_REFERENCES);
    });

    it('every reference resolves', () => {
        expect(judged.flatMap(({ offenders }) => offenders)).toEqual([]);
    });
});
