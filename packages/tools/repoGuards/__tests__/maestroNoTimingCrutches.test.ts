/**
 * A MAESTRO FLOW WAITS FOR WHAT THE SCREEN SHOWS, NEVER FOR TIME TO PASS, AND NEVER TAPS OR TYPES TWICE IN CASE THE
 * FIRST TRY WAS LOST.
 *
 * Owner ruling, 2026-10-20: "We shouldn't be using waits and retries in tests anyway — you're writing extremely fragile
 * tests." Nothing in the app or its tests may depend on how fast or slow a transition runs.
 *
 * The measured reason the crutches grew: a tap on a sheet that was still sliding up did nothing (local iOS run,
 * 2026-10-20, `ingredientRemove`). Maestro waits for an element to EXIST, not for it to stop moving, and iOS ignores
 * touches until a modal has finished presenting. So the flows gained `waitForAnimationToEnd`, `retryTapIfNoChange` and
 * "tap again if nothing happened" blocks, each of which only made the race less likely. The cure is upstream: the test
 * devices run with motion OFF (Android animation scales 0, iOS Reduce Motion on; `tests/e2e/runMaestroFlows.sh`, guarded
 * by `maestroReduceMotion.test.ts`), so a sheet or dialog is presented in the frame it appears.
 *
 * Waiting on STATE stays: `extendedWaitUntil` and `assertVisible` on what the screen should show is how Maestro
 * asserts. So does reading back a typed value. Only the retry around it goes.
 *
 * The rules, over every committed flow, parsed as YAML (not grepped, so comments and quoting cannot hide a command):
 *   (a) no `waitForAnimationToEnd` command, in either its bare or its map form;
 *   (b) no `retryTapIfNoChange` key anywhere;
 *   (c) no re-tap or re-type: a `runFlow` whose `when` has a `notVisible` condition and whose own commands `tapOn` or
 *       `inputText` the same text as a `tapOn` or `inputText` in the {@link RETRY_LOOKBACK} commands before it.
 *
 * Allowed by rule (c): a platform branch, a `when: visible` branch (a one-time system intro, a permission dialog), and a
 * `notVisible` branch that acts on text the flow did not just tap or type (a branch on app state, not a retry).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, commandLists, committedFlowFiles, isRecord, parseFlow, textOf } from './maestroFlowYaml.js';

/** How many commands before a conditional `runFlow` rule (c) looks back for the tap or typing it would repeat. */
const RETRY_LOOKBACK = 3;

/**
 * A floor under the conditional `runFlow`s the flows hold: 71 once the retries were removed (2026-10-20). It keeps rule
 * (c) honest: a parser change that stopped seeing them would otherwise pass with nothing to judge.
 */
const MIN_CONDITIONAL_RUN_FLOWS = 60;

const WAIT_COMMAND = 'waitForAnimationToEnd';
const RETRY_KEY = 'retryTapIfNoChange';

/** Whether a command is `waitForAnimationToEnd`, bare (`- waitForAnimationToEnd`) or with options. Pure. */
const isAnimationWait = (command: unknown): boolean =>
    command === WAIT_COMMAND || (isRecord(command) && WAIT_COMMAND in command);

/** How many times a parsed value carries a `retryTapIfNoChange` key, however deep. Pure. */
function retryKeyCount(value: unknown): number {
    if (Array.isArray(value)) {
        return value.reduce((sum: number, item) => sum + retryKeyCount(item), 0);
    }

    return isRecord(value)
        ? Object.entries(value).reduce((sum, [key, item]) => sum + (key === RETRY_KEY ? 1 : 0) + retryKeyCount(item), 0)
        : 0;
}

/** The text a `tapOn` or `inputText` command names, or `undefined` for any other command. Pure. */
function actedOnText(command: unknown): string | undefined {
    if (!isRecord(command)) {
        return undefined;
    }

    if ('tapOn' in command) {
        return textOf(command['tapOn']);
    }

    return 'inputText' in command ? textOf(command['inputText']) : undefined;
}

/** A conditional `runFlow` with inline commands, as `{ when, commands }`, or `undefined`. Pure. */
function conditionalRunFlow(
    command: unknown,
): { readonly when: Record<string, unknown>; readonly commands: readonly unknown[] } | undefined {
    if (!isRecord(command) || !isRecord(command['runFlow'])) {
        return undefined;
    }

    const { when, commands } = command['runFlow'];

    return isRecord(when) ? { when, commands: Array.isArray(commands) ? commands : [] } : undefined;
}

interface Crutch {
    readonly rule: 'a' | 'b' | 'c';
    readonly detail: string;
}

/**
 * Every timing crutch in one flow. Pure.
 *
 * @param file - The flow's path, for the parse error.
 * @param source - The flow's YAML.
 * @returns One entry per offending command, and the number of conditional `runFlow`s judged by rule (c).
 */
export function crutchesIn(
    file: string,
    source: string,
): { readonly crutches: readonly Crutch[]; readonly conditionals: number } {
    const crutches: Crutch[] = [];
    let conditionals = 0;

    for (const document of parseFlow(file, source)) {
        for (let found = retryKeyCount(document); found > 0; found -= 1) {
            crutches.push({ rule: 'b', detail: RETRY_KEY });
        }

        for (const list of commandLists(document)) {
            list.forEach((command, index) => {
                if (isAnimationWait(command)) {
                    crutches.push({ rule: 'a', detail: WAIT_COMMAND });
                }

                const conditional = conditionalRunFlow(command);

                if (conditional === undefined) {
                    return;
                }

                conditionals += 1;

                if (!('notVisible' in conditional.when)) {
                    return;
                }

                const before = new Set(
                    list
                        .slice(Math.max(0, index - RETRY_LOOKBACK), index)
                        .map(actedOnText)
                        .filter((text): text is string => text !== undefined),
                );

                for (const repeated of conditional.commands.map(actedOnText)) {
                    if (repeated !== undefined && before.has(repeated)) {
                        crutches.push({ rule: 'c', detail: `repeats "${repeated}"` });
                    }
                }
            });
        }
    }

    return { crutches, conditionals };
}

const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('crutchesIn (the rules, on inline flows)', () => {
    it('refuses waitForAnimationToEnd in its map form and its bare form', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow("- tapOn: 'A'\n- waitForAnimationToEnd:\n    timeout: 3000\n- waitForAnimationToEnd\n"),
        );

        expect(crutches).toEqual([
            { rule: 'a', detail: WAIT_COMMAND },
            { rule: 'a', detail: WAIT_COMMAND },
        ]);
    });

    it('refuses a wait nested inside a conditional runFlow', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow('- runFlow:\n    when:\n      platform: iOS\n    commands:\n      - waitForAnimationToEnd\n'),
        );

        expect(crutches).toEqual([{ rule: 'a', detail: WAIT_COMMAND }]);
    });

    it('refuses retryTapIfNoChange on a tap', () => {
        const { crutches } = crutchesIn('inline', flow("- tapOn:\n    text: 'A'\n    retryTapIfNoChange: true\n"));

        expect(crutches).toEqual([{ rule: 'b', detail: RETRY_KEY }]);
    });

    it('refuses a bare re-tap: tap, then tap the same text again while the result is not visible', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'Discard draft'\n- runFlow:\n    when:\n      notVisible: 'Discard this draft?'\n" +
                    "      visible: 'Discard draft'\n    commands:\n      - tapOn: 'Discard draft'\n",
            ),
        );

        expect(crutches).toEqual([{ rule: 'c', detail: 'repeats "Discard draft"' }]);
    });

    it('refuses a re-type a few commands after the first typing', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'Title'\n- inputText: ${TITLE}\n- runFlow: dismissKeyboardIntro.yaml\n- runFlow:\n" +
                    '    when:\n      notVisible: ${TITLE}.*\n    commands:\n      - eraseText: 64\n      - inputText: ${TITLE}\n',
            ),
        );

        expect(crutches).toEqual([{ rule: 'c', detail: 'repeats "${TITLE}"' }]);
    });

    it('allows a platform branch that repeats a tap', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow("- tapOn: 'A'\n- runFlow:\n    when:\n      platform: iOS\n    commands:\n      - tapOn: 'A'\n"),
        );

        expect(crutches).toEqual([]);
    });

    it('allows a when-visible branch on a one-time intro', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'Title'\n- runFlow:\n    when:\n      platform: iOS\n      visible: 'Continue'\n" +
                    "    commands:\n      - tapOn: 'Continue'\n",
            ),
        );

        expect(crutches).toEqual([]);
    });

    it('allows a notVisible branch that acts on different text (a branch on app state)', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'Publish'\n- runFlow:\n    when:\n      notVisible: 'Who can see it: Public'\n" +
                    "    commands:\n      - tapOn: 'Private'\n",
            ),
        );

        expect(crutches).toEqual([]);
    });

    it('allows the same tap when it is further back than the lookback', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'A'\n- assertVisible: 'B'\n- assertVisible: 'C'\n- assertVisible: 'D'\n- runFlow:\n" +
                    "    when:\n      notVisible: 'E'\n    commands:\n      - tapOn: 'A'\n",
            ),
        );

        expect(crutches).toEqual([]);
    });
});

describe('the committed flows carry no timing crutch', () => {
    const judged = committedFlowFiles().map((file) => ({
        file,
        ...crutchesIn(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
    }));

    it('finds the conditional runFlows (a parser change that saw none would otherwise pass)', () => {
        expect(judged.reduce((sum, { conditionals }) => sum + conditionals, 0)).toBeGreaterThanOrEqual(
            MIN_CONDITIONAL_RUN_FLOWS,
        );
    });

    it.each([
        ['a', 'waits for an animation to end'],
        ['b', 'retries a tap if the screen did not change'],
        ['c', 'taps or types again while the result is not visible'],
    ] as const)('no flow %s: %s', (rule: Crutch['rule'], _description: string) => {
        const offenders = judged.flatMap(({ file, crutches }) =>
            crutches.filter((crutch) => crutch.rule === rule).map((crutch) => `${file}: ${crutch.detail}`),
        );

        expect(offenders).toEqual([]);
    });
});
