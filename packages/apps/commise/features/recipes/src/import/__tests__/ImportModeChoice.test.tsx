// @vitest-environment jsdom
/**
 * Component tests for the web `ImportModeChoice` (board ImportModeChoice; `ingredientMatching.md` "Bulk import"): three
 * modes as one radio group with NOTHING preselected, Start disabled until the cook picks, and the copy that says why.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportModeChoice } from '../ImportModeChoice.js';
import { importMessages } from '../messages.js';
import type { ImportModeChoiceProps } from '../props.js';

const m = importMessages.en.mode;

afterEach(cleanup);

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
const isBlocked = (button: HTMLElement) =>
    button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';

describe('ImportModeChoice (web)', () => {
    it('names the screen and the file it imports', () => {
        renderChoice();

        expect(screen.getByRole('heading', { level: 1, name: m.title })).toBeTruthy();
        expect(screen.getByText('My Recipes.paprikarecipes')).toBeTruthy();
        expect(screen.getByText('Paprika · 864 recipes')).toBeTruthy();
        expect(screen.getByText(m.intro)).toBeTruthy();
    });

    it('offers the three modes as one radio group, each described by its hint', () => {
        renderChoice();

        const group = screen.getByRole('radiogroup', { name: m.groupLabel });

        expect(within(group).getAllByRole('radio')).toEqual([
            within(group).getByRole('radio', { name: m.saveAsWrittenTitle, description: m.saveAsWrittenHint }),
            within(group).getByRole('radio', { name: m.bestTitle, description: m.bestHint }),
            within(group).getByRole('radio', { name: m.reviewTitle, description: m.reviewHint }),
        ]);
    });

    it('⛔ preselects nothing, and Start is disabled with the hint saying why', async () => {
        const user = userEvent.setup();
        const { onStart } = renderChoice();

        expect(screen.queryByRole('radio', { checked: true })).toBeNull();
        expect(isBlocked(start())).toBe(true);
        expect(screen.getByText(m.startHint)).toBeTruthy();

        await user.click(start());

        expect(onStart).not.toHaveBeenCalled();
    });

    it.each([
        ['saveAsWritten', m.saveAsWrittenTitle],
        ['best', m.bestTitle],
        ['review', m.reviewTitle],
    ] as const)('choosing "%s" reports that mode', async (mode, title) => {
        const user = userEvent.setup();
        const { onModeChange } = renderChoice();

        await user.click(screen.getByRole('radio', { name: title }));

        expect(onModeChange).toHaveBeenCalledWith(mode);
    });

    it('with a mode chosen, that mode is checked and Start starts', async () => {
        const user = userEvent.setup();
        const { onStart } = renderChoice({ mode: 'review' });

        expect(screen.getByRole('radio', { checked: true })).toBe(screen.getByRole('radio', { name: m.reviewTitle }));
        expect(isBlocked(start())).toBe(false);

        await user.click(start());

        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('while the start is in flight, Start is busy and cannot fire again', async () => {
        const user = userEvent.setup();
        const { onStart } = renderChoice({ mode: 'best', starting: true });

        expect(start().getAttribute('aria-busy')).toBe('true');

        await user.click(start());

        expect(onStart).not.toHaveBeenCalled();
    });

    it('states the promise for the wide layout only', () => {
        renderChoice();

        const promise = screen.getByText(m.promise);

        expect(promise.closest('.hidden')).not.toBeNull();
    });
});
