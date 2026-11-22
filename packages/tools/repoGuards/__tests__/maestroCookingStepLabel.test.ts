// @vitest-environment node
/**
 * Repo guard: how the cooking flows read the step and line labels.
 *
 * The labels are the cooking `top.place` and `step.lineOf` copy (messages.ts), and the space after `Step` and `Line` is
 * a no-break space. A flow that asserts it with a plain space matches nothing on a device, and one that types the
 * no-break space hides an invisible character in a file nobody can read it in. These flows are there to show what the
 * cook sees move, not to pin the copy: the component tests and `messages.test.ts` already pin the text. So each flow
 * asserts a label with `.` for the space, and the number stays in the selector, because the number is what the flow
 * proves.
 *
 * The real label is read from messages.ts as text, so a change to the copy cannot leave this guard checking a stale
 * copy of it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLOW_ROOT, REPO_ROOT, committedFlowFiles, isRecord, parseFlow } from './maestroFlowYaml.js';

const MESSAGES = join(REPO_ROOT, 'packages/apps/commise/features/cooking/src/messages.ts');

/** The English `<group>.<key>` template of messages.ts, with its `\\uXXXX` escapes turned into characters. */
function template(group: string, key: string): string {
    const text = readFileSync(MESSAGES, 'utf8');
    const english = text.slice(text.search(/\ben:\s*\{/u));
    const found = new RegExp(`\\b${group}:\\s*\\{[^}]*?\\b${key}:\\s*'([^']*)'`, 'u').exec(english);

    if (found?.[1] === undefined) {
        throw new Error(
            `no en ${group}.${key} copy found in ${MESSAGES}: the guard would check nothing, so fix its reader`,
        );
    }

    return found[1].replace(/\\u([0-9a-f]{4})/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

const LABELS = { Step: template('top', 'place'), Line: template('step', 'lineOf') } as const;

type Kind = keyof typeof LABELS;

/** What the device shows for `kind` at `current` of `total`. */
const real = (kind: Kind, current: number, total: number): string =>
    LABELS[kind].replace('{current}', String(current)).replace('{total}', String(total));

/** Every text in a parsed flow, whatever command or selector form holds it. Pure. */
function* texts(value: unknown): Generator<string> {
    if (typeof value === 'string') {
        yield value;
    } else if (Array.isArray(value)) {
        for (const item of value) {
            yield* texts(item);
        }
    } else if (isRecord(value)) {
        for (const item of Object.values(value)) {
            yield* texts(item);
        }
    }
}

/** The step and line labels a flow names, in file order, however its selector is written. */
const labelSelectors = (file: string): string[] =>
    parseFlow(file, readFileSync(join(REPO_ROOT, file), 'utf8'))
        .flatMap((document) => [...texts(document)])
        .filter((text) => /^(?:Step|Line)[ .\u00a0]\d+ of \d+$/u.test(text));

/**
 * What each flow that names a step or line label must see on the device, in file order: kind, current, total. This is
 * the oracle the selectors are held to, so a selector with a wrong number turns the guard red, and a deleted assert
 * turns it red too.
 */
const EXPECTED: Readonly<Record<string, readonly (readonly [Kind, number, number])[]>> = {
    'cooking/common/openCookingRecipe.yaml': [['Step', 1, 3]],
    'cooking/cookingIngredients.yaml': [
        ['Step', 1, 3],
        ['Step', 1, 3],
    ],
    'cooking/cookingModeFlow.yaml': [
        ['Line', 1, 2],
        ['Line', 2, 2],
        ['Step', 2, 3],
        ['Step', 2, 3],
        ['Step', 1, 3],
        ['Line', 2, 2],
        ['Step', 2, 3],
        ['Step', 3, 3],
        ['Line', 1, 1],
    ],
    'cooking/cookingSystemBack.yaml': [
        ['Step', 2, 3],
        ['Step', 1, 3],
    ],
};

const FLOWS = committedFlowFiles();
const relative = (file: string): string => file.slice(`${FLOW_ROOT}/`.length);

/** Maestro matches the whole text of an element against the selector as a regex. */
const matchesWholeText = (selector: string, text: string): boolean => new RegExp(`^(?:${selector})$`, 'u').test(text);

describe.each(Object.entries(LABELS))('the %s label this guard reads from messages.ts', (kind, label) => {
    it('is a template with both slots, led by its word', () => {
        expect(label).toContain('{current}');
        expect(label).toContain('{total}');
        expect(label.startsWith(kind)).toBe(true);
    });
});

describe('every committed flow reads the step and line labels', () => {
    it('never with the space typed out, plain or no-break: the copy is cooking top.place and step.lineOf', () => {
        const typed = FLOWS.flatMap((file) =>
            labelSelectors(file)
                .filter((selector) => /^(?:Step|Line)[ \u00a0]/u.test(selector))
                .map((selector) => `${relative(file)}: ${selector}`),
        );

        expect(typed).toEqual([]);
    });

    it('and the flows that name a label are the ones this guard counts', () => {
        const labelled = FLOWS.filter((file) => labelSelectors(file).length > 0).map(relative);

        expect(labelled.toSorted((a, b) => a.localeCompare(b))).toEqual(
            Object.keys(EXPECTED).toSorted((a, b) => a.localeCompare(b)),
        );
    });
});

describe.each(Object.entries(EXPECTED))('%s', (flow, expected) => {
    it('asserts each label it names with a selector that matches what the device shows, in order', () => {
        const labels = labelSelectors(`${FLOW_ROOT}/${flow}`);
        const matches = labels.map((selector, at) => {
            const point = expected[at];

            return point !== undefined && matchesWholeText(selector, real(...point));
        });

        expect(labels).toHaveLength(expected.length);
        expect(matches).toEqual(labels.map(() => true));
    });
});

describe('the label reader sees every selector form', () => {
    it('finds a bare selector, a text selector and a visible condition, whatever the quoting', () => {
        const flow = [
            "- assertVisible: 'Step.1 of 3'",
            '- tapOn:',
            '    text: "Line.2 of 2"',
            '- runFlow:',
            '    when:',
            "      visible: 'Step 2 of 3'",
        ].join('\n');
        const found = parseFlow('inline', flow).flatMap((document) => [...texts(document)]);

        expect(found).toEqual(['Step.1 of 3', 'Line.2 of 2', 'Step 2 of 3']);
    });
});
