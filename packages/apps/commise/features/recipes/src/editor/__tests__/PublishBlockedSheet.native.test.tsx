/**
 * Component tests for the native `PublishBlockedSheet`: what a Publish says when the cook chose Private and cannot keep it
 * (owner ruling 2026-10-26): every private slot used, or an imported public-web recipe. The two actions carry EQUAL weight,
 * side by side, neither preselected; Escape, the scrim and Close all mean Keep as draft and NEVER publish (DSA Art. 25: no
 * nudge into making public what the cook asked to keep private). Screen-reader focus moves to the title (the Sheet's own contract); returning it belongs to the host.
 * Paid features are hidden everywhere until feature 010 exists, so the Pro line is asserted ABSENT.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublishBlocked } from '../../hooks/useRecipeEditor.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PublishBlockedSheet } from '../PublishBlockedSheet.native.js';

afterEach(cleanup);

const NO_SLOT: PublishBlocked = { kind: 'noSlot' };
const WEB_IMPORT: PublishBlocked = { kind: 'webImport', refusal: 'premium' };
const TITLE = 'Your private slots are full';

function renderSheet(ask: PublishBlocked = NO_SLOT) {
    const handlers = { onKeepDraft: vi.fn(), onPublishPublic: vi.fn() };

    render(<PublishBlockedSheet open ask={ask} slotTotal={50} {...handlers} />);

    return handlers;
}

describe('PublishBlockedSheet (native)', () => {
    it('noSlot: a dialog named "Your private slots are full", saying how many are in use', () => {
        renderSheet(NO_SLOT);

        expect(screen.getByRole('heading', { name: TITLE }).closest('[role="dialog"]')).toBeTruthy();
        expect(
            screen.getByText(
                'All 50 of your private slots are in use, so this recipe can’t be private right now. You can publish it as public, or keep it as a draft. Nothing is lost either way.',
            ),
        ).toBeTruthy();
    });

    it.each([
        ['premium', WEB_IMPORT],
        ['final', { kind: 'webImport', refusal: 'final' } as const],
    ])('webImport (%s): "This recipe can’t be private yet", in the paid-features-hidden words', (_name, ask) => {
        renderSheet(ask);

        expect(screen.getByRole('heading', { name: 'This recipe can’t be private yet' })).toBeTruthy();
        expect(
            screen.getByText(
                'A recipe from a public web page can only be public. You can publish it as public, or keep it as a draft.',
            ),
        ).toBeTruthy();
    });

    it('⛔ sells no Pro while there is no subscription page: no upsell line, no See Pro', () => {
        for (const ask of [NO_SLOT, WEB_IMPORT]) {
            const { unmount } = render(
                <PublishBlockedSheet open ask={ask} slotTotal={50} onKeepDraft={vi.fn()} onPublishPublic={vi.fn()} />,
            );

            expect(screen.queryByText(/\bPro\b/u)).toBeNull();
            expect(screen.queryByRole('button', { name: 'See Pro' })).toBeNull();
            unmount();
        }
    });

    it('closed, it shows nothing', () => {
        render(
            <PublishBlockedSheet
                open={false}
                ask={NO_SLOT}
                slotTotal={50}
                onKeepDraft={vi.fn()}
                onPublishPublic={vi.fn()}
            />,
        );

        expect(screen.queryByRole('heading', { name: TITLE })).toBeNull();
    });

    it('Keep as draft keeps the draft and does not publish', () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('Publish as public publishes', () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Publish as public' }));

        expect(onPublishPublic).toHaveBeenCalledTimes(1);
        expect(onKeepDraft).not.toHaveBeenCalled();
    });

    it('⛔ the platform back route (Escape under react-native-web) means Keep as draft and never publishes', () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();

        fireEvent.keyUp(document, { key: 'Escape' });

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('⛔ the Close control means Keep as draft and never publishes', () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('⛔ a tap on the scrim means Keep as draft and never publishes', () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();
        const dialog = screen.getByRole('heading', { name: TITLE }).closest('[role="dialog"]');
        const scrim = dialog?.parentElement?.parentElement?.firstElementChild;

        fireEvent.click(scrim as Element);

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('⛔ gives the two actions EQUAL weight: the same pill, side by side in one row', () => {
        renderSheet();

        const keep = screen.getByRole('button', { name: 'Keep as draft' });
        const publish = screen.getByRole('button', { name: 'Publish as public' });
        const row = keep.parentElement?.parentElement;

        expect(publish.parentElement?.parentElement).toBe(row);
        expect(row === null || row === undefined ? undefined : getComputedStyle(row).flexDirection).toBe('row');
        expect(getComputedStyle(keep).backgroundColor).toBe(getComputedStyle(publish).backgroundColor);
    });
});
