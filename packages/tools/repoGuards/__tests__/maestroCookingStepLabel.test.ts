// @vitest-environment node
/**
 * Repo guard: how the cooking flows read the step and line labels.
 *
 * The labels are the cooking `top.place` and `step.lineOf` copy (messages.ts), and the space after `Step` and `Line` is a
 * no-break space. A flow that
 * asserts it with a plain space matches nothing on a device, and one that types the no-break space hides an invisible
 * character in a file nobody can read it in. These flows are there to show what the cook sees move, not to pin the
 * copy: the component tests and `messages.test.ts` already pin the text. So each flow asserts a label with `.` for the
 * space, and the number stays in the selector, because the number is what the flow proves.
 *
 * The real label is read from messages.ts as text, so a change to the copy cannot leave this guard checking a stale
 * copy of it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const FLOW_DIR = join(REPO_ROOT, 'packages/apps/commise/mobile/.maestro/cooking');
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

/** The quoted text of every `assertVisible` and `tapOn` line of a flow. */
const selectors = (flow: string): string[] =>
    readFileSync(join(FLOW_DIR, flow), 'utf8')
        .split('\n')
        .flatMap((line) => {
            const match = /^\s*-\s*(?:assertVisible|assertNotVisible|tapOn):\s*'(.*)'\s*$/u.exec(line);

            return match?.[1] === undefined ? [] : [match[1]];
        });

/** Maestro matches the whole text of an element against the selector as a regex. */
const matchesWholeText = (selector: string, text: string): boolean => new RegExp(`^(?:${selector})$`, 'u').test(text);

describe.each(Object.entries(LABELS))('the %s label this guard reads from messages.ts', (kind, label) => {
    it('is a template with both slots and a no-break space after the word', () => {
        expect(label).toContain('{current}');
        expect(label).toContain('{total}');
        expect(label.startsWith(`${kind}\u00a0`)).toBe(true);
    });
});

describe.each([
    {
        flow: 'cookingIngredients.yaml',
        labels: [real('Step', 1, 3), real('Step', 1, 3)],
    },
    {
        flow: 'cookingModeFlow.yaml',
        labels: [
            real('Line', 1, 2),
            real('Line', 2, 2),
            real('Step', 2, 3),
            real('Step', 2, 3),
            real('Step', 1, 3),
            real('Line', 2, 2),
            real('Step', 2, 3),
            real('Step', 3, 3),
            real('Line', 1, 1),
        ],
    },
])('$flow reads the step and line labels', ({ flow, labels }) => {
    it('never with the space typed out, plain or no-break: the copy is cooking top.place and step.lineOf', () => {
        const typed = selectors(flow).filter((selector) => /\b(?:Step|Line)[ \u00a0]\d+ of \d+/u.test(selector));

        expect(typed).toEqual([]);
    });

    it('with a selector that matches the real label at each point the flow checks it, in order', () => {
        const labelled = selectors(flow).filter((selector) => /^(?:Step|Line)/u.test(selector));

        expect(labelled.map((selector, at) => matchesWholeText(selector, labels[at] ?? ''))).toEqual(
            labels.map(() => true),
        );
    });
});
