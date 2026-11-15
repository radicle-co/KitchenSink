import { resolveMessages } from '@commise/i18n';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cookingStepViewOf } from '../cookingStepView.js';
import { cookingMessages } from '../messages.js';
import { useCookingSession } from '../useCookingSession.js';

afterEach(cleanup);

/**
 * The step's view model, the one copy both platforms' screens call. Every case runs over the REAL session hook and its
 * cooking-core reducers, and the real `en` copy: only the function under test is new. Step 1 has three lines, step 2 has
 * two, and step 3 has one, so one-line, several-line and last-step cases each have a step.
 *
 * What comes after the step is ONE of two things: the one-line `preview` for the pinned foot while a line
 * is unticked, or the whole Up next block, `step.upNext`, for the body once every line is ticked. The last step has neither.
 */
const en = resolveMessages(cookingMessages, 'en');

const STEPS = [
    { stepNumber: 1, instruction: 'Heat the oil. Add the onion. Stir well.' },
    { stepNumber: 2, instruction: 'Add the stock. Simmer for 20 min.' },
    { stepNumber: 3, instruction: 'Serve it hot.' },
];

const mount = () => renderHook(() => useCookingSession({ recipeId: 'rec_1', steps: STEPS }));

type Session = ReturnType<typeof mount>['result'];

const viewOf = (session: Session, expanded = false, onToggleShow = vi.fn()) =>
    cookingStepViewOf({ session: session.current, copy: en, locale: 'en', label: 'Step n', expanded, onToggleShow });

const texts = (lines: readonly { readonly text: string }[] | undefined) => lines?.map(({ text }) => text);

describe('cookingStepViewOf — a step of several lines', () => {
    it('opens on line 1 of 3: the focus, the lines after it, nothing ticked, and the next step previewed for the foot', () => {
        const { result } = mount();

        const { step, preview } = viewOf(result);

        expect(step.label).toBe('Step n');
        expect(step.track).toEqual({ total: 3, position: 1 });
        expect(step.lineOf).toBe('Line\u00a01 of 3');
        expect(step.focus).toMatchObject({ key: '0', text: 'Heat the oil.', checked: false });
        expect(texts(step.then)).toEqual(['Add the onion.', 'Stir well.']);
        expect(step.ticked).toBeUndefined();
        expect(step.upNext).toBeUndefined();
        expect(preview).toEqual({ overline: 'Next · step\u00a02', line: 'Add the stock.' });
    });

    it('moves the focus past a ticked line and records it behind the summary, collapsed', () => {
        const { result } = mount();
        act(() => result.current.tick(0));

        const { step, preview } = viewOf(result);

        expect(step.lineOf).toBe('Line\u00a02 of 3');
        expect(step.focus).toMatchObject({ key: '1', text: 'Add the onion.', checked: false });
        expect(texts(step.then)).toEqual(['Stir well.']);
        expect(step.ticked).toMatchObject({ summary: 'You ticked 1 line', expanded: false, show: { label: 'Show' } });
        expect(step.ticked?.lines).toEqual([
            expect.objectContaining({ key: '0', text: 'Heat the oil.', checked: true }),
        ]);
        expect(preview).toBeDefined();
        expect(step.upNext).toBeUndefined();
    });

    it('keeps a line ticked out of order out of the lines after the focus, and counts it', () => {
        const { result } = mount();
        act(() => result.current.tick(2));
        act(() => result.current.tick(1));

        const { step, preview } = viewOf(result);

        expect(step.focus).toMatchObject({ key: '0', text: 'Heat the oil.' });
        expect(step.then).toEqual([]);
        expect(step.ticked?.summary).toBe('You ticked 2 lines');
        expect(texts(step.ticked?.lines)).toEqual(['Add the onion.', 'Stir well.']);
        // A line is still unticked, so the foot still previews; Up next waits for every line.
        expect(preview).toBeDefined();
        expect(step.upNext).toBeUndefined();
    });

    it('passes the open disclosure through, and Show calls the toggle it was handed', () => {
        const { result } = mount();
        act(() => result.current.tick(0));
        const onToggleShow = vi.fn();

        const { step } = viewOf(result, true, onToggleShow);
        step.ticked?.show.onPress();

        expect(step.ticked?.expanded).toBe(true);
        expect(onToggleShow).toHaveBeenCalledTimes(1);
    });

    it('ticks a line from its row, and unticks a ticked one', () => {
        const { result } = mount();

        act(() => viewOf(result).step.focus?.onToggle());
        expect(result.current.isTicked(0)).toBe(true);

        act(() => viewOf(result).step.ticked?.lines[0]?.onToggle());
        expect(result.current.isTicked(0)).toBe(false);
    });

    it('once every line is ticked, shows no focus and hands Up next for the body, its first line leading', () => {
        const { result } = mount();
        act(() => result.current.tick(0));
        act(() => result.current.tick(1));
        act(() => result.current.tick(2));

        const { step, preview } = viewOf(result);

        expect(step.focus).toBeUndefined();
        expect(step.lineOf).toBeUndefined();
        expect(step.then).toEqual([]);
        expect(step.ticked?.summary).toBe('You ticked 3 lines');
        expect(preview).toBeUndefined();
        expect(step.upNext).toEqual({
            overline: 'Up next · step\u00a02',
            lead: 'Add the stock.',
            rest: ['Simmer for 20 min.'],
        });
    });
});

describe('cookingStepViewOf — one line, and the last step', () => {
    it('previews a one-line next step by its only line', () => {
        const { result } = mount();
        act(() => result.current.next());

        const { preview, step } = viewOf(result);

        expect(preview).toEqual({ overline: 'Next · step\u00a03', line: 'Serve it hot.' });
        expect(step.upNext).toBeUndefined();
    });

    it('hands a one-line next step to Up next with no rest', () => {
        const { result } = mount();
        act(() => result.current.next());
        act(() => result.current.tick(0));
        act(() => result.current.tick(1));

        const { preview, step } = viewOf(result);

        expect(preview).toBeUndefined();
        expect(step.upNext).toEqual({ overline: 'Up next · step\u00a03', lead: 'Serve it hot.', rest: [] });
    });

    it('on a one-line last step, says no Line n of m and has nothing after it', () => {
        const { result } = mount();
        act(() => result.current.next());
        act(() => result.current.next());

        const { step, preview } = viewOf(result);

        expect(step.track).toEqual({ total: 3, position: 3 });
        expect(step.lineOf).toBeUndefined();
        expect(step.focus).toMatchObject({ key: '0', text: 'Serve it hot.', checked: false });
        expect(step.then).toEqual([]);
        expect(step.ticked).toBeUndefined();
        expect(preview).toBeUndefined();
        expect(step.upNext).toBeUndefined();
    });

    it('on the last step with its line ticked, still has nothing after it', () => {
        const { result } = mount();
        act(() => result.current.next());
        act(() => result.current.next());
        act(() => result.current.tick(0));

        const { step, preview } = viewOf(result);

        expect(step.focus).toBeUndefined();
        expect(preview).toBeUndefined();
        expect(step.upNext).toBeUndefined();
        expect(step.ticked?.summary).toBe('You ticked 1 line');
    });
});
