/**
 * A BARE `scrollUntilVISIBLE` FOLLOWED BY A TAP ON THE SAME ELEMENT TAPS WHATEVER COVERS IT ON iOS.
 *
 * `scrollUntilVisible` stops the moment the element counts as visible, which is when it has just come in at the screen's
 * edge. iOS (XCUITest) counts an element visible while the sticky editor header, the pinned action bar or the tab bar
 * covers it, so the `tapOn` that follows lands on the covering control (ingredientGroups, full local iOS shard 1,
 * 2026-10-18: a row's ⋯ was under the header's ⋯ and the header's menu opened). Android drops what an overlay covers, so
 * it never shows.
 *
 * Maestro's `centerElement: true` would fix the middle of a page, but it keeps swiping until the element is near the
 * centre or the timeout ends and never notices the end of a page (`Orchestra.scrollUntilVisible`, read from
 * maestro-orchestra's bytecode), so a blanket `centerElement` fails at a page's end. The fix is ONE shared step,
 * `common/scrollIntoTapView.yaml`: a required scroll, then an OPTIONAL short centring pass.
 *
 * The rule, over every committed flow, parsed as YAML (not grepped, so comments and quoting cannot hide a pair): a
 * `scrollUntilVisible` immediately followed, in the same command list, by a `tapOn` of the same text is refused unless
 * the scroll has `centerElement: true`.
 *
 * Exempt by rule: the shared step's own file, and LEFT/RIGHT scrolls. A horizontal rail is covered by neither the
 * sticky header nor the bars, which sit above and below the page, never beside it.
 *
 * A flow that does not parse FAILS this suite. Prettier ignores `.maestro`, so this is the only syntax check a scripted
 * edit of the flows gets before Maestro loads them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';

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

const SHARED_STEP = 'common/scrollIntoTapView.yaml';
const SHARED_STEP_NAME = 'scrollIntoTapView.yaml';

/** Whether a path names the shared step, by file name (`namesFlow`). Pure. */
const isSharedStep = (path: string): boolean => namesFlow(path, SHARED_STEP_NAME);

/**
 * How many bare pairs the suite held when the shared step was introduced (136 found, 6 already centred). The floor
 * keeps the scan honest: a parser change that stopped seeing pairs would otherwise pass with nothing to refuse.
 */
const MIN_SHARED_STEP_CALLS = 125;

/**
 * Pairs that stay bare on purpose, because the shared step cannot carry them. Closed: keyed by flow and element text,
 * each entry needs a reason, and an entry that matches no pair fails the suite. Empty now: the last entry,
 * `landscape.yaml`'s slow scroll to "Add an ingredient", is followed by a centring pass since the iOS run of 2026-10-19.
 */
const BARE_ALLOWED: ReadonlyArray<{ readonly file: string; readonly text: string; readonly reason: string }> = [];

/** One `scrollUntilVisible` followed, past any further scrolls, by a `tapOn` of the same text. */
interface ScrollTapPair {
    readonly file: string;
    readonly text: string;
    readonly direction: string;
    readonly centered: boolean;
}

/**
 * Every scroll-then-tap pair in one flow, vertical or not. Pure.
 *
 * @param file - The flow's path, for the report.
 * @param source - The flow's YAML.
 * @returns One entry per `scrollUntilVisible` whose next command past any further scrolls taps the same text.
 */
export function scrollTapPairsIn(file: string, source: string): readonly ScrollTapPair[] {
    return parseFlow(file, source).flatMap((document) =>
        [...commandLists(document)].flatMap((commands) =>
            commands.flatMap((command, index): ScrollTapPair[] => {
                if (!isRecord(command) || !isRecord(command['scrollUntilVisible'])) {
                    return [];
                }

                // The scrolls straight after this one, then the first command that is not a scroll. A second scroll (to a
                // hint under a label, say) moves nothing when its own target is already "visible", so a tap after the
                // run still taps what THIS scroll stopped on.
                const run = commands.slice(index + 1);
                const after = run.findIndex((each) => !isRecord(each) || !isRecord(each['scrollUntilVisible']));
                const next = after === -1 ? undefined : run[after];
                const scroll = command['scrollUntilVisible'];
                const scrolled = textOf(scroll['element']);

                if (!isRecord(next) || scrolled === undefined || scrolled !== textOf(next['tapOn'])) {
                    return [];
                }

                const direction = typeof scroll['direction'] === 'string' ? scroll['direction'].toUpperCase() : 'DOWN';
                const centered = [command, ...run.slice(0, after)].some(
                    (each) =>
                        isRecord(each) &&
                        isRecord(each['scrollUntilVisible']) &&
                        textOf(each['scrollUntilVisible']['element']) === scrolled &&
                        each['scrollUntilVisible']['centerElement'] === true,
                );

                return [{ file, text: scrolled, direction, centered }];
            }),
        ),
    );
}

/** Whether a direction is horizontal: a rail, which neither sticky chrome nor the bars cover. Pure. */
const isHorizontal = (direction: string): boolean => direction === 'LEFT' || direction === 'RIGHT';

/** Whether the pair is on the closed allowlist. Pure. */
const isAllowed = (pair: ScrollTapPair): boolean =>
    BARE_ALLOWED.some(({ file, text }) => pair.file === file && pair.text === text);

/**
 * The pairs this rule refuses. Pure.
 *
 * @param pairs - Every pair found.
 * @returns One message per vertical, uncentred, unallowlisted pair, outside the shared step's own file.
 */
export function refusedPairs(pairs: readonly ScrollTapPair[]): readonly string[] {
    return pairs
        .filter(({ file }) => !isSharedStep(file))
        .filter((pair) => !pair.centered && !isHorizontal(pair.direction) && !isAllowed(pair))
        .map(
            ({ file, text, direction }) =>
                `${file}: scrolls ${direction} to ${JSON.stringify(text)} and taps it bare; use runFlow ${SHARED_STEP}`,
        );
}

/** One call to the shared step, with the env it passes. */
interface StepCall {
    readonly file: string;
    readonly env: Record<string, unknown>;
}

/**
 * Every call to the shared step in one flow. Pure.
 *
 * @param file - The flow's path, for the report.
 * @param source - The flow's YAML.
 * @returns One entry per `runFlow` whose file is the shared step.
 */
export function stepCallsIn(file: string, source: string): readonly StepCall[] {
    return parseFlow(file, source).flatMap((document) =>
        [...commandLists(document)].flatMap((commands) =>
            commands.flatMap((command): StepCall[] => {
                if (!isRecord(command) || !isRecord(command['runFlow'])) {
                    return [];
                }

                const call = command['runFlow'];
                const target = call['file'];

                return typeof target === 'string' && isSharedStep(target)
                    ? [{ file, env: isRecord(call['env']) ? call['env'] : {} }]
                    : [];
            }),
        ),
    );
}

/** Calls that omit a TARGET, or pass a DIRECTION the step does not take. Pure. */
export function malformedCalls(calls: readonly StepCall[]): readonly string[] {
    return calls
        .filter(
            ({ env }) =>
                typeof env['TARGET'] !== 'string' ||
                env['TARGET'] === '' ||
                (env['DIRECTION'] !== 'UP' && env['DIRECTION'] !== 'DOWN'),
        )
        .map(({ file, env }) => `${file}: ${SHARED_STEP} called with ${JSON.stringify(env)}`);
}

const flow = (body: string): string => `appId: x\n---\n${body}`;
const PAIR = "- scrollUntilVisible:\n    element: 'Save'\n    direction: DOWN\n- tapOn: 'Save'\n";

describe('the rules themselves', () => {
    it('refuses a bare pair', () => {
        expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(PAIR)))).toHaveLength(1);
    });

    it('finds a pair nested inside runFlow commands, a repeat and a when block', () => {
        const nested = flow(
            `- runFlow:\n    when:\n      platform: iOS\n    commands:\n      - repeat:\n          times: 2\n          commands:\n            - scrollUntilVisible:\n                element: 'Save'\n                direction: UP\n            - tapOn: 'Save'\n`,
        );

        expect(refusedPairs(scrollTapPairsIn('a.yaml', nested))).toHaveLength(1);
    });

    it('reads dict selectors on both sides, and a direction left at its DOWN default', () => {
        const dict = flow(
            "- scrollUntilVisible:\n    element:\n      text: 'Save'\n- tapOn:\n    text: 'Save'\n    index: 1\n",
        );
        const [pair] = scrollTapPairsIn('a.yaml', dict);

        expect(pair).toMatchObject({ text: 'Save', direction: 'DOWN', centered: false });
        expect(refusedPairs([pair as ScrollTapPair])).toHaveLength(1);
    });

    it('finds a pair across a run of scrolls: the tap after the LAST scroll still taps what the first one stopped on', () => {
        // Local iOS run, 2026-10-20, `addIngredientLine`: a scroll to the field's label, then one to its hint, then a tap
        // on the label. Both scrolls stopped with the label under the pinned action bar, and the tap missed the field.
        const run = flow(
            "- scrollUntilVisible:\n    element: 'Add'\n    direction: DOWN\n- scrollUntilVisible:\n    element: 'Hint'\n    direction: DOWN\n- tapOn: 'Add'\n",
        );

        expect(refusedPairs(scrollTapPairsIn('a.yaml', run))).toHaveLength(1);
    });

    it('accepts a run of scrolls when a scroll to the tapped text centres it', () => {
        const run = flow(
            "- scrollUntilVisible:\n    element: 'Add'\n    direction: DOWN\n- scrollUntilVisible:\n    element: 'Add'\n    direction: DOWN\n    centerElement: true\n- tapOn: 'Add'\n",
        );

        expect(refusedPairs(scrollTapPairsIn('a.yaml', run))).toEqual([]);
    });

    it('ignores a pair that is only in a comment', () => {
        const commented = flow("# - scrollUntilVisible:\n#     element: 'Save'\n# - tapOn: 'Save'\n- tapOn: 'Other'\n");

        expect(scrollTapPairsIn('a.yaml', commented)).toEqual([]);
    });

    it('ignores a scroll followed by a tap on a different element, or by something else', () => {
        expect(scrollTapPairsIn('a.yaml', flow(PAIR.replace("- tapOn: 'Save'", "- tapOn: 'Cancel'")))).toEqual([]);
        expect(scrollTapPairsIn('a.yaml', flow(PAIR.replace("- tapOn: 'Save'", "- assertVisible: 'Save'")))).toEqual(
            [],
        );
    });

    it('accepts a centred pair', () => {
        const centred = PAIR.replace('direction: DOWN', 'direction: DOWN\n    centerElement: true');

        expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(centred)))).toEqual([]);
    });

    it('does not accept centerElement: false as centred', () => {
        const off = PAIR.replace('direction: DOWN', 'direction: DOWN\n    centerElement: false');

        expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(off)))).toHaveLength(1);
    });

    it('exempts horizontal rails, in either direction', () => {
        for (const direction of ['LEFT', 'RIGHT']) {
            expect(refusedPairs(scrollTapPairsIn('a.yaml', flow(PAIR.replace('DOWN', direction))))).toEqual([]);
        }
    });

    it('exempts the shared step’s own file', () => {
        expect(refusedPairs(scrollTapPairsIn(`x/${SHARED_STEP}`, flow(PAIR)))).toEqual([]);
    });

    it('finds a call written beside the step, by its bare file name, and ignores a look-alike name', () => {
        const call = (file: string): string =>
            flow(`- runFlow:\n    file: ${file}\n    env:\n      TARGET: 'Save'\n      DIRECTION: UP\n`);

        expect(stepCallsIn('a.yaml', call('scrollIntoTapView.yaml'))).toHaveLength(1);
        expect(stepCallsIn('a.yaml', call('../recipes/common/scrollIntoTapView.yaml'))).toHaveLength(1);
        expect(stepCallsIn('a.yaml', call('notscrollIntoTapView.yaml'))).toEqual([]);
    });

    it('fails, rather than skips, a flow that does not parse', () => {
        expect(() => scrollTapPairsIn('broken.yaml', flow("- tapOn: 'Save\n- tapOn: [\n"))).toThrow(
            /broken.yaml does not parse/,
        );
    });

    it('finds shared-step calls and refuses one with no TARGET or a bad DIRECTION', () => {
        const call = (env: string): string => flow(`- runFlow:\n    file: ../${SHARED_STEP}\n    env:\n${env}`);
        const good = stepCallsIn('a.yaml', call("      TARGET: 'Save'\n      DIRECTION: UP\n"));
        const bad = stepCallsIn('a.yaml', call("      TARGET: 'Save'\n      DIRECTION: LEFT\n"));
        const none = stepCallsIn('a.yaml', call('      DIRECTION: UP\n'));

        expect(good).toHaveLength(1);
        expect(malformedCalls(good)).toEqual([]);
        expect(malformedCalls(bad)).toHaveLength(1);
        expect(malformedCalls(none)).toHaveLength(1);
    });
});

describe('every scroll-then-tap in the Maestro suite is centred', () => {
    const flows = committedFlowFiles().map((file) => ({ file, source: readFileSync(join(REPO_ROOT, file), 'utf8') }));
    const pairs = flows.flatMap(({ file, source }) => scrollTapPairsIn(file, source));
    const calls = flows.flatMap(({ file, source }) => stepCallsIn(file, source));

    it('parses every flow and finds the shared step', () => {
        expect(flows.length).toBeGreaterThan(20);
        expect(flows.some(({ file }) => isSharedStep(file))).toBe(true);
    });

    it('leaves no bare scroll-then-tap on the same element', () => {
        expect(refusedPairs(pairs)).toEqual([]);
    });

    it('still calls the shared step at least as often as the suite needed it (non-vacuity)', () => {
        expect(calls.length).toBeGreaterThanOrEqual(MIN_SHARED_STEP_CALLS);
    });

    it('calls the shared step with a TARGET and an UP or DOWN DIRECTION', () => {
        expect(malformedCalls(calls)).toEqual([]);
    });

    it('keeps every allowlist entry live, so the allowlist cannot grow stale', () => {
        const live = (entry: (typeof BARE_ALLOWED)[number]): boolean =>
            pairs.some((pair) => pair.file === entry.file && pair.text === entry.text && !pair.centered);

        expect(BARE_ALLOWED.filter((entry) => !live(entry)).map(({ file, text }) => `${file}: ${text}`)).toEqual([]);
        expect(BARE_ALLOWED.filter(({ reason }) => reason.trim() === '')).toEqual([]);
    });
});

/**
 * The shared step scrolls ONLY when its target is not on screen yet. A target that arrives from off screen comes in at
 * the edge it was scrolled toward, so the centring pass (in the same direction) moves it toward the middle. A target
 * already on screen may sit on the FAR side of the middle, and the same pass then pushes it away: on iOS, with the
 * add-ingredient field still focused, it pushed the row under the keyboard, and the tap typed a letter instead
 * (full local iOS shard 1, 2026-10-18: ingredientGroups typed "P", ingredientRowEditor typed "F"). Leaving an
 * on-screen target where it is is what the bare `scrollUntilVisible` did, which passed there.
 */
describe('the shared step leaves an on-screen target where it is', () => {
    const source = readFileSync(join(REPO_ROOT, FLOW_ROOT, 'recipes', SHARED_STEP), 'utf8');
    const steps = parseAllDocuments(source).at(-1)?.toJS() as unknown;
    const blocks = (Array.isArray(steps) ? steps : []).flatMap((step: unknown) => {
        const run = isRecord(step) ? step['runFlow'] : undefined;

        return isRecord(run) && Array.isArray(run['commands']) ? [run] : [];
    });

    it('has one scroll block per direction', () => {
        expect(blocks).toHaveLength(2);
    });

    it('gates every scroll block on the target NOT being visible yet', () => {
        const ungated = blocks.filter((block) => {
            const when = isRecord(block['when']) ? block['when'] : {};
            const notVisible = when['notVisible'];
            const target = isRecord(notVisible) ? notVisible['text'] : notVisible;

            return target !== '${TARGET}';
        });

        expect(ungated).toEqual([]);
    });
});
