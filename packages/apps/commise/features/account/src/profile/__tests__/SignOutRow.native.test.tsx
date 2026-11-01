/**
 * The native sign-out row: an ink Profile row named by its state, with the localized failure beneath it. Not
 * destructive, so never red (`buildSpec.md` §9.1). Every state is asserted by role and name.
 */
import { cleanup, screen } from '@testing-library/react';
// Its leaves draw through the design system's Tamagui `Text` (ADR-0080), so the tree renders in its provider.
import { render, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { SignOutRow } from '../SignOutRow.native.js';

afterEach(cleanup);

describe('SignOutRow (native)', () => {
    it('is a "Sign out" row that presses through, with no alert', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy={false} failed={false} onPress={onPress} />);

        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

        expect(onPress).toHaveBeenCalledOnce();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('reads "Signing out…", busy and unpressable, while the sign-out runs', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy failed={false} onPress={onPress} />);

        const button = screen.getByRole('button', { name: 'Signing out…' });

        // A disabled native row sets `pointer-events: none`; the click is still tried, and must do nothing.
        await userEvent.click(button, { pointerEventsCheck: 0 });

        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(onPress).not.toHaveBeenCalled();
    });

    it('announces the localized failure and stays retryable', async () => {
        const onPress = vi.fn();
        render(<SignOutRow busy={false} failed onPress={onPress} />);

        expect(screen.getByRole('alert').textContent).toBe('We couldn’t sign you out. Try again.');
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(onPress).toHaveBeenCalledOnce();
    });
});

// ADR-0080: the failure line draws through the design system's `Text`, in the `meta` role and `dangerText` like the web
// `px-4 pb-3 text-meta text-danger-text`, so it follows the device's dark scheme and the 2x text cap.
describe('SignOutRow (native) — the failure’s type, inset and colour', () => {
    it('sets the failure in the meta role, inset space 4 a side and space 3 below', () => {
        const spec = nativeTokens.type.meta;
        renderWithTamagui(<SignOutRow busy={false} failed onPress={() => undefined} />, 'light');
        const alert = screen.getByRole('alert');
        const style = getComputedStyle(alert);

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
        expect(resolvedStyle(alert, 'paddingLeft')).toBe(`${String(nativeTokens.spacing[4])}px`);
        expect(resolvedStyle(alert, 'paddingRight')).toBe(`${String(nativeTokens.spacing[4])}px`);
        expect(resolvedStyle(alert, 'paddingBottom')).toBe(`${String(nativeTokens.spacing[3])}px`);
    });

    it.each(['light', 'dark'] as const)('paints the failure in dangerText in the %s scheme', (scheme) => {
        renderWithTamagui(<SignOutRow busy={false} failed onPress={() => undefined} />, scheme);

        expect(resolvedColour(screen.getByRole('alert'), 'color')).toBe(rgb(rolesFor(scheme).dangerText));
    });
});
