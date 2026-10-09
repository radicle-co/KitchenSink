// @vitest-environment jsdom
/**
 * The web discovery LOAD ERROR body (`docs/design/uiOverhaul/buildSpec.md` §4.6): when a search fails, for any cause
 * (offline included — there is no connectivity branch), the message and a Try again sit under the field and the
 * PREVIOUS results stay under them. A first load that fails has no previous results and shows the message alone.
 *
 * ⚠️ REWRITTEN for slice 5. The body used to be a card that replaced the results, and its tests pinned the card's surface
 * classes and its contrast by class; the card is gone (the retry is the design system's `Button`, whose contrast and
 * touch floor are its own tests'), and the "previous results stay" rule is new.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import { RecipeDiscoveryLoadError } from '../RecipeDiscoveryLoadError.js';

afterEach(cleanup);

const inLocale = (ui: React.ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

describe('RecipeDiscoveryLoadError (web)', () => {
    it('says the search failed in an alert, with a Try again that reports upward', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        render(inLocale(<RecipeDiscoveryLoadError onRetry={onRetry} />));

        expect(screen.getByRole('alert').textContent).toContain('We couldn’t search right now.');

        await user.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous results under the message, outside the alert, so they are not read as part of it', () => {
        render(inLocale(<RecipeDiscoveryLoadError onRetry={vi.fn()} previous={<p>PREVIOUS RESULTS</p>} />));

        expect(screen.getByText('PREVIOUS RESULTS')).toBeTruthy();
        expect(within(screen.getByRole('alert')).queryByText('PREVIOUS RESULTS')).toBeNull();
    });

    it('shows the message alone when there is nothing previous', () => {
        render(inLocale(<RecipeDiscoveryLoadError onRetry={vi.fn()} />));

        expect(screen.queryByText('PREVIOUS RESULTS')).toBeNull();
    });
});
