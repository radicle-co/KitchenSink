/**
 * A PICK FROM AN OPEN FOOD LIST GOES THROUGH ONE STEP, `common/pickFromOpenList.yaml`, WHICH TAPS NEAR THE OPTION'S TOP.
 *
 * `common/scrollOpenList.yaml` scrolls an open list until its target is on screen, and on iOS with the soft keyboard up
 * until the target is `above` the keyboard. Maestro's `above` compares TOP edges only, so the option's centre, where a
 * plain `tapOn` lands, can still be under the keyboard. The helper used to end with a "lift" drag to clear it, and it was
 * wrong both ways it could be written: unconditional, it started on the page below a SHORT list and closed the list (CI
 * run 39400327458, iOS shard 1, `versions`); gated on "some option starts below the keyboard", it skipped exactly when
 * the target was the LAST option straddling the keyboard's edge, and the tap landed on the suggestion strip (Mac run,
 * `ingredientArrival`). The shared step taps at a point near the option's top instead, which the helper already
 * guarantees is on screen, so nothing has to move.
 *
 * The rules, over every committed flow, parsed as YAML (not grepped, so comments and quoting cannot hide a pair):
 *   1. A `runFlow` of `scrollOpenList.yaml` immediately followed, in the same command list, by a `tapOn` of its TARGET is
 *      refused anywhere but the shared step's own file.
 *   2. The shared step taps near the top going down, and its every tap names the topmost match (`index: 0`).
 *   3. `scrollOpenList.yaml` swipes only inside its `repeat` loops, so it never moves a target it has already found.
 *
 * A flow that does not parse FAILS this suite. Prettier ignores `.maestro`, so this is the only syntax check a scripted
 * edit of the flows gets before Maestro loads them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    FLOW_ROOT,
    REPO_ROOT,
    commandLists,
    committedFlowFiles,
    isRecord,
    namesFlow,
    parseFlow,
    textOf,
} from './maestroFlowYaml.js';

const HELPER = 'scrollOpenList.yaml';
const SHARED_STEP = 'pickFromOpenList.yaml';
const COMMON = join(REPO_ROOT, FLOW_ROOT, 'recipes', 'common');

/**
 * How many pairs the suite held when the shared step was introduced (24, every one converted). The floor keeps the scan
 * honest: a parser change that stopped seeing calls would otherwise pass with nothing to refuse.
 */
const MIN_SHARED_STEP_CALLS = 24;

/**
 * The highest y percentage the shared step may tap at going down. The tap misses only when the option's top cleared the
 * keyboard by less than this share of the row's height, so the window grows with it.
 */
const MAX_TOP_TAP_PERCENT = 10;

/**
 * Pairs that stay a bare scroll-then-tap on purpose, because the shared step cannot carry the tap. Closed: keyed by
 * flow and text, each entry needs a reason, and an entry that matches no pair fails the suite. Empty: every pair in
 * the tree tapped its TARGET with at most `index: 0`, which the shared step carries.
 */
const BARE_ALLOWED: ReadonlyArray<{ readonly file: string; readonly text: string; readonly reason: string }> = [];

/** One `scrollOpenList` call directly followed by a `tapOn` of its TARGET. */
interface ScrollTapPair {
    readonly file: string;
    readonly text: string;
}

/** One `runFlow` of a named flow, with the env it passes. */
interface FlowCall {
    readonly file: string;
    readonly env: Record<string, unknown>;
}

/** The `runFlow` a command makes of the flow called `name`, if it makes one. Pure. */
function callOf(command: unknown, name: string): Record<string, unknown> | undefined {
    if (!isRecord(command) || !isRecord(command['runFlow'])) {
        return undefined;
    }

    const call = command['runFlow'];

    return typeof call['file'] === 'string' && namesFlow(call['file'], name) ? call : undefined;
}

/**
 * Every scroll-then-tap pair on an open list in one flow. Pure.
 *
 * @param file - The flow's path, for the report.
 * @param source - The flow's YAML.
 * @returns One entry per `scrollOpenList` call whose very next command taps its TARGET.
 */
export function scrollTapPairsIn(file: string, source: string): readonly ScrollTapPair[] {
    return parseFlow(file, source).flatMap((document) =>
        [...commandLists(document)].flatMap((commands) =>
            commands.flatMap((command, index): ScrollTapPair[] => {
                const call = callOf(command, HELPER);
                const next = commands[index + 1];
                const target = call !== undefined && isRecord(call['env']) ? call['env']['TARGET'] : undefined;

                if (typeof target !== 'string' || !isRecord(next) || textOf(next['tapOn']) !== target) {
                    return [];
                }

                return [{ file, text: target }];
            }),
        ),
    );
}

/** Whether the pair is on the closed allowlist. Pure. */
const isAllowed = (pair: ScrollTapPair): boolean =>
    BARE_ALLOWED.some(({ file, text }) => pair.file === file && pair.text === text);

/**
 * The pairs this rule refuses. Pure.
 *
 * @param pairs - Every pair found.
 * @returns One message per unallowlisted pair outside the shared step's own file.
 */
export function refusedPairs(pairs: readonly ScrollTapPair[]): readonly string[] {
    return pairs
        .filter(({ file }) => !namesFlow(file, SHARED_STEP))
        .filter((pair) => !isAllowed(pair))
        .map(
            ({ file, text }) =>
                `${file}: scrolls the open list to ${JSON.stringify(text)} and taps its centre; use runFlow common/${SHARED_STEP}`,
        );
}

/**
 * Every call to the shared step in one flow. Pure.
 *
 * @param file - The flow's path, for the report.
 * @param source - The flow's YAML.
 * @returns One entry per `runFlow` whose file is the shared step.
 */
export function stepCallsIn(file: string, source: string): readonly FlowCall[] {
    return parseFlow(file, source).flatMap((document) =>
        [...commandLists(document)].flatMap((commands) =>
            commands.flatMap((command): FlowCall[] => {
                const call = callOf(command, SHARED_STEP);

                return call === undefined ? [] : [{ file, env: isRecord(call['env']) ? call['env'] : {} }];
            }),
        ),
    );
}

/** Calls that omit a TARGET, or pass a DIRECTION the step does not take (it is optional, as in the helper). Pure. */
export function malformedCalls(calls: readonly FlowCall[]): readonly string[] {
    return calls
        .filter(
            ({ env }) =>
                typeof env['TARGET'] !== 'string' ||
                env['TARGET'] === '' ||
                (env['DIRECTION'] !== undefined && env['DIRECTION'] !== 'UP' && env['DIRECTION'] !== 'DOWN'),
        )
        .map(({ file, env }) => `${file}: ${SHARED_STEP} called with ${JSON.stringify(env)}`);
}

/**
 * How many `swipe` commands sit outside every `repeat`, and how many inside one. Pure.
 *
 * @param value - A parsed flow, or any part of it.
 * @param inLoop - Whether `value` is inside a `repeat` already.
 * @returns The two counts.
 */
export function swipePlacement(value: unknown, inLoop = false): { readonly outside: number; readonly inside: number } {
    const add = (
        a: { readonly outside: number; readonly inside: number },
        b: { readonly outside: number; readonly inside: number },
    ) => ({ outside: a.outside + b.outside, inside: a.inside + b.inside });
    const none = { outside: 0, inside: 0 };

    if (Array.isArray(value)) {
        return value.map((item) => swipePlacement(item, inLoop)).reduce(add, none);
    }

    if (!isRecord(value)) {
        return none;
    }

    return Object.entries(value)
        .map(([key, item]) => {
            if (key === 'swipe') {
                return inLoop ? { outside: 0, inside: 1 } : { outside: 1, inside: 0 };
            }

            return swipePlacement(item, inLoop || key === 'repeat');
        })
        .reduce(add, none);
}

/** The y percentage of a `point: 'x%,y%'`, or undefined for any other form. Pure. */
export function yPercentOf(point: unknown): number | undefined {
    const match = typeof point === 'string' ? /^\s*\d+%\s*,\s*(\d+)%\s*$/.exec(point) : null;

    return match?.[1] === undefined ? undefined : Number(match[1]);
}

const flow = (body: string): string => `appId: x\n---\n${body}`;
const call = (file: string, env: string): string => `- runFlow:\n    file: ${file}\n    env:\n${env}`;
const PAIR = `${call('common/scrollOpenList.yaml', "      TARGET: 'Use .*Tomato.*'\n")}- tapOn:\n    text: 'Use .*Tomato.*'\n`;

describe('the rules themselves', () => {
    it('refuses a pair, whether the tap is a map, a map with index 0, or a bare string', () => {
        expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(PAIR)))).toHaveLength(1);
        expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(`${PAIR}    index: 0\n`)))).toHaveLength(1);

        const bare = PAIR.replace("- tapOn:\n    text: 'Use .*Tomato.*'", "- tapOn: 'Use .*Tomato.*'");

        expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(bare)))).toHaveLength(1);
    });

    it('finds a call by the bare name the flows beside the helper use, and ignores a look-alike name', () => {
        expect(scrollTapPairsIn('a.yaml', flow(PAIR.replace('common/scrollOpenList', 'scrollOpenList')))).toHaveLength(
            1,
        );
        expect(scrollTapPairsIn('a.yaml', flow(PAIR.replace('common/scrollOpenList', 'notscrollOpenList')))).toEqual(
            [],
        );
    });

    it('finds a pair nested inside runFlow commands and a when block', () => {
        const indented = PAIR.split('\n')
            .map((line) => (line === '' ? line : `      ${line}`))
            .join('\n');

        expect(
            refusedPairs(
                scrollTapPairsIn(
                    'a.yaml',
                    flow(`- runFlow:\n    when:\n      platform: iOS\n    commands:\n${indented}`),
                ),
            ),
        ).toHaveLength(1);
    });

    it('ignores a tap on other text, a command other than a tap, and a pair that is only in a comment', () => {
        expect(scrollTapPairsIn('a.yaml', flow(PAIR.replace("text: 'Use", "text: 'Not")))).toEqual([]);
        expect(scrollTapPairsIn('a.yaml', flow(PAIR.replace('- tapOn:', '- assertVisible:')))).toEqual([]);

        const commented = PAIR.split('\n')
            .map((line) => (line === '' ? line : `# ${line}`))
            .join('\n');

        expect(scrollTapPairsIn('a.yaml', flow(`${commented}- tapOn: 'Other'\n`))).toEqual([]);
    });

    it('exempts the shared step’s own file, by name', () => {
        expect(refusedPairs(scrollTapPairsIn(`x/common/${SHARED_STEP}`, flow(PAIR)))).toEqual([]);
        expect(refusedPairs(scrollTapPairsIn(`x/common/not${SHARED_STEP}`, flow(PAIR)))).toHaveLength(1);
    });

    it('finds shared-step calls and refuses one with no TARGET or a DIRECTION the step does not take', () => {
        const calls = (env: string) => stepCallsIn('a.yaml', flow(call(`common/${SHARED_STEP}`, env)));

        expect(calls("      TARGET: 'Save'\n")).toHaveLength(1);
        expect(malformedCalls(calls("      TARGET: 'Save'\n"))).toEqual([]);
        expect(malformedCalls(calls("      TARGET: 'Save'\n      DIRECTION: UP\n"))).toEqual([]);
        expect(malformedCalls(calls("      TARGET: 'Save'\n      DIRECTION: down\n"))).toHaveLength(1);
        expect(malformedCalls(calls('      DIRECTION: UP\n'))).toHaveLength(1);
        expect(stepCallsIn('a.yaml', flow(call(SHARED_STEP, "      TARGET: 'Save'\n")))).toHaveLength(1);
    });

    it('places a swipe outside or inside a repeat, however deeply either nests', () => {
        const outside = parseFlow(
            'a.yaml',
            flow('- runFlow:\n    commands:\n      - swipe:\n          start: 1%, 1%\n'),
        ).at(-1);
        const inside = parseFlow(
            'a.yaml',
            flow(
                '- repeat:\n    times: 2\n    commands:\n      - runFlow:\n          commands:\n            - swipe: {}\n',
            ),
        ).at(-1);

        expect(swipePlacement(outside)).toEqual({ outside: 1, inside: 0 });
        expect(swipePlacement(inside)).toEqual({ outside: 0, inside: 1 });
    });

    it('reads the y percentage of a percent point, and nothing from any other form', () => {
        expect(yPercentOf('50%,5%')).toBe(5);
        expect(yPercentOf('50%, 10%')).toBe(10);
        expect(yPercentOf('100,4')).toBeUndefined();
        expect(yPercentOf(undefined)).toBeUndefined();
    });

    it('fails, rather than skips, a flow that does not parse', () => {
        expect(() => scrollTapPairsIn('broken.yaml', flow("- tapOn: 'Save\n- tapOn: [\n"))).toThrow(
            /broken.yaml does not parse/,
        );
    });
});

describe('every pick from an open list in the Maestro suite goes through the shared step', () => {
    const flows = committedFlowFiles().map((file) => ({ file, source: readFileSync(join(REPO_ROOT, file), 'utf8') }));
    const pairs = flows.flatMap(({ file, source }) => scrollTapPairsIn(file, source));
    const calls = flows.flatMap(({ file, source }) => stepCallsIn(file, source));

    it('parses every flow and finds the helper and the shared step', () => {
        expect(flows.length).toBeGreaterThan(20);
        expect(flows.some(({ file }) => namesFlow(file, HELPER))).toBe(true);
        expect(flows.some(({ file }) => namesFlow(file, SHARED_STEP))).toBe(true);
    });

    it('leaves no scroll of an open list followed by a centre tap on its target', () => {
        expect(refusedPairs(pairs)).toEqual([]);
    });

    it('still calls the shared step at least as often as the suite needed it (non-vacuity)', () => {
        expect(calls.length).toBeGreaterThanOrEqual(MIN_SHARED_STEP_CALLS);
    });

    it('calls the shared step with a TARGET and no DIRECTION, UP or DOWN', () => {
        expect(malformedCalls(calls)).toEqual([]);
    });

    it('keeps every allowlist entry live, so the allowlist cannot grow stale', () => {
        const live = (entry: (typeof BARE_ALLOWED)[number]): boolean =>
            pairs.some((pair) => pair.file === entry.file && pair.text === entry.text);

        expect(BARE_ALLOWED.filter((entry) => !live(entry)).map(({ file, text }) => `${file}: ${text}`)).toEqual([]);
        expect(BARE_ALLOWED.filter(({ reason }) => reason.trim() === '')).toEqual([]);
    });
});

/**
 * The fix itself, held in place: without these, putting the lift back or the tap back at the centre stays green.
 */
describe('the shared step taps near the top, and the helper never moves a found target', () => {
    /** The shared step's commands, read in each test so a missing file fails the tests rather than the collection. */
    const stepCommands = (): unknown => parseFlow(SHARED_STEP, readFileSync(join(COMMON, SHARED_STEP), 'utf8')).at(-1);
    const tapsIn = (value: unknown): readonly Record<string, unknown>[] =>
        [...commandLists(value)].flatMap((commands) =>
            commands.flatMap((command) => (isRecord(command) && isRecord(command['tapOn']) ? [command['tapOn']] : [])),
        );

    it('scrolls with the helper first, passing the TARGET through', () => {
        const steps = stepCommands();
        const [first] = Array.isArray(steps) ? (steps as unknown[]) : [];

        expect(callOf(first, HELPER)?.['env']).toMatchObject({ TARGET: '${TARGET}' });
    });

    it('taps the TARGET’s topmost match in every branch', () => {
        const taps = tapsIn(stepCommands());

        expect(taps.length).toBeGreaterThanOrEqual(2);
        expect(taps.filter((tap) => tap['text'] !== '${TARGET}' || tap['index'] !== 0)).toEqual([]);
    });

    it('taps near the option’s top going down, never at its centre', () => {
        const steps = stepCommands();
        const down = (Array.isArray(steps) ? (steps as unknown[]) : []).find((step) => {
            const run = isRecord(step) ? step['runFlow'] : undefined;

            return isRecord(run) && isRecord(run['when']) && run['when']['true'] === "${DIRECTION != 'UP'}";
        });
        const downTaps = tapsIn(down);
        const y = yPercentOf(downTaps[0]?.['point']);

        expect(downTaps).toHaveLength(1);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThanOrEqual(MAX_TOP_TAP_PERCENT);
    });

    it('swipes only inside the helper’s repeat loops', () => {
        const helper = parseFlow(HELPER, readFileSync(join(COMMON, HELPER), 'utf8')).at(-1);
        const placement = swipePlacement(helper);

        expect(placement.outside).toBe(0);
        expect(placement.inside).toBeGreaterThan(0);
    });
});
