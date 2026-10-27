/**
 * The native `SortOptionRow` (through react-native-web): one radio row of a sort sheet, shared by the Discover and My
 * recipes menus. A `radio` named for its label; `aria-checked` and a check glyph say which sort is in use; a press
 * chooses it; and the row keeps the platform touch floor, 44 pt on iOS and 48 dp on Android.
 */
import { touchFloor } from '@commise/ui/layout';
import { withPlatformOs } from '@commise/ui/testing/platform-os';
import { fireEvent } from '@testing-library/dom';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SortOptionRow } from '../SortOptionRow.native.js';

afterEach(cleanup);

describe('SortOptionRow (native)', () => {
    it('is a radio named for its label, unchecked until chosen', () => {
        render(<SortOptionRow label="Newest" chosen={false} onChoose={vi.fn()} />);

        expect(screen.getByRole('radio', { name: 'Newest' }).getAttribute('aria-checked')).toBe('false');
    });

    it('says it is checked when chosen', () => {
        render(<SortOptionRow label="Newest" chosen onChoose={vi.fn()} />);

        expect(screen.getByRole('radio', { name: 'Newest' }).getAttribute('aria-checked')).toBe('true');
    });

    it('chooses on press', () => {
        const onChoose = vi.fn();
        render(<SortOptionRow label="Newest" chosen={false} onChoose={onChoose} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Newest' }));

        expect(onChoose).toHaveBeenCalledTimes(1);
    });

    it.each(['ios', 'android'] as const)('keeps the touch floor on %s', (os) => {
        withPlatformOs(os, () => {
            render(<SortOptionRow label="Newest" chosen={false} onChoose={vi.fn()} />);

            expect(getComputedStyle(screen.getByRole('radio', { name: 'Newest' })).minHeight).toBe(
                `${String(touchFloor())}px`,
            );
        });
    });
});
