/**
 * Unit tests for `listControlFocus.ts`: what each control of a food-choice list or a settled row is told about focus.
 * A list takes focus for two reasons, the host's request after a pick (on the view's `focusTarget`) and Try again's
 * request when a retry starts (on the view's `landing`); a control lowers only the request that asked, so one cannot
 * cancel the other.
 */
import { describe, expect, it, vi } from 'vitest';

import { listControlFocusOf, settledControlFocusOf } from '../listControlFocus.js';
import type { FoodChoiceListView } from '../matchLineView.js';

const view: Pick<FoodChoiceListView, 'focusTarget' | 'landing'> = {
    focusTarget: { kind: 'search' },
    landing: { kind: 'row', id: 'food:skim' },
};
const SKIM = { kind: 'row', id: 'food:skim' } as const;
const SEARCH = { kind: 'search' } as const;

const requests = (host: boolean, landing: boolean) => ({
    focus: { requested: host, onHandled: vi.fn() },
    landing: { requested: landing, onHandled: vi.fn() },
});

describe('listControlFocusOf', () => {
    it('asks the landing control when Try again asks, and only that control', () => {
        const asked = requests(false, true);

        expect(listControlFocusOf(view, SKIM, asked).focusRequested).toBe(true);
        expect(listControlFocusOf(view, SEARCH, asked).focusRequested).toBe(false);
    });

    it('asks the focus target when the host asks, and only that control', () => {
        const asked = requests(true, false);

        expect(listControlFocusOf(view, SEARCH, asked).focusRequested).toBe(true);
        expect(listControlFocusOf(view, SKIM, asked).focusRequested).toBe(false);
    });

    it('asks nothing when nothing is asked', () => {
        const asked = requests(false, false);

        expect(listControlFocusOf(view, SEARCH, asked).focusRequested).toBe(false);
        expect(listControlFocusOf(view, SKIM, asked).focusRequested).toBe(false);
    });

    it('lowers only the request that asked it', () => {
        const asked = requests(true, true);

        listControlFocusOf(view, SKIM, asked).onFocusRequestHandled();

        expect(asked.landing.onHandled).toHaveBeenCalledTimes(1);
        expect(asked.focus.onHandled).not.toHaveBeenCalled();

        listControlFocusOf(view, SEARCH, asked).onFocusRequestHandled();

        expect(asked.focus.onHandled).toHaveBeenCalledTimes(1);
        expect(asked.landing.onHandled).toHaveBeenCalledTimes(1);
    });

    it('a control both requests land on lowers both', () => {
        const same = { focusTarget: { kind: 'keep' }, landing: { kind: 'keep' } } as const;
        const asked = requests(true, true);

        listControlFocusOf(same, { kind: 'keep' }, asked).onFocusRequestHandled();

        expect(asked.focus.onHandled).toHaveBeenCalledTimes(1);
        expect(asked.landing.onHandled).toHaveBeenCalledTimes(1);
    });
});

describe('settledControlFocusOf', () => {
    it('asks the landing control only, and only while the request stands', () => {
        const landing = { requested: true, onHandled: vi.fn() };

        expect(settledControlFocusOf({ landing: 'useThis' }, 'useThis', landing).focusRequested).toBe(true);
        expect(settledControlFocusOf({ landing: 'useThis' }, 'search', landing).focusRequested).toBe(false);
        expect(
            settledControlFocusOf({ landing: 'useThis' }, 'useThis', { requested: false, onHandled: vi.fn() })
                .focusRequested,
        ).toBe(false);
    });

    it('reports to the landing request', () => {
        const landing = { requested: true, onHandled: vi.fn() };

        settledControlFocusOf({ landing: 'change' }, 'change', landing).onFocusRequestHandled();

        expect(landing.onHandled).toHaveBeenCalledTimes(1);
    });
});
