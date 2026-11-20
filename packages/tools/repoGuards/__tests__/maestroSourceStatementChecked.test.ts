/**
 * EVERY ANSWER TAP IN `recipes/sourceStatement.yaml` IS PROVED BY THE RADIO'S OWN STATE.
 *
 * A tap on an answer clipped above the visible list (y < 0) reads as "scroll to top" on iOS and checks nothing, and the flow
 * went on to a later step that failed far from the cause. So each `tapOn` of an answer must be followed, before any other
 * tap, by an assertion that the SAME answer is `checked: true`.
 *
 * Parsed as YAML, never grepped, so a comment or a change of quoting cannot hide a tap.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLOW_ROOT, REPO_ROOT, isRecord, parseFlow, textOf } from './maestroFlowYaml.js';

const FLOW = join(REPO_ROOT, FLOW_ROOT, 'recipes', 'sourceStatement.yaml');

/** The sheet's answers, as the cook reads them (`recipeActionMessages` `sourceStatement`). */
const ANSWERS: readonly string[] = [
    'I wrote this',
    'From a web page',
    'From a cookbook or magazine',
    'From another person',
    'Publish privately',
];

/** The flow's commands, in order (the second YAML document, after the header). */
function commands(): readonly unknown[] {
    const body = parseFlow(FLOW, readFileSync(FLOW, 'utf8')).at(-1);

    return Array.isArray(body) ? body : [];
}

/** The answer a command taps, if it taps one. */
function answerTapped(command: unknown): string | undefined {
    if (!isRecord(command) || !('tapOn' in command)) {
        return undefined;
    }

    const text = textOf(command['tapOn']);

    return text !== undefined && ANSWERS.includes(text) ? text : undefined;
}

/** The commands a `runFlow` runs on `platform`, or none. */
function branchOn(command: unknown, platform: 'Android' | 'iOS'): readonly unknown[] {
    const run = isRecord(command) ? command['runFlow'] : undefined;
    const when = isRecord(run) ? run['when'] : undefined;

    return isRecord(run) && isRecord(when) && when['platform'] === platform && Array.isArray(run['commands'])
        ? run['commands']
        : [];
}

/** The `assertVisible` selectors in a command list. */
const assertions = (list: readonly unknown[]): readonly Record<string, unknown>[] =>
    list.flatMap((command) => {
        const asserted = isRecord(command) ? command['assertVisible'] : undefined;

        return isRecord(asserted) ? [asserted] : [];
    });

/** Android reads `checked` from the radio itself. */
const provesOnAndroid = (command: unknown, text: string): boolean =>
    assertions(branchOn(command, 'Android')).some((a) => a['text'] === text && a['checked'] === true);

/** iOS holds the state only in the radio's value, so the checked radio is placed by a row beside it. */
const provesOnIos = (command: unknown): boolean =>
    assertions(branchOn(command, 'iOS')).some(
        (a) => a['text'] === 'radio button, checked' && ('above' in a || 'below' in a),
    );

describe('sourceStatement.yaml proves each answer tap by the radio state', () => {
    const list = commands();
    const taps = list.flatMap((command, at) => {
        const answer = answerTapped(command);

        return answer === undefined ? [] : [{ answer, at }];
    });

    it('taps at least the book, person and authored answers', () => {
        expect(taps.map((tap) => tap.answer)).toEqual(
            expect.arrayContaining(['From a cookbook or magazine', 'From another person', 'I wrote this']),
        );
    });

    it.each(taps)('the tap on "$answer" is followed by its checked proof on Android', ({ answer, at }) => {
        expect(provesOnAndroid(list[at + 1], answer)).toBe(true);
    });

    it.each(taps)('the tap on "$answer" is followed by its checked proof on iOS', ({ at }) => {
        expect(provesOnIos(list[at + 2])).toBe(true);
    });
});
