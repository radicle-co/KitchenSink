/**
 * The native discovery LOAD ERROR body, the twin of `RecipeDiscoveryLoadError.test.tsx` (`docs/design/uiOverhaul/
 * buildSpec.md` §4.6): the message and a Try again under the field, with the previous results kept under them.
 *
 * ⚠️ REWRITTEN for slice 5 with the web test: the body is no longer a card that replaces the results, so its surface
 * assertions go; the assertive live region (`accessibilityRole="alert"` alone is silent on iOS, SC 4.1.3) is kept.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeDiscoveryLoadError } from '../RecipeDiscoveryLoadError.native.js';

afterEach(cleanup);

const inLocale = (ui: React.ReactElement) => <LocaleProvider locale="en">{ui}</LocaleProvider>;

describe('RecipeDiscoveryLoadError (native)', () => {
    it('says the search failed, spoken assertively, with a Try again that reports upward', () => {
        const onRetry = vi.fn();
        render(inLocale(<RecipeDiscoveryLoadError onRetry={onRetry} />));

        expect(screen.getByText('We couldn’t search right now.').getAttribute('aria-live')).toBe('assertive');

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('keeps the previous results under the message', () => {
        render(inLocale(<RecipeDiscoveryLoadError onRetry={vi.fn()} previous={<Text>PREVIOUS RESULTS</Text>} />));

        expect(screen.getByText('PREVIOUS RESULTS')).toBeTruthy();
    });
});
