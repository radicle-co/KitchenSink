/**
 * A MAESTRO FLOW NEVER STOPS AND STARTS THE APP AGAIN RIGHT AFTER A DATA CLEAR.
 *
 * `launchApp: clearState: true` clears the app's data, which makes Android remove the app's old task. A second
 * `launchApp` straight after it stops the process the first one started and starts another, and the old task's removal
 * then timed out and killed the NEW process: "Killing 6592:io.commise.mobile/u0a141 (adj -10000): remove task", then
 * "Process … 6592 … failed to attach", and the screen stayed blank until the flow failed (local Android suite,
 * 2026-10-20 `sessionHandoff`, 2026-10-21 `makePublicConfirm`; the second launch came from `auth/signOutIfSignedIn.yaml`).
 *
 * The rule, over every committed flow parsed as YAML: a `launchApp` with `clearState: true` is not followed by a
 * `launchApp` that stops the app, written inline or as the FIRST command of the sub-flow the next command runs. A
 * `launchApp` with `stopApp: false` only brings the app to the front, so it is allowed.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    REPO_ROOT,
    commandLists,
    committedFlowFiles,
    isLaunch,
    isRecord,
    launchOptions,
    parseFlow,
} from './maestroFlowYaml.js';

/** Clearing launches today: 13 (2026-10-21). A floor, so a parser that saw none cannot pass. */
const MIN_CLEARING_LAUNCHES = 10;

/** Whether a command clears the app's data as it launches. Pure. */
const clears = (command: unknown): boolean => isLaunch(command) && launchOptions(command)['clearState'] === true;

/** Whether a command stops and starts the app (Maestro's `launchApp` stops it unless told `stopApp: false`). Pure. */
const restarts = (command: unknown): boolean => isLaunch(command) && launchOptions(command)['stopApp'] !== false;

/** The sub-flow file a `runFlow` command names, or none. Pure. */
function subFlowFile(command: unknown): string | undefined {
    if (!isRecord(command)) {
        return undefined;
    }

    const run = command['runFlow'];

    if (typeof run === 'string') {
        return run;
    }

    return isRecord(run) && typeof run['file'] === 'string' ? run['file'] : undefined;
}

/**
 * Every clearing launch in one flow that the next command follows with a restart. Pure apart from `readFlow`.
 *
 * @param file - The flow's repo-relative path.
 * @param source - Its YAML.
 * @param readFlow - Reads a sub-flow's YAML by repo-relative path, or answers `undefined`.
 * @returns How many clearing launches the flow holds, and one description per offending pair.
 */
export function restartsAfterClear(
    file: string,
    source: string,
    readFlow: (path: string) => string | undefined,
): { readonly clearing: number; readonly offenders: readonly string[] } {
    const offenders: string[] = [];
    let clearing = 0;

    for (const document of parseFlow(file, source)) {
        for (const list of commandLists(document)) {
            list.forEach((command, index) => {
                if (!clears(command)) {
                    return;
                }

                clearing += 1;
                const next: unknown = list[index + 1];

                if (restarts(next)) {
                    offenders.push(`${file}: a launchApp restarts the app right after the clear`);

                    return;
                }

                const sub = subFlowFile(next);

                if (sub === undefined) {
                    return;
                }

                const path = join(dirname(file), sub);
                const subSource = readFlow(path);
                const first =
                    subSource === undefined
                        ? undefined
                        : parseFlow(path, subSource).flatMap((d) => [...commandLists(d)])[0]?.[0];

                if (restarts(first)) {
                    offenders.push(`${file}: ${sub} starts by restarting the app right after the clear`);
                }
            });
        }
    }

    return { clearing, offenders };
}

const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('restartsAfterClear (the rule, on inline flows)', () => {
    const none = (): undefined => undefined;

    it('refuses a bare launchApp right after a clearing one', () => {
        const { offenders } = restartsAfterClear(
            'a.yaml',
            flow('- launchApp:\n    clearState: true\n- launchApp\n'),
            none,
        );

        expect(offenders).toHaveLength(1);
    });

    it('refuses a sub-flow whose first command restarts the app', () => {
        const helper = flow("- launchApp\n- assertVisible: 'x'\n");
        const { offenders } = restartsAfterClear(
            'dir/a.yaml',
            flow('- launchApp:\n    clearState: true\n- runFlow: ../auth/helper.yaml\n'),
            (path) => (path === 'auth/helper.yaml' ? helper : undefined),
        );

        expect(offenders).toEqual([
            'dir/a.yaml: ../auth/helper.yaml starts by restarting the app right after the clear',
        ]);
    });

    it('allows a launch that only brings the app to the front, inline or in the sub-flow', () => {
        const helper = flow('- launchApp:\n    stopApp: false\n');

        expect(
            restartsAfterClear(
                'a.yaml',
                flow('- launchApp:\n    clearState: true\n- launchApp:\n    stopApp: false\n- runFlow: h.yaml\n'),
                () => helper,
            ).offenders,
        ).toEqual([]);
        expect(
            restartsAfterClear('a.yaml', flow('- launchApp:\n    clearState: true\n- runFlow: h.yaml\n'), () => helper)
                .offenders,
        ).toEqual([]);
    });

    it('allows a restart that does not follow a clear', () => {
        expect(restartsAfterClear('a.yaml', flow("- launchApp\n- tapOn: 'x'\n- launchApp\n"), none).offenders).toEqual(
            [],
        );
    });
});

describe('the committed flows never restart the app right after a data clear', () => {
    const read = (path: string): string | undefined => {
        try {
            return readFileSync(join(REPO_ROOT, path), 'utf8');
        } catch {
            return undefined;
        }
    };

    const judged = committedFlowFiles().map((file) => restartsAfterClear(file, read(file) ?? '', read));

    it('finds the clearing launches', () => {
        expect(judged.reduce((sum, { clearing }) => sum + clearing, 0)).toBeGreaterThanOrEqual(MIN_CLEARING_LAUNCHES);
    });

    it('no clearing launch is followed by a restart', () => {
        expect(judged.flatMap(({ offenders }) => offenders)).toEqual([]);
    });
});
