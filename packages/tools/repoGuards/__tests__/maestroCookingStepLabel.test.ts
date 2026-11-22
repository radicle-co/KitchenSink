// @vitest-environment node
/**
 * Repo guard: how the cooking flows read the step label.
 *
 * The label is the cooking `top.place` copy (`Step\u00a0{current} of {total}`, messages.ts), with a no-break space after
 * `Step`. A flow that asserts it with a plain space matches nothing on a device, and one that types the no-break space
 * hides an invisible character in a file nobody can read it in. These flows are there to show what the cook sees move,
 * not to pin the copy: the component tests and `messages.test.ts` already pin the text. So each flow asserts the label
 * with `.` for the space, and the number stays in the selector, because the number is what the flow proves.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const FLOW_DIR = join(REPO_ROOT, 'packages/apps/commise/mobile/.maestro/cooking');
const REAL_LABEL = (current: number, total: number): string => `Step\u00a0${current} of ${total}`;

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

describe.each([
    { flow: 'cookingIngredients.yaml', labels: [REAL_LABEL(1, 3), REAL_LABEL(1, 3)] },
    {
        flow: 'cookingModeFlow.yaml',
        labels: [REAL_LABEL(2, 3), REAL_LABEL(2, 3), REAL_LABEL(1, 3), REAL_LABEL(2, 3), REAL_LABEL(3, 3)],
    },
])('$flow reads the step label', ({ flow, labels }) => {
    it('never with the space typed out, plain or no-break: the copy is cooking top.place (messages.ts)', () => {
        const typed = selectors(flow).filter((selector) => /\bStep[ \u00a0]\d+ of \d+/u.test(selector));

        expect(typed).toEqual([]);
    });

    it('with a selector that matches the real label at each point the flow checks it, in order', () => {
        const stepSelectors = selectors(flow).filter((selector) => selector.startsWith('Step'));

        expect(stepSelectors.map((selector, at) => matchesWholeText(selector, labels[at] ?? ''))).toEqual(
            labels.map(() => true),
        );
    });
});
