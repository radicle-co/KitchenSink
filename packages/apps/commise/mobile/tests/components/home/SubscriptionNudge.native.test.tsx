/**
 * Component tests for the mobile subscription upgrade nudge (FR-046). Rendered via react-native-web under jsdom (see
 * `vitest.native.config.ts`). The once-per-session lifecycle hook behind it is pinned once for both apps in
 * `@commise/features-core`'s `home/__tests__/useOncePerSessionNudge.test.tsx`.
 *
 * The web nudge has carried a component suite since it shipped; the native mirror had only the end-to-end
 * pass inside `HomeWidgetSurface.native.test.tsx`, so the leaf's own states — closed, open, and each of its
 * two dismissal paths — were never asserted on this platform. Covered here.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dialogTitled } from '@commise/test-utils';
import { homeMessages } from '@commise/features-core/home';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
// The copy draws through the design system's Tamagui `Text` (ADR-0080), so the sheet renders in its provider.
import { render, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { SubscriptionNudge } from '../../../src/components/home/SubscriptionNudge.js';

afterEach(cleanup);

describe('SubscriptionNudge (mobile) — closed', () => {
    it('renders none of the nudge copy while closed', () => {
        render(<SubscriptionNudge open={false} onDismiss={() => undefined} />);

        expect(screen.queryByText('Unlock Commise Pro')).toBeNull();
    });
});

describe('SubscriptionNudge (mobile) — open', () => {
    // `docs/design/compactHeightLayout.md` §10 (A9): the nudge is the design system's `Sheet`, so it gains the width
    // cap, the insets, the scroll and every close route a phone held sideways needs. It was a hand-rolled bottom panel
    // that spanned the whole width under the side navigation bar.
    it('is the design-system sheet: a modal dialog named by its title', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        expect(dialogTitled('Unlock Commise Pro').getAttribute('aria-modal')).toBe('true');
        expect(screen.getByRole('heading', { name: 'Unlock Commise Pro' })).toBeTruthy();
    });

    it('closes through its × control, named “Close upgrade offer”, exactly once', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.click(screen.getByRole('button', { name: 'Close upgrade offer' }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('closes through the platform back route (Escape under react-native-web), exactly once', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.keyUp(document, { key: 'Escape' });

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('offers both choices as full design-system buttons, the primary last', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        const later = screen.getByRole('button', { name: 'Maybe later' });
        const plans = screen.getByRole('button', { name: 'See plans' });

        expect(later.compareDocumentPosition(plans) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
    });

    it('renders the sheet with its heading and body copy', () => {
        render(<SubscriptionNudge open onDismiss={() => undefined} />);

        expect(screen.getByText('Unlock Commise Pro')).toBeTruthy();
        expect(screen.getByText('Upgrade to Commise Pro to use this feature.')).toBeTruthy();
    });

    it('the dismiss action fires onDismiss', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.click(screen.getByText('Maybe later'));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('the upgrade action also fires onDismiss (010 owns the real destination)', () => {
        const onDismiss = vi.fn();
        render(<SubscriptionNudge open onDismiss={onDismiss} />);

        fireEvent.click(screen.getByText('See plans'));

        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});

// ADR-0080: the copy draws through the design system's `Text`, so it follows the device's dark scheme and the 2x text
// cap. It keeps the `meta` role it always spread; the web body is a raw `text-sm`, the same 14 px with no role.
describe('SubscriptionNudge (mobile) — the copy’s type and colour', () => {
    const body = homeMessages.en.nudge.body;

    it('sets the copy in the meta role', () => {
        const spec = nativeTokens.type.meta;
        renderWithTamagui(<SubscriptionNudge open onDismiss={() => undefined} />, 'light');
        const style = getComputedStyle(screen.getByText(body));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the copy in inkMuted in the %s scheme', (scheme) => {
        renderWithTamagui(<SubscriptionNudge open onDismiss={() => undefined} />, scheme);

        expect(resolvedColour(screen.getByText(body), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
    });
});
