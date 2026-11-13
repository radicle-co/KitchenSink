/**
 * Native component tests for `ImportModeChoice`, rendered through react-native-web under jsdom. Mirrors
 * `ImportModeChoice.test.tsx`: nothing preselected, Start disabled until the cook picks; plus the native layout's own
 * rule — the promise shows only at the wide container class.
 *
 * NEW for U17 (staff-ux, 2026-10-25): Start is pinned in a bar outside the scroll region, within thumb reach, the same
 * house pinning the review wizard uses (`usePinnedFooter`), so three tall mode cards never push it off a phone screen.
 * The leaf owns its frame now; it was a column for the host's scroll view.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const windowWidth = vi.hoisted(() => ({ current: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }),
    };
});

import { touchFloor } from '@commise/ui/layout';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportModeChoice } from '../ImportModeChoice.native.js';
import { importMessages } from '../messages.js';
import type { ImportModeChoiceProps } from '../props.js';
import { render, scrollRegionFloorOf } from '@commise/ui/testing/tamagui';

const m = importMessages.en.mode;

/** The nearest ancestor react-native-web draws as a scroll container. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
    for (let at = element.parentElement; at !== null; at = at.parentElement) {
        if (['auto', 'scroll'].includes(getComputedStyle(at).overflowY)) {
            return at;
        }
    }

    return null;
}

afterEach(() => {
    cleanup();
    windowWidth.current = 390;
});

function renderChoice(overrides: Partial<ImportModeChoiceProps> = {}) {
    const onModeChange = vi.fn();
    const onStart = vi.fn();
    render(
        <ImportModeChoice
            fileName="My Recipes.paprikarecipes"
            sourceName="Paprika"
            recipeCount={864}
            mode={undefined}
            onModeChange={onModeChange}
            onStart={onStart}
            {...overrides}
        />,
    );

    return { onModeChange, onStart };
}

const start = () => screen.getByRole('button', { name: m.start });

describe('ImportModeChoice (native)', () => {
    it('names the screen and the file it imports', () => {
        renderChoice();

        expect(screen.getByRole('heading', { name: m.title })).toBeTruthy();
        expect(screen.getByText('My Recipes.paprikarecipes')).toBeTruthy();
        expect(screen.getByText('Paprika · 864 recipes')).toBeTruthy();
        expect(screen.getByText(m.intro)).toBeTruthy();
    });

    it('offers the three modes as one radio group', () => {
        renderChoice();

        const radios = within(screen.getByRole('radiogroup', { name: m.groupLabel })).getAllByRole('radio');

        expect(radios.map((radio) => radio.textContent)).toEqual([
            `${m.saveAsWrittenTitle}Matched foods and the usual defaults are set, and each default keeps its Default tag. Every other line is saved as written, with no food, for you to choose later.`,
            `${m.bestTitle}${m.bestHint}`,
            `${m.reviewTitle}${m.reviewHint}`,
        ]);
    });

    it('⛔ preselects nothing, and Start is disabled with the hint saying why', () => {
        const { onStart } = renderChoice();

        expect(screen.queryByRole('radio', { checked: true })).toBeNull();
        expect(start().getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText(m.startHint)).toBeTruthy();

        fireEvent.click(start());

        expect(onStart).not.toHaveBeenCalled();
    });

    it('choosing a mode reports it', () => {
        const { onModeChange } = renderChoice();

        fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);

        expect(onModeChange).toHaveBeenCalledWith('best');
    });

    it('with a mode chosen, that mode is checked and Start starts', () => {
        const { onStart } = renderChoice({ mode: 'saveAsWritten' });

        expect(screen.getByRole('radio', { checked: true }).textContent).toContain(m.saveAsWrittenTitle);

        fireEvent.click(start());

        expect(onStart).toHaveBeenCalledTimes(1);
    });

    // Issue #192: Start's place is decided a layout pass after the frame shrinks; the scroll region keeps a floor
    // through that pass instead of collapsing to zero height.
    it('keeps its scroll region at least one control tall', () => {
        renderChoice();

        const scroller = scrollerOf(screen.getByText(m.intro));

        if (scroller === null) {
            throw new Error('the intro is not in a scroll region');
        }

        expect(scrollRegionFloorOf(scroller)).toBe(`${touchFloor()}px`);
    });

    it('shows the promise only at the wide container class', () => {
        renderChoice();
        expect(screen.queryByText(m.promise)).toBeNull();
        cleanup();

        windowWidth.current = 1194;
        renderChoice();
        expect(screen.getByText(m.promise)).toBeTruthy();
    });

    it('⛔ U17: pins Start and its hint after the modes, outside their scroll region', () => {
        renderChoice();

        const start = screen.getByRole('button', { name: m.start });
        const group = screen.getByRole('radiogroup', { name: m.groupLabel });

        expect(group.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(scrollerOf(group)).not.toBeNull();
        expect(scrollerOf(group)?.contains(start)).toBe(false);
        expect(scrollerOf(screen.getByText(m.startHint))).toBeNull();
    });
});
