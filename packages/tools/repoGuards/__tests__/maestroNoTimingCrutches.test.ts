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
 *       `inputText` the same text as a `tapOn` or `inputText` in the {@link RETRY_LOOKBACK} commands before it;
 *   (d) no timed sleep: an `extendedWaitUntil` with `optional: true` (a wait that may run out without failing), or an
 *       `evalScript` that loops on the clock.
 *
 * Allowed by rule (c): a platform branch, a `when: visible` branch (a one-time system intro, a permission dialog), and a
 * `notVisible` branch that acts on text the flow did not just tap or type (a branch on app state, not a retry).
 *
 * ONE EXCEPTION, by owner ruling 2026-10-23 ("Allow one focus-checked re-tap"): {@link FOCUS_RETAP_EXCEPTIONS}. On a
 * fresh `launchApp`, the iOS Simulator's SpringBoard can keep its switcher window over the app for a few seconds after
 * the app has drawn, so the tap on the sign-in email field lands on SpringBoard and the field never takes focus (CI runs
 * 39889070110 and 39668114177: the touch went to `SBMainSwitcherWindow`, Commise received none). That is outside the app
 * and the flows, and no screen state shows it. So the shared sign-in step may tap the field once more, on iOS only, and
 * only when the field did not take focus. Maestro reports no focus for an iOS text field (local probe, 2026-10-23), so
 * the signal is the keyboard's return key: the branch's `when` must be `platform: iOS` with `notVisible` on
 * {@link FOCUS_RETURN_KEY}.
 *
 * ONE TIMED WAIT, by owner ruling 2026-10-23 ("This seems an appropriate place to add an additional second or two of
 * explicit wait"): {@link TIMED_WAIT_EXCEPTIONS}. Clearing the app's data starts a fixed one-second Android timer that
 * kills the next process the app starts inside it, and no screen state shows the timer running. So the one step that
 * clears data waits it out on Android before it launches (`maestroLaunchAfterClear.test.ts` holds the step's shape).
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

/**
 * The iOS keyboard's return key while the sign-in email field has focus (`enterKeyHint="next"` in `login.tsx`; the
 * password field's is `go`), as its id in Maestro's hierarchy.
 */
const FOCUS_RETURN_KEY = 'Next:';

/**
 * The one re-tap a flow may hold, as `file: repeats "text"`: the focus-checked re-tap of the sign-in email field (owner
 * ruling 2026-10-23, see the header).
 */
const FOCUS_RETAP_EXCEPTIONS: readonly string[] = [
    'packages/apps/commise/mobile/.maestro/auth/signinHome.yaml: repeats "you@example.com"',
];

/** The one flow that may wait for time to pass: the step that clears the app's data (see the header). */
const TIMED_WAIT_EXCEPTIONS: readonly string[] = ['packages/apps/commise/mobile/.maestro/auth/launchCleared.yaml'];

const WAIT_COMMAND = 'waitForAnimationToEnd';
const RETRY_KEY = 'retryTapIfNoChange';

/** Whether a command sleeps: an `extendedWaitUntil` that may run out without failing, or a script that loops on the clock. Pure. */
function isTimedWait(command: unknown): boolean {
    if (!isRecord(command)) {
        return false;
    }

    const wait = command['extendedWaitUntil'];
    const script = command['evalScript'];

    return (
        (isRecord(wait) && wait['optional'] === true) ||
        (typeof script === 'string' && /\bwhile\b/u.test(script) && /Date\.now\(\)/u.test(script))
    );
}

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
    readonly rule: 'a' | 'b' | 'c' | 'd';
    readonly detail: string;
    /** Rule (c) only: whether the branch runs only while the field has no focus ({@link isFocusCheck}). */
    readonly focusChecked?: boolean;
}

/** Whether a `when` runs only on iOS while the email field's return key is absent: the field has no focus. Pure. */
function isFocusCheck(when: Record<string, unknown>): boolean {
    const selector = when['notVisible'];

    return when['platform'] === 'iOS' && isRecord(selector) && selector['id'] === FOCUS_RETURN_KEY;
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

                if (isTimedWait(command)) {
                    crutches.push({ rule: 'd', detail: 'a timed sleep' });
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
                        crutches.push({
                            rule: 'c',
                            detail: `repeats "${repeated}"`,
                            focusChecked: isFocusCheck(conditional.when),
                        });
                    }
                }
            });
        }
    }

    return { crutches, conditionals };
}

const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('crutchesIn (the rules, on inline flows)', () => {
    it('refuses an optional extendedWaitUntil, the shape of a timed sleep', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow("- extendedWaitUntil:\n    visible: 'never'\n    timeout: 2000\n    optional: true\n"),
        );

        expect(crutches).toEqual([{ rule: 'd', detail: 'a timed sleep' }]);
    });

    it('refuses a script that loops on the clock', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow('- evalScript: ${(function () { const end = Date.now() + 2000; while (Date.now() < end) {} })()}\n'),
        );

        expect(crutches).toEqual([{ rule: 'd', detail: 'a timed sleep' }]);
    });

    it('allows an extendedWaitUntil that fails when the state never comes', () => {
        expect(
            crutchesIn('inline', flow("- extendedWaitUntil:\n    visible: 'Saved'\n    timeout: 30000\n")).crutches,
        ).toEqual([]);
    });

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

        expect(crutches).toEqual([{ rule: 'c', detail: 'repeats "Discard draft"', focusChecked: false }]);
    });

    it('refuses a re-type a few commands after the first typing', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'Title'\n- inputText: ${TITLE}\n- runFlow: dismissKeyboardIntro.yaml\n- runFlow:\n" +
                    '    when:\n      notVisible: ${TITLE}.*\n    commands:\n      - eraseText: 64\n      - inputText: ${TITLE}\n',
            ),
        );

        expect(crutches).toEqual([{ rule: 'c', detail: 'repeats "${TITLE}"', focusChecked: false }]);
    });

    it('marks a re-tap that runs only on iOS while the email field has no focus (its return key is absent)', () => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                "- tapOn: 'you@example.com'\n- runFlow:\n    when:\n      platform: iOS\n      notVisible:\n" +
                    "        id: 'Next:'\n    commands:\n      - tapOn: 'you@example.com'\n",
            ),
        );

        expect(crutches).toEqual([{ rule: 'c', detail: 'repeats "you@example.com"', focusChecked: true }]);
    });

    it.each([
        ['on every platform', "      notVisible:\n        id: 'Next:'\n"],
        ['on another key', "      platform: iOS\n      notVisible:\n        id: 'Go:'\n"],
        ['on the text itself', "      platform: iOS\n      notVisible: 'you@example\\.com'\n"],
    ])('does not count a re-tap keyed %s as focus-checked', (_name: string, when: string) => {
        const { crutches } = crutchesIn(
            'inline',
            flow(
                `- tapOn: 'you@example.com'\n- runFlow:\n    when:\n${when}    commands:\n      - tapOn: 'you@example.com'\n`,
            ),
        );

        expect(crutches).toEqual([{ rule: 'c', detail: 'repeats "you@example.com"', focusChecked: false }]);
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
        ['d', 'waits for time to pass'],
    ] as const)('no flow %s: %s', (rule: Crutch['rule'], _description: string) => {
        const offenders = judged.flatMap(({ file, crutches }) =>
            crutches
                .filter((crutch) => crutch.rule === rule)
                .filter(
                    (crutch) =>
                        !(crutch.focusChecked === true && FOCUS_RETAP_EXCEPTIONS.includes(`${file}: ${crutch.detail}`)),
                )
                .filter((crutch) => !(crutch.rule === 'd' && TIMED_WAIT_EXCEPTIONS.includes(file)))
                .map((crutch) => `${file}: ${crutch.detail}`),
        );

        expect(offenders).toEqual([]);
    });

    it('holds its one timed wait, and only in the step that clears the app (a stale exception fails)', () => {
        const held = judged.flatMap(({ file, crutches }) =>
            crutches.some((crutch) => crutch.rule === 'd') ? [file] : [],
        );

        expect(held).toEqual(TIMED_WAIT_EXCEPTIONS);
    });

    it('holds every exception it grants, focus-checked (a stale or widened exception fails)', () => {
        const held = judged.flatMap(({ file, crutches }) =>
            crutches.filter((crutch) => crutch.focusChecked === true).map((crutch) => `${file}: ${crutch.detail}`),
        );

        expect(held).toEqual(FOCUS_RETAP_EXCEPTIONS);
    });
});
