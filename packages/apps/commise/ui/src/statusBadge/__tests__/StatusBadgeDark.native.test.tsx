import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb } from 'culori';

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => 'dark',
}));

import { proToneDark } from '../../tokens/tones.js';
import { StatusBadge } from '../StatusBadge.native.js';

/**
 * The PRO badge in the dark scheme (native) paints the DARK pair: charcoal on light grey. It used to read the light
 * constant in both themes, so a dark-mode PRO chip was the light fill on a dark page. Mutation lens: read `proTone`
 * directly in the badge and this fails.
 */
afterEach(cleanup);

describe('StatusBadge (native, dark scheme)', () => {
    it('paints PRO with the dark pair', () => {
        render(<StatusBadge status="pro">PRO</StatusBadge>);

        expect(getComputedStyle(screen.getByText('PRO').parentElement as HTMLElement).backgroundColor).toBe(
            formatRgb(proToneDark.fill),
        );
        expect(getComputedStyle(screen.getByText('PRO')).color).toBe(formatRgb(proToneDark.text));
    });
});
