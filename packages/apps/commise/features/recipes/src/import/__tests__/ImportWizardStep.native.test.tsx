/**
 * Native component tests for `ImportWizardStep`, rendered through react-native-web under jsdom. Mirrors
 * `ImportWizardStep.test.tsx` — the recipe heading, the progress in words and as a bar, Save and leave, Back (absent on
 * the first recipe), Skip and Next — plus the native layout's rules: the action bar outside the scroll region (thumb
 * reach), and the recipe rail only at the wide container class. The bar's layout case is review finding M3: three
 * actions in one row needed 383 px against 288 at 320 dp and clipped Next; Next now fills its own row nearest the thumb
 * with Back and Skip on the row above. The focus case is new (review finding M4): when nothing
 * is left open, the host's request moves the screen reader to Next recipe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';

const windowWidth = vi.hoisted(() => ({ current: 390 }));
const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }),
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved },
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportWizardStep } from '../ImportWizardStep.native.js';
import { importMessages } from '../messages.js';
import type { ImportWizardStepProps } from '../props.js';

const w = importMessages.en.wizard;

afterEach(() => {
    cleanup();
    windowWidth.current = 390;
    focus.moved.mockClear();
});

function renderStep(overrides: Partial<ImportWizardStepProps> = {}) {
    const handlers = { onBack: vi.fn(), onSkip: vi.fn(), onNext: vi.fn(), onSaveAndLeave: vi.fn() };
    render(
        <ImportWizardStep
            recipeTitle="Lemon drizzle cake"
            position={14}
            total={309}
            openLines={3}
            checkingLines={0}
            nextFocus={{ requested: false, onHandled: vi.fn() }}
            {...handlers}
            {...overrides}
        >
            <Text>the lines</Text>
        </ImportWizardStep>,
    );

    return handlers;
}

/** The nearest ancestor react-native-web draws as a scroll container. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
    for (let at = element.parentElement; at !== null; at = at.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(at).overflowY)) {
            return at;
        }
    }

    return null;
}

describe('ImportWizardStep (native)', () => {
    it('heads the step with the recipe, and says where the review is in words and as a bar', () => {
        renderStep();

        expect(screen.getByRole('heading', { name: 'Lemon drizzle cake' })).toBeTruthy();
        expect(screen.getByText('Recipe 14 of 309 · 3 lines to choose')).toBeTruthy();
        expect(screen.getByRole('progressbar', { name: 'Review progress' }).getAttribute('aria-valuenow')).toBe('14');
        expect(screen.getByText('the lines')).toBeTruthy();
    });

    it('Back (named for the recipe it returns to), Skip and Next recipe, each reporting', () => {
        const { onBack, onSkip, onNext } = renderStep();

        const bar = screen.getByRole('group', { name: w.actionsLabel });

        fireEvent.click(within(bar).getByRole('button', { name: 'Back to recipe 13' }));
        fireEvent.click(within(bar).getByRole('button', { name: w.skip }));
        fireEvent.click(within(bar).getByRole('button', { name: w.next }));

        expect([onBack, onSkip, onNext].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
    });

    it('has no Back on the first recipe; Save and leave reports', () => {
        const { onSaveAndLeave } = renderStep({ position: 1 });

        expect(screen.queryByRole('button', { name: /^Back/u })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: w.saveLeave }));

        expect(onSaveAndLeave).toHaveBeenCalledTimes(1);
    });

    it('keeps the action bar after the step’s content, outside its scroll region', () => {
        renderStep();

        const bar = screen.getByRole('group', { name: w.actionsLabel });
        const lines = screen.getByText('the lines');

        expect(lines.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(bar.contains(lines)).toBe(false);
        expect(scrollerOf(lines)).not.toBeNull();
        expect(scrollerOf(lines)?.contains(bar)).toBe(false);
    });

    it('draws the rail only at the wide container class', () => {
        renderStep({ rail: <Text>the rail</Text> });
        expect(screen.queryByText('the rail')).toBeNull();
        cleanup();

        windowWidth.current = 1194;
        renderStep({ rail: <Text>the rail</Text> });
        expect(screen.getByText('the rail')).toBeTruthy();
    });

    it('⛔ a focus request moves the screen reader to Next recipe, and is acknowledged', () => {
        const onHandled = vi.fn();

        renderStep({ nextFocus: { requested: true, onHandled } });

        expect(focus.moved).toHaveBeenCalledTimes(1);
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('moves nothing while no focus is asked for', () => {
        renderStep();

        expect(focus.moved).not.toHaveBeenCalled();
    });

    it('⛔ at 320 dp Next recipe fills the bar on its own row nearest the thumb; Back and Skip share the row above', () => {
        renderStep();

        const bar = screen.getByRole('group', { name: w.actionsLabel });
        const back = within(bar).getByRole('button', { name: 'Back to recipe 13' });
        const skip = within(bar).getByRole('button', { name: w.skip });
        const next = within(bar).getByRole('button', { name: w.next });
        let row: HTMLElement | null = back.parentElement;

        while (row !== null && !row.contains(skip)) {
            row = row.parentElement;
        }

        // Next stretches across a column, so it takes the bar's whole width (the 383 px row clipped it at 320).
        expect(getComputedStyle(bar).flexDirection).toBe('column');
        expect(next.style.alignSelf).toBe('stretch');
        // Back and Skip sit together on one row that does not hold Next, and that row comes first, above Next.
        expect(row === null ? undefined : getComputedStyle(row).flexDirection).toBe('row');
        expect(row?.contains(next)).toBe(false);
        expect(skip.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('on the first recipe Skip stands alone above Next recipe', () => {
        renderStep({ position: 1 });

        const bar = screen.getByRole('group', { name: w.actionsLabel });

        expect(
            within(bar)
                .getAllByRole('button')
                .map((button) => button.textContent),
        ).toEqual([w.skip, w.next]);
        expect(within(bar).getByRole('button', { name: w.next }).style.alignSelf).toBe('stretch');
    });

    it('at the wide container class the three share one row, Next at its end', () => {
        windowWidth.current = 1194;
        renderStep();

        const bar = screen.getByRole('group', { name: w.actionsLabel });

        expect(getComputedStyle(bar).flexDirection).toBe('row');
        expect(within(bar).getByRole('button', { name: w.next }).style.alignSelf).toBe('');
    });
});
