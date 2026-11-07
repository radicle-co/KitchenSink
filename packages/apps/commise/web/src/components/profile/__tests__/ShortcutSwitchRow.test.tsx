// @vitest-environment jsdom
/**
 * The keyboard-shortcuts switch row is a PURE render component: it shows what it is given and reports a tap. It reads
 * no query and writes no store, so these tests render it with nothing around it — if it ever reached for either, they
 * would throw for want of a provider.
 */
import { renderWithProviders } from '@commise/test-utils';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShortcutSwitchRow } from '../ShortcutSwitchRow';

afterEach(cleanup);

describe('ShortcutSwitchRow', () => {
    it.each([
        [true, 'true'],
        [false, 'false'],
    ])('shows checked=%s as aria-checked=%s', (checked, expected) => {
        renderWithProviders(<ShortcutSwitchRow checked={checked} onChange={vi.fn()} />);

        expect(screen.getByRole('switch', { name: 'Keyboard shortcuts' }).getAttribute('aria-checked')).toBe(expected);
    });

    it.each([
        [true, false],
        [false, true],
    ])('reports the OPPOSITE of what it shows when tapped (%s -> %s)', async (checked, next) => {
        const onChange = vi.fn();

        renderWithProviders(<ShortcutSwitchRow checked={checked} onChange={onChange} />);
        await userEvent.click(screen.getByRole('switch', { name: 'Keyboard shortcuts' }));

        expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
    });

    it('does not change its own state — the parent owns it', async () => {
        renderWithProviders(<ShortcutSwitchRow checked onChange={vi.fn()} />);

        await userEvent.click(screen.getByRole('switch', { name: 'Keyboard shortcuts' }));

        expect(screen.getByRole('switch', { name: 'Keyboard shortcuts' }).getAttribute('aria-checked')).toBe('true');
    });

    // WCAG 1.4.11 (bug sweep C5): an off knob painted in the track's own colour reads as an empty outline in dark. The
    // knob takes the control-line token, which has its own value in each theme (`role` / `roleDark`), so it contrasts
    // with the `surface-muted` track in both. Pinned by token class: jsdom resolves no theme, so the token is the contract.
    it('draws the OFF knob in the control-line token and never in the track colour', () => {
        renderWithProviders(<ShortcutSwitchRow checked={false} onChange={vi.fn()} />);
        const track = screen.getByRole('switch', { name: 'Keyboard shortcuts' }).querySelector('[aria-hidden="true"]')!;
        const knob = track.firstElementChild!;

        expect(track.className).toContain('bg-surface-muted');
        expect(knob.className).toContain('bg-line-control');
        expect(knob.className).not.toContain('bg-surface-muted');
    });

    it('draws the ON knob in paper on the action track', () => {
        renderWithProviders(<ShortcutSwitchRow checked onChange={vi.fn()} />);
        const track = screen.getByRole('switch', { name: 'Keyboard shortcuts' }).querySelector('[aria-hidden="true"]')!;

        expect(track.className).toContain('bg-action');
        expect(track.firstElementChild!.className).toContain('bg-paper');
    });
});
