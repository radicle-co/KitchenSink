import { fillTemplate, pluralOf, resolveMessages } from '@commise/i18n';
import { describe, expect, it } from 'vitest';

import { navOf } from '../cookingCopy.js';
import { cookingMessages } from '../messages.js';

const en = resolveMessages(cookingMessages, 'en');

describe('the cooking copy through the house helpers', () => {
    it('fills the design’s own strings', () => {
        expect(fillTemplate(en.done.title, { total: 6 })).toBe('All 6 steps done');
        expect(fillTemplate(en.next.upNext, { n: 3 })).toBe('Up next · step 3');
    });

    it('says the ticked summary as one line or a count, through the shared plural rule', () => {
        expect(pluralOf(en.step.tickedSummary, 1, 'en')).toBe('You ticked 1 line');
        expect(pluralOf(en.step.tickedSummary, 2, 'en')).toBe('You ticked 2 lines');
        expect(pluralOf(en.step.tickedSummary, 0, 'en')).toBe('You ticked 0 lines');
        expect(pluralOf(en.step.tickedSummary, 12, 'en')).toBe('You ticked 12 lines');
    });
});

describe('navOf — the Back and Next pair', () => {
    const nav = (stepIndex: number, totalSteps: number, everyLineTicked: boolean) =>
        navOf({
            stepIndex,
            steps: Array.from({ length: totalSteps }, (_, i) => ({ stepNumber: i + 1, lines: ['A line.'] })),
            everyLineTicked,
            copy: en.nav,
        });

    it('names Back for the recipe on step 1, and for the step it goes to otherwise', () => {
        expect(nav(0, 6, false).back).toEqual({ label: 'Back', a11yName: 'Back to the recipe' });
        expect(nav(1, 6, false).back).toEqual({ label: 'Back', a11yName: 'Back to step 1' });
        expect(nav(4, 6, false).back).toEqual({ label: 'Back', a11yName: 'Back to step 4' });
    });

    it('offers a quiet Next step while lines are unticked, naming the step it opens', () => {
        expect(nav(1, 6, false).forward).toEqual({
            kind: 'next',
            label: 'Next step',
            a11yName: 'Next step, step 3',
            filled: false,
        });
    });

    it('replaces Next with a filled Start step n once every line is ticked', () => {
        expect(nav(1, 6, true).forward).toEqual({
            kind: 'startStep',
            label: 'Start step 3',
            a11yName: 'Start step 3',
            filled: true,
        });
    });

    it('is Finish on the last step: quiet until every line is ticked, then filled', () => {
        expect(nav(5, 6, false).forward).toEqual({
            kind: 'finish',
            label: 'Finish',
            a11yName: 'Finish',
            filled: false,
        });
        expect(nav(5, 6, true).forward).toEqual({ kind: 'finish', label: 'Finish', a11yName: 'Finish', filled: true });
    });

    it('is Finish on a one-step recipe, where step 1 is also the last', () => {
        expect(nav(0, 1, false).forward.kind).toBe('finish');
        expect(nav(0, 1, false).back.a11yName).toBe('Back to the recipe');
    });
});
