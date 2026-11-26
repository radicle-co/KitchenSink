/**
 * Native tests for the caption under a paste control (ADR-0089), through react-native-web under jsdom. Mirrors
 * `PastedSourceNotice.test.tsx`.
 */
import { fireEvent } from '@testing-library/dom';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { render } from '@commise/ui/testing/tamagui';
import { FieldRevealContext, type FieldRevealer } from '@commise/ui/field-reveal';
import { ScrollHost } from '@commise/ui/scroll-host';
import { editorMessages } from '../../editor/messages.js';
import { PastedSourceNotice } from '../PastedSourceNotice.native.js';

const focus = vi.hoisted(() => ({ moved: vi.fn() }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: focus.moved } };
});

afterEach(() => {
    cleanup();
    focus.moved.mockClear();
});

const TEXT = 'Source set to allrecipes.com. This recipe will be private.';

describe('PastedSourceNotice (native)', () => {
    it('says what the paste did, and offers Remove when it can be undone', () => {
        const onRemove = vi.fn();
        render(<PastedSourceNotice text={TEXT} onRemove={onRemove} />);

        expect(screen.getByText(TEXT)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: editorMessages.en.source.snackRemove }));

        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('offers no Remove for a note with nothing to undo', () => {
        render(<PastedSourceNotice text="Left out a Commise link. It isn’t a source." />);

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('moves the screen reader to the notice when the host advances its signal', () => {
        const { rerender } = render(<PastedSourceNotice text={TEXT} focusSignal={0} />);

        expect(focus.moved).not.toHaveBeenCalled();
        rerender(<PastedSourceNotice text={TEXT} focusSignal={1} />);

        expect(focus.moved).toHaveBeenCalledTimes(1);
        expect(focus.moved.mock.calls[0]?.[1]).toBe('focus');
    });

    it('shows nothing while it has no text, and takes the cursor when the first refusal brings its text', () => {
        const { container, rerender } = render(<PastedSourceNotice text="" focusSignal={0} />);

        expect(container.textContent).toBe('');
        rerender(<PastedSourceNotice text={TEXT} focusSignal={1} />);

        expect(screen.getByText(TEXT)).toBeTruthy();
        expect(focus.moved).toHaveBeenCalledTimes(1);
    });

    describe('inside a scroll host', () => {
        const renderInHost = (reveal: FieldRevealer, signal: number): ReturnType<typeof render> =>
            render(
                <FieldRevealContext.Provider value={reveal}>
                    <ScrollHost>{() => <PastedSourceNotice text={TEXT} focusSignal={signal} />}</ScrollHost>
                </FieldRevealContext.Provider>,
            );

        it('scrolls itself into view when the host advances its signal, and not when it mounts', () => {
            const reveal = vi.fn<FieldRevealer>(() => () => undefined);
            const { rerender } = renderInHost(reveal, 0);

            expect(reveal).not.toHaveBeenCalled();
            rerender(
                <FieldRevealContext.Provider value={reveal}>
                    <ScrollHost>{() => <PastedSourceNotice text={TEXT} focusSignal={1} />}</ScrollHost>
                </FieldRevealContext.Provider>,
            );

            expect(reveal).toHaveBeenCalledTimes(1);
            expect(reveal.mock.calls[0]?.[0].kind).toBe('nearest');
        });
    });
});
