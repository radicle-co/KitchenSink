// @vitest-environment jsdom
/**
 * Component tests for the web `PublishBlockedSheet`: what a Publish says when the cook chose Private and cannot keep it
 * (owner ruling 2026-10-26): every private slot used, or an imported public-web recipe. The two actions carry EQUAL weight,
 * side by side, neither preselected; Escape, the scrim and Close all mean Keep as draft and NEVER publish (DSA Art. 25: no
 * nudge into making public what the cook asked to keep private). Focus moves into the sheet and returns to the opener.
 * Paid features are hidden everywhere until feature 010 exists, so the Premium line is asserted ABSENT.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type FC } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublishBlocked } from '../../hooks/useRecipeEditor.js';
import { PublishBlockedSheet } from '../PublishBlockedSheet.js';

afterEach(cleanup);

const NO_SLOT: PublishBlocked = { kind: 'noSlot' };
const WEB_IMPORT: PublishBlocked = { kind: 'webImport', refusal: 'premium' };
const TITLE = 'Your private slots are full';

function renderSheet(ask: PublishBlocked = NO_SLOT) {
    const handlers = { onKeepDraft: vi.fn(), onPublishPublic: vi.fn() };

    render(<PublishBlockedSheet open ask={ask} slotTotal={50} {...handlers} />);

    return handlers;
}

describe('PublishBlockedSheet (web)', () => {
    it('noSlot: a dialog named "Your private slots are full", saying how many are in use', () => {
        renderSheet(NO_SLOT);

        expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy();
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

        expect(screen.getByRole('dialog', { name: 'This recipe can’t be private yet' })).toBeTruthy();
        expect(
            screen.getByText(
                'A recipe from a public web page can only be public. You can publish it as public, or keep it as a draft.',
            ),
        ).toBeTruthy();
    });

    it('⛔ sells no Premium while there is no subscription page: no upsell line, no See Premium', () => {
        for (const ask of [NO_SLOT, WEB_IMPORT]) {
            const { unmount } = render(
                <PublishBlockedSheet open ask={ask} slotTotal={50} onKeepDraft={vi.fn()} onPublishPublic={vi.fn()} />,
            );

            expect(screen.queryByText(/Premium/u)).toBeNull();
            expect(screen.queryByRole('button', { name: 'See Premium' })).toBeNull();
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

        expect(screen.queryByRole('dialog')).toBeNull();
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

    it('⛔ Escape means Keep as draft and never publishes', async () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();

        await userEvent.keyboard('{Escape}');

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('⛔ the Close control means Keep as draft and never publishes', () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('⛔ a press on the scrim means Keep as draft and never publishes', async () => {
        const { onKeepDraft, onPublishPublic } = renderSheet();
        // Radix listens for a press outside its content on the document, registered a tick after it mounts.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        act(() => {
            fireEvent.pointerDown(document.body);
            fireEvent.pointerUp(document.body);
            fireEvent.click(document.body);
        });

        expect(onKeepDraft).toHaveBeenCalledTimes(1);
        expect(onPublishPublic).not.toHaveBeenCalled();
    });

    it('⛔ gives the two actions EQUAL weight: the same pill in one row, neither one the first focus', () => {
        renderSheet();

        const keep = screen.getByRole('button', { name: 'Keep as draft' });
        const publish = screen.getByRole('button', { name: 'Publish as public' });

        expect(keep.className).toBe(publish.className);
        const row = keep.closest('div');

        expect(publish.closest('div')).toBe(row);
        expect(row?.className.split(' ')).not.toContain('flex-col');
        expect(document.activeElement).not.toBe(keep);
        expect(document.activeElement).not.toBe(publish);
    });

    it('moves focus into the sheet on open and back to the opener when it closes', async () => {
        const Host: FC = () => {
            const [open, setOpen] = useState(false);

            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Publish
                    </button>
                    <PublishBlockedSheet
                        open={open}
                        ask={NO_SLOT}
                        slotTotal={50}
                        onKeepDraft={() => setOpen(false)}
                        onPublishPublic={() => setOpen(false)}
                    />
                </>
            );
        };

        render(<Host />);
        const opener = screen.getByRole('button', { name: 'Publish' });
        opener.focus();

        await userEvent.click(opener);

        const dialog = await screen.findByRole('dialog', { name: TITLE });
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Keep as draft' }));
        });

        await waitFor(() => expect(document.activeElement).toBe(opener));
    });
});
