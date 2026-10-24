/**
 * Native component tests for the browse-rail LOAD ERROR body (react-native-web under jsdom). Mirrors
 * `RecipeBrowseRailLoadError.test.tsx`, including its NEW Try again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { computedContrast } from '@commise/test-utils';
import { palette } from '@commise/ui';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeBrowseRailLoadError } from '../RecipeBrowseRailLoadError.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('RecipeBrowseRailLoadError (native)', () => {
    it('says the rail could not load, and retries it from Try again', () => {
        const onRetry = vi.fn();
        render(<RecipeBrowseRailLoadError onRetry={onRetry} />);

        expect(screen.getByText('Couldn’t load this row.')).toBeTruthy();
        // Spoken assertively through `LiveRegion`: `accessibilityRole="alert"` alone is silent on iOS (SC 4.1.3).
        expect(screen.getByText('Couldn’t load this row.').getAttribute('aria-live')).toBe('assertive');
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('gives Try again the 44pt touch floor and a legible label on the screen background', () => {
        render(<RecipeBrowseRailLoadError onRetry={() => undefined} />);

        const retry = screen.getByRole('button', { name: 'Try again' });
        const surface = [retry, ...Array.from(retry.querySelectorAll<HTMLElement>('*'))].find(
            (node) => window.getComputedStyle(node).minHeight === '44px',
        );
        expect(surface, 'Try again does not reach a 44pt target').toBeDefined();
        expect(
            computedContrast(within(retry).getByText('Try again'), { surface: palette.sand }),
        ).toBeGreaterThanOrEqual(4.5);
    });
});

// D15: the note is `inkMuted` and Try again is a text button in `actionText`, as the web twin, in both schemes.
describe.each(['light', 'dark'] as const)('RecipeBrowseRailLoadError (native) — the %s scheme', (scheme) => {
    it('paints the note in inkMuted and Try again in actionText', () => {
        systemScheme.current = scheme;
        const colours = scheme === 'dark' ? roleDark : role;
        render(<RecipeBrowseRailLoadError onRetry={() => undefined} />);

        expect(getComputedStyle(screen.getByText('Couldn’t load this row.')).color).toBe(rgb(colours.inkMuted));
        expect(
            getComputedStyle(within(screen.getByRole('button', { name: 'Try again' })).getByText('Try again')).color,
        ).toBe(rgb(colours.actionText));
    });
});
