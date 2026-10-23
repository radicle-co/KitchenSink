/**
 * A MAESTRO FLOW CLEARS THE APP'S DATA ONLY THROUGH `auth/launchCleared.yaml`, WHICH LETS ANDROID FINISH THE CLEAR
 * BEFORE IT STARTS THE APP.
 *
 * Clearing the app's data makes Android remove the app's old task, and that removal kills the app's process when its
 * timer runs out. A launch inside that window starts a process the timer then kills: "Destroy timeout of remove-task",
 * "Killing …: remove task", "… failed to attach", and the screen stays blank until the flow fails. The timer is fixed:
 * measured from the clear's kill to the destroy timeout at 1.004 s, 1.027 s, 1.004 s and 1.008 s (CI runs 39668114177
 * and 39889070110, local runs 2026-10-23 00:00 and 07:29). It fires only when the app was busy as the clear came, which
 * is why the same flows pass most runs and failed `sessionHandoff` in 2 of 5 CI runs.
 *
 * `launchApp: clearState: true` clears and starts at once, inside the window, so no flow may use it. An earlier version
 * of this guard banned only a SECOND launch straight after a clearing one. That missed the launch inside the clearing
 * command itself, and it failed the same way when a flow cleared with a bare `clearState` and launched next (local
 * 2026-10-23 07:29, offlineSave).
 *
 * The rule, over every committed flow parsed as YAML:
 *   (a) no `launchApp` has `clearState: true`;
 *   (b) no flow but `auth/launchCleared.yaml` runs `clearState`;
 *   (c) `auth/launchCleared.yaml` clears, then on Android waits at least {@link ANDROID_CLEAR_SETTLE_MS}, then launches
 *       without clearing. The wait is the one timed wait the flows hold (owner ruling 2026-10-23), and
 *       `maestroNoTimingCrutches.test.ts` names it. iOS has no such timer, so it does not wait.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    FLOW_ROOT,
    REPO_ROOT,
    commandLists,
    committedFlowFiles,
    isLaunch,
    isRecord,
    launchOptions,
    namesFlow,
    parseFlow,
} from './maestroFlowYaml.js';

/** The one flow that clears the app's data. */
const LAUNCH_CLEARED = `${FLOW_ROOT}/auth/launchCleared.yaml`;

/** The longest measured clear-to-kill timer, 1.027 s, with about a second of margin (header). */
export const ANDROID_CLEAR_SETTLE_MS = 2000;

/** Clearing launches today: 20 in 12 flows (2026-10-23). A floor, so a parser that saw none cannot pass. */
const MIN_CLEARED_LAUNCHES = 15;

/** Whether a command clears the app's data: `clearState`, bare or with options. Pure. */
const clearsAlone = (command: unknown): boolean =>
    command === 'clearState' || (isRecord(command) && 'clearState' in command);

/** Whether a command is a `launchApp` that clears as it starts. Pure. */
const launchClears = (command: unknown): boolean => isLaunch(command) && launchOptions(command)['clearState'] === true;

/** Whether a command runs `auth/launchCleared.yaml`. Pure. */
function runsLaunchCleared(command: unknown): boolean {
    const run = isRecord(command) ? command['runFlow'] : undefined;
    const file = typeof run === 'string' ? run : isRecord(run) ? run['file'] : undefined;

    return typeof file === 'string' && namesFlow(file, 'launchCleared.yaml');
}

/**
 * Every way one flow clears the app's data outside the shared step, and how many times it runs that step. Pure.
 *
 * @param file - The flow's repo-relative path.
 * @param source - Its YAML.
 * @returns One description per offending command, and the number of `launchCleared.yaml` calls.
 */
export function clearsOutsideTheStep(
    file: string,
    source: string,
): { readonly offenders: readonly string[]; readonly calls: number } {
    const offenders: string[] = [];
    let calls = 0;

    for (const document of parseFlow(file, source)) {
        for (const list of commandLists(document)) {
            for (const command of list) {
                if (launchClears(command)) {
                    offenders.push(`${file}: launchApp clears and starts at once`);
                }

                if (clearsAlone(command) && file !== LAUNCH_CLEARED) {
                    offenders.push(`${file}: clearState outside auth/launchCleared.yaml`);
                }

                calls += runsLaunchCleared(command) ? 1 : 0;
            }
        }
    }

    return { offenders, calls };
}

/**
 * Whether the shared step's commands are: a clear, an Android-only wait of at least {@link ANDROID_CLEAR_SETTLE_MS}, and
 * a launch that does not clear, in that order. Pure.
 */
export function settlesBeforeLaunch(commands: readonly unknown[]): boolean {
    const [clear, settle, launch, ...rest] = commands;
    const branch = isRecord(settle) && isRecord(settle['runFlow']) ? settle['runFlow'] : undefined;
    const when = isRecord(branch?.['when']) ? branch['when'] : undefined;
    const inner = Array.isArray(branch?.['commands']) ? branch['commands'] : [];
    const wait = inner.length === 1 && isRecord(inner[0]) ? inner[0]['extendedWaitUntil'] : undefined;

    return (
        clearsAlone(clear) &&
        when?.['platform'] === 'Android' &&
        Object.keys(when).length === 1 &&
        isRecord(wait) &&
        typeof wait['timeout'] === 'number' &&
        wait['timeout'] >= ANDROID_CLEAR_SETTLE_MS &&
        isLaunch(launch) &&
        !launchClears(launch) &&
        rest.length === 0
    );
}

const flow = (body: string): string => `appId: test\n---\n${body}`;
const WAIT = (timeout: number, platform = 'Android'): unknown => ({
    runFlow: {
        when: { platform },
        commands: [{ extendedWaitUntil: { visible: 'x', timeout, optional: true } }],
    },
});
const LAUNCH = { launchApp: { permissions: {} } };

describe('clearsOutsideTheStep (the rule, on inline flows)', () => {
    it('refuses a launchApp that clears as it starts', () => {
        expect(
            clearsOutsideTheStep('a.yaml', flow('- launchApp:\n    permissions: {}\n    clearState: true\n')).offenders,
        ).toEqual(['a.yaml: launchApp clears and starts at once']);
    });

    it('refuses a bare clearState, and one with options, outside the shared step', () => {
        expect(
            clearsOutsideTheStep('a.yaml', flow('- clearState\n- clearState:\n    appId: x\n- launchApp\n')).offenders,
        ).toEqual([
            'a.yaml: clearState outside auth/launchCleared.yaml',
            'a.yaml: clearState outside auth/launchCleared.yaml',
        ]);
    });

    it('counts a call of the shared step, and allows it', () => {
        expect(clearsOutsideTheStep('a.yaml', flow('- runFlow: ../auth/launchCleared.yaml\n'))).toEqual({
            offenders: [],
            calls: 1,
        });
    });
});

describe('settlesBeforeLaunch (the shared step, on inline command lists)', () => {
    it('accepts clear, an Android wait of 2 s, then a launch', () => {
        expect(settlesBeforeLaunch(['clearState', WAIT(2000), LAUNCH])).toBe(true);
    });

    it.each([
        ['a shorter wait', ['clearState', WAIT(1000), LAUNCH]],
        ['a wait on every platform', ['clearState', { extendedWaitUntil: { visible: 'x', timeout: 2000 } }, LAUNCH]],
        ['a wait on iOS', ['clearState', WAIT(2000, 'iOS'), LAUNCH]],
        ['no wait', ['clearState', LAUNCH]],
        ['the launch before the wait', ['clearState', LAUNCH, WAIT(2000)]],
        ['a launch that clears', ['clearState', WAIT(2000), { launchApp: { clearState: true } }]],
        ['no clear', [WAIT(2000), LAUNCH]],
        ['a command after the launch', ['clearState', WAIT(2000), LAUNCH, { tapOn: 'x' }]],
    ])('refuses %s', (_name: string, commands: readonly unknown[]) => {
        expect(settlesBeforeLaunch(commands)).toBe(false);
    });
});

describe('the committed flows clear the app only through auth/launchCleared.yaml', () => {
    const judged = committedFlowFiles().map((file) =>
        clearsOutsideTheStep(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
    );

    it('finds the calls of the shared step', () => {
        expect(judged.reduce((sum, { calls }) => sum + calls, 0)).toBeGreaterThanOrEqual(MIN_CLEARED_LAUNCHES);
    });

    it('no flow clears any other way', () => {
        expect(judged.flatMap(({ offenders }) => offenders)).toEqual([]);
    });

    it('the shared step clears, waits on Android, then launches', () => {
        const documents = parseFlow(LAUNCH_CLEARED, readFileSync(join(REPO_ROOT, LAUNCH_CLEARED), 'utf8'));
        const commands = documents.at(-1);

        expect(Array.isArray(commands) && settlesBeforeLaunch(commands)).toBe(true);
    });
});
