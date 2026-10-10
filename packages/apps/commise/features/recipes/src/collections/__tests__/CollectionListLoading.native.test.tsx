/**
 * Native component tests for `CollectionListLoading` — the list's `Suspense` fallback. Moved from the retired
 * `CollectionList.native.test.tsx` ("loading state").
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';

import { CollectionListLoading } from '../CollectionListLoading.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('CollectionListLoading (native)', () => {
    it('shows the loading label', () => {
        render(<CollectionListLoading />);

        expect(screen.getByLabelText('Loading collections')).toBeTruthy();
    });

    it('renders inert skeleton cards (not a blank view) while loading (U4)', () => {
        render(<CollectionListLoading />);

        const region = screen.getByLabelText('Loading collections');
        expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    });
});

// D15: a skeleton card is the quiet `surfaceMuted` fill in both schemes, as the web twin's `bg-surface-muted`.
describe.each(['light', 'dark'] as const)('CollectionListLoading (native) — the %s scheme', (scheme) => {
    it('fills each skeleton card with surfaceMuted', () => {
        systemScheme.current = scheme;
        render(<CollectionListLoading />);
        const card = screen.getByLabelText('Loading collections').querySelector('[aria-hidden="true"]');

        if (card === null) {
            throw new Error('no skeleton card');
        }

        expect(getComputedStyle(card).backgroundColor).toBe(rgb((scheme === 'dark' ? roleDark : role).surfaceMuted));
    });
});
