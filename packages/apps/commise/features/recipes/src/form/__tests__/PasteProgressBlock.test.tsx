// @vitest-environment jsdom
/**
 * Component tests for the web `PasteProgressBlock` (plan 2026-10-15-011, UX spec there): the one block over a paste's
 * unjoined lines. Every status renders its words; Try again appears only when a line is retryable and Add the rest as
 * written only for two waiting lines or more; and when an action takes the focus away with it, focus lands on the block
 * rather than on the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PasteProgressBlock } from '../PasteProgressBlock.js';
import { recipeFormMessages } from '../messages.js';
import type { PasteProgress } from '../props.js';

afterEach(cleanup);

const progress = (over: Partial<PasteProgress> = {}): PasteProgress => ({
    done: 1,
    count: 4,
    status: { kind: 'step', step: 'reading', position: 2 },
    retryCount: 0,
    restCount: 0,
    ...over,
});

describe('PasteProgressBlock (web)', () => {
    it.each<[PasteProgress['status'], string]>([
        [{ kind: 'step', step: 'reading', position: 2 }, 'Reading line 2'],
        [{ kind: 'step', step: 'queued', position: 2 }, 'Waiting to read line 2'],
        [{ kind: 'step', step: 'retrying', position: 2 }, 'Reading line 2 again'],
        [{ kind: 'step', step: 'delayed', position: 2 }, 'Waiting to try line 2 again'],
        [{ kind: 'step', step: 'joining', position: 2 }, 'Looking up line 2'],
        [{ kind: 'stalled' }, 'Taking longer than usual'],
        [{ kind: 'offline' }, 'Paused until you’re back online'],
        [{ kind: 'needsYou', count: 2 }, '2 lines need you'],
    ])('%o: the count and the status', (status, text) => {
        render(
            <PasteProgressBlock
                progress={progress({ status })}
                onRetryParse={vi.fn()}
                onAddRestAsWritten={vi.fn()}
                retryFailed={false}
                focusSignal={0}
            />,
        );

        expect(screen.getByText('Added 1 of 4 lines')).toBeTruthy();
        expect(screen.getByText(text)).toBeTruthy();
    });

    it('a stalled paste says the cook can keep waiting or add the lines as written', () => {
        render(
            <PasteProgressBlock
                progress={progress({ status: { kind: 'stalled' } })}
                onRetryParse={vi.fn()}
                onAddRestAsWritten={vi.fn()}
                retryFailed={false}
                focusSignal={0}
            />,
        );

        expect(screen.getByText('You can keep waiting, or add the lines as written.')).toBeTruthy();
    });

    it('offers no action while nothing waits on the cook', () => {
        render(
            <PasteProgressBlock
                progress={progress()}
                onRetryParse={vi.fn()}
                onAddRestAsWritten={vi.fn()}
                retryFailed={false}
                focusSignal={0}
            />,
        );

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('offers Try again for every retryable line, and Add the rest for two or more waiting lines', async () => {
        const user = userEvent.setup();
        const onRetryParse = vi.fn();
        const onAddRestAsWritten = vi.fn();
        render(
            <PasteProgressBlock
                progress={progress({ status: { kind: 'needsYou', count: 2 }, retryCount: 2, restCount: 3 })}
                onRetryParse={onRetryParse}
                onAddRestAsWritten={onAddRestAsWritten}
                retryFailed={false}
                focusSignal={0}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Try again for 2 lines' }));
        await user.click(screen.getByRole('button', { name: 'Add the rest as written: 3 lines' }));

        expect(onRetryParse).toHaveBeenCalledTimes(1);
        expect(onAddRestAsWritten).toHaveBeenCalledTimes(1);
    });

    it('one waiting line has its own button, so the block offers no Add the rest', () => {
        render(
            <PasteProgressBlock
                progress={progress({ status: { kind: 'stalled' }, restCount: 1 })}
                onRetryParse={vi.fn()}
                onAddRestAsWritten={vi.fn()}
                retryFailed={false}
                focusSignal={0}
            />,
        );

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('takes the focus when the cook acted and the focus was lost with the control', () => {
        const props = { progress: progress(), onRetryParse: vi.fn(), onAddRestAsWritten: vi.fn() };
        const { rerender, container } = render(<PasteProgressBlock {...props} retryFailed={false} focusSignal={0} />);

        expect(document.activeElement).toBe(document.body);
        rerender(<PasteProgressBlock {...props} retryFailed={false} focusSignal={1} />);

        expect(document.activeElement).toBe(container.querySelector('[tabindex="-1"]'));
    });

    /** Plan open question 4: a refused Try again used to show nothing at all. */
    it('⛔ says so, in words, when Try again was refused — and nothing when it was not', () => {
        const props = { progress: progress(), onRetryParse: vi.fn(), onAddRestAsWritten: vi.fn(), focusSignal: 0 };
        const { rerender } = render(<PasteProgressBlock {...props} retryFailed={false} />);

        expect(screen.queryByText(recipeFormMessages.en.pasteRetryFailed)).toBeNull();

        rerender(<PasteProgressBlock {...props} retryFailed />);

        expect(screen.getByText(recipeFormMessages.en.pasteRetryFailed)).toBeTruthy();
    });
});
