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

import { FLOW_ROOT, REPO_ROOT, isRecord, parseFlow } from './maestroFlowYaml.js';

const FLOW_DIR = join(REPO_ROOT, FLOW_ROOT, 'cooking');
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
const labelSelectors = (flow: string): string[] =>
    parseFlow(flow, readFileSync(join(FLOW_DIR, flow), 'utf8'))
        .flatMap((document) => [...texts(document)])
        .filter((text) => /^(?:Step|Line)[ .\u00a0]\d+ of \d+$/u.test(text));

/** Maestro matches the whole text of an element against the selector as a regex. */
const matchesWholeText = (selector: string, text: string): boolean => new RegExp(`^(?:${selector})$`, 'u').test(text);

describe.each(Object.entries(LABELS))('the %s label this guard reads from messages.ts', (kind, label) => {
    it('is a template with both slots, led by its word', () => {
        expect(label).toContain('{current}');
        expect(label).toContain('{total}');
        expect(label.startsWith(kind)).toBe(true);
    });
});

describe.each([
    { flow: 'cookingIngredients.yaml', count: 2 },
    { flow: 'cookingModeFlow.yaml', count: 9 },
])('$flow reads the step and line labels', ({ flow, count }) => {
    it('never with the space typed out, plain or no-break: the copy is cooking top.place and step.lineOf', () => {
        const typed = labelSelectors(flow).filter((selector) => /^(?:Step|Line)[ \u00a0]/u.test(selector));

        expect(typed).toEqual([]);
    });

    it('with a selector that matches the real label, at each of the points the flow checks one', () => {
        const labels = labelSelectors(flow);
        const matches = labels.map((selector) => {
            const parts = /^(Step|Line)\.(\d+) of (\d+)$/u.exec(selector);
            const kind = parts?.[1] === 'Step' || parts?.[1] === 'Line' ? parts[1] : undefined;

            return kind !== undefined && matchesWholeText(selector, real(kind, Number(parts?.[2]), Number(parts?.[3])));
        });

        expect(labels).toHaveLength(count);
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
