/**
 * The web control over a photo (D12; `modernizeA.md` §5): web blurs only small fixed bars, so the disc over the photo
 * is a solid `photoChip` disc, 44 px, with a visible focus ring. Its name is the caller's label, never the glyph.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PhotoControl } from '../PhotoControl.js';

afterEach(cleanup);

describe('PhotoControl (web)', () => {
    it('is a button named by its label that reports a press from the keyboard', async () => {
        const onPress = vi.fn();
        const user = userEvent.setup();
        render(<PhotoControl icon="chevronLeft" label="Back" onPress={onPress} />);

        await user.tab();
        expect(screen.getByRole('button', { name: 'Back' })).toBe(document.activeElement);
        await user.keyboard('{Enter}');

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('is a solid 44 px photoChip disc with no blur and a focus ring', () => {
        render(<PhotoControl icon="chevronLeft" label="Back" onPress={vi.fn()} />);
        const classes = screen.getByRole('button', { name: 'Back' }).className.split(' ');

        expect(classes).toEqual(expect.arrayContaining(['size-11', 'rounded-full', 'bg-photo-chip']));
        expect(classes.some((name) => name.startsWith('backdrop-blur'))).toBe(false);
        expect(classes).toContain('focus-visible:ring-2');
    });

    it('hides its glyph from assistive technology', () => {
        render(<PhotoControl icon="chevronLeft" label="Back" onPress={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Back' }).querySelector('svg')?.getAttribute('aria-hidden')).toBe(
            'true',
        );
    });
});
