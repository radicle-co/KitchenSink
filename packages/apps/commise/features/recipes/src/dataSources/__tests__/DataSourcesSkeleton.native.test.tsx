/**
 * The native Data sources loading state (design §S16): the caption is spoken politely and shown, and the placeholder
 * cards stay out of the accessibility tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesSkeleton } from '../DataSourcesSkeleton.native.js';
import { dataSourcesMessages } from '../messages.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('DataSourcesSkeleton (native)', () => {
    it('shows and politely announces the caption', () => {
        render(<DataSourcesSkeleton />);

        const caption = screen.getByText('Loading data sources…');

        expect(caption.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it('hides the three placeholder cards from assistive technology', () => {
        const { container } = render(<DataSourcesSkeleton />);

        const hidden = container.querySelector('[aria-hidden="true"]');

        expect(hidden?.children).toHaveLength(3);
        expect(hidden?.contains(screen.getByText('Loading data sources…'))).toBe(false);
    });
});

describe.each(['light', 'dark'] as const)('DataSourcesSkeleton (native) — the %s scheme', (scheme) => {
    it('captions in inkMuted and fills each placeholder card with surfaceMuted (D15)', () => {
        systemScheme.current = scheme;
        const colours = scheme === 'dark' ? roleDark : role;
        const { container } = render(<DataSourcesSkeleton />);
        const caption = screen.getByText(dataSourcesMessages.en.loading);
        const cards = container.querySelectorAll('[aria-hidden="true"] > div');

        expect(getComputedStyle(caption).color).toBe(rgb(colours.inkMuted));
        expect(cards).toHaveLength(3);
        expect(getComputedStyle(cards[0] as Element).backgroundColor).toBe(rgb(colours.surfaceMuted));
    });
});
