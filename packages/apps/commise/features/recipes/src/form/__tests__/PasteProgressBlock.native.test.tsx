/**
 * Native component tests for `PasteProgressBlock` (plan 2026-10-15-011), rendered through react-native-web under
 * jsdom. Mirrors `PasteProgressBlock.test.tsx`; the focus move is the screen reader's (`useScreenReaderFocusOnSignal`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { PasteProgressBlock } from '../PasteProgressBlock.native.js';
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

describe('PasteProgressBlock (native)', () => {
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

    it('offers Try again for every retryable line, and Add the rest for two or more waiting lines', () => {
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

        fireEvent.click(screen.getByRole('button', { name: 'Try again for 2 lines' }));
        fireEvent.click(screen.getByRole('button', { name: 'Add the rest as written: 3 lines' }));

        expect(onRetryParse).toHaveBeenCalledTimes(1);
        expect(onAddRestAsWritten).toHaveBeenCalledTimes(1);
    });

    it('moves the screen reader to the block when the cook acted', () => {
        const props = { progress: progress(), onRetryParse: vi.fn(), onAddRestAsWritten: vi.fn() };
        const { rerender } = render(<PasteProgressBlock {...props} retryFailed={false} focusSignal={0} />);

        expect(focus.moved).not.toHaveBeenCalled();
        rerender(<PasteProgressBlock {...props} retryFailed={false} focusSignal={1} />);

        expect(focus.moved).toHaveBeenCalledTimes(1);
        expect(focus.moved.mock.calls[0]?.[1]).toBe('focus');
    });

    it('⛔ says so, in words, when Try again was refused — and nothing when it was not', () => {
        const props = { progress: progress(), onRetryParse: vi.fn(), onAddRestAsWritten: vi.fn(), focusSignal: 0 };
        const { rerender } = render(<PasteProgressBlock {...props} retryFailed={false} />);

        expect(screen.queryByText(recipeFormMessages.en.pasteRetryFailed)).toBeNull();

        rerender(<PasteProgressBlock {...props} retryFailed />);

        expect(screen.getByText(recipeFormMessages.en.pasteRetryFailed)).toBeTruthy();
    });
});
