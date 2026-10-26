// @vitest-environment jsdom
/**
 * Component tests for the web `ImportSummary` (board WizardSummary): the library is in, from where and when; what was
 * added and how; what was already here; what could not be read, with Fix; the lines kept as written, with Choose foods;
 * and, at the wide class only, the nutrition coverage. A row with nothing to say is not drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportSummary } from '../ImportSummary.js';
import { importMessages } from '../messages.js';
import type { ImportSummaryProps } from '../props.js';

const s = importMessages.en.summary;

afterEach(cleanup);

function renderSummary(overrides: Partial<ImportSummaryProps> = {}) {
    const handlers = { onSeeAdded: vi.fn(), onFixUnreadable: vi.fn(), onChooseFoods: vi.fn() };
    render(
        <ImportSummary
            sourceName="Paprika"
            finishedWhen="today at 11:20"
            added={855}
            neededNothing={546}
            reviewed={300}
            skipped={9}
            alreadyHere={6}
            unreadable={['Grandma’s apple cake', 'Thai green curry paste', 'Untitled 3']}
            asWrittenLines={41}
            asWrittenRecipes={27}
            countedRecipes={828}
            {...handlers}
            {...overrides}
        />,
    );

    return handlers;
}

describe('ImportSummary (web)', () => {
    it('says the library is in, from where and when, and what was added', async () => {
        const user = userEvent.setup();
        const { onSeeAdded } = renderSummary();

        expect(screen.getByRole('heading', { level: 1, name: s.title })).toBeTruthy();
        expect(screen.getByText('From Paprika, today at 11:20.')).toBeTruthy();
        expect(screen.getByText('855 added')).toBeTruthy();
        expect(screen.getByText('546 needed nothing · 300 you reviewed · 9 you skipped')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: s.seeThem }));

        expect(onSeeAdded).toHaveBeenCalledTimes(1);
    });

    it('says what was already here, and what could not be read with Fix', async () => {
        const user = userEvent.setup();
        const { onFixUnreadable } = renderSummary();

        expect(screen.getByText('6 already here')).toBeTruthy();
        expect(screen.getByText(s.alreadyHereHint)).toBeTruthy();
        expect(screen.getByText('3 could not be read')).toBeTruthy();
        expect(screen.getByText('Grandma’s apple cake, Thai green curry paste, Untitled 3')).toBeTruthy();

        await user.click(screen.getByRole('button', { name: s.fix }));

        expect(onFixUnreadable).toHaveBeenCalledTimes(1);
    });

    it('says how many lines are kept as written, with Choose foods', async () => {
        const user = userEvent.setup();
        const { onChooseFoods } = renderSummary();

        expect(
            screen.getByText('41 lines in 27 recipes are kept as written, so they don’t count toward nutrition yet.'),
        ).toBeTruthy();

        await user.click(screen.getByRole('button', { name: s.chooseFoods }));

        expect(onChooseFoods).toHaveBeenCalledTimes(1);
    });

    it('draws no row, and no action, for a count of zero', () => {
        renderSummary({ alreadyHere: 0, unreadable: [], asWrittenLines: 0, asWrittenRecipes: 0 });

        expect(screen.queryByText(/already here/u)).toBeNull();
        expect(screen.queryByText(/could not be read/u)).toBeNull();
        expect(screen.queryByRole('button', { name: s.fix })).toBeNull();
        expect(screen.queryByText(/kept as written/u)).toBeNull();
        expect(screen.queryByRole('button', { name: s.chooseFoods })).toBeNull();
    });

    it('states the nutrition coverage for the wide layout only', () => {
        renderSummary();

        expect(screen.getByText('828 of 855 recipes').closest('.hidden')).not.toBeNull();
    });
});
