/**
 * The native cooking surface: the screen's main landmark, busy while the recipe loads, with the top bar pinned at the top,
 * the foot pinned at the bottom (the Next preview above the actions), and ONLY the body between them scrolling, so a
 * focus line taller than the screen at the largest text never pushes the place, Back or Next away. The frame owns the
 * foot's layout, so the spacing between preview and actions lives in one place. One column, at most 680 wide, centred.
 */
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingFrame } from '../CookingFrame.native.js';
import { COOKING_COLUMN } from '../cookingLayout.js';

afterEach(cleanup);

/** A touch that starts on an element, moves left and lifts, through react-native-web's own responder system. */
function touchDrag(on: HTMLElement): void {
    const at = (x: number) => ({ identifier: 0, pageX: x, pageY: 300, clientX: x, clientY: 300, target: on });

    fireEvent.touchStart(on, { touches: [at(330)], changedTouches: [at(330)], timeStamp: 1 });
    fireEvent.touchMove(on, { touches: [at(60)], changedTouches: [at(60)], timeStamp: 2 });
    fireEvent.touchEnd(on, { touches: [], changedTouches: [at(60)], timeStamp: 3 });
}

const frame = (busy = false, withFoot = true, withPreview = true) => (
    <CookingFrame
        busy={busy}
        topBar={<Text>Top bar</Text>}
        body={<Text>Body</Text>}
        {...(withFoot
            ? { foot: { ...(withPreview ? { preview: <Text>Preview</Text> } : {}), actions: <Text>Actions</Text> } }
            : {})}
    />
);

describe('CookingFrame (native)', () => {
    it('is the main landmark, busy only while loading', () => {
        const { unmount } = render(frame(true));
        expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
        unmount();

        render(frame(false));
        expect(screen.getByRole('main').getAttribute('aria-busy')).not.toBe('true');
    });

    it('scrolls only the body, with the top bar above it and the foot below it, the preview above the actions', () => {
        render(frame());

        const scroll = screen.getByTestId('cooking-scroll');
        const top = screen.getByText('Top bar');
        const preview = screen.getByText('Preview');
        const actions = screen.getByText('Actions');

        expect(scroll.contains(screen.getByText('Body'))).toBe(true);
        expect(scroll.contains(top)).toBe(false);
        expect(scroll.contains(preview)).toBe(false);
        expect(scroll.contains(actions)).toBe(false);
        expect(top.compareDocumentPosition(scroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(scroll.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(preview.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("draws the foot's actions alone when there is no preview (the last step, Done)", () => {
        render(frame(false, true, false));

        expect(screen.getByText('Actions')).toBeTruthy();
        expect(screen.queryByText('Preview')).toBeNull();
    });

    it('draws no foot when it is handed none (a notice)', () => {
        render(frame(false, false));

        expect(screen.queryByText('Actions')).toBeNull();
    });

    // The swipe surface is the whole scrolling body, so a short step's empty space below it still takes a swipe; the top
    // bar and the foot stay out of it, so a drag across Back or Next is never read as a swipe.
    it('hands a drag in the body area to the body swipe, and none from the top bar or the foot', () => {
        const release = vi.fn();
        render(
            <CookingFrame
                busy={false}
                topBar={<Text>Top bar</Text>}
                body={<Text>Body</Text>}
                foot={{ actions: <Text>Actions</Text> }}
                bodySwipe={{ onMoveShouldSetResponder: () => true, onResponderRelease: release }}
            />,
        );

        touchDrag(screen.getByTestId('cooking-scroll'));
        expect(release).toHaveBeenCalledTimes(1);

        touchDrag(screen.getByText('Top bar'));
        touchDrag(screen.getByText('Actions'));
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('holds one centred column at most 680 wide', () => {
        render(frame());

        const column = screen.getByTestId('cooking-column');

        expect(getComputedStyle(column).maxWidth).toBe(`${String(COOKING_COLUMN.maxPx)}px`);
        expect(column.contains(screen.getByTestId('cooking-scroll'))).toBe(true);
    });

    describe('the ingredients column', () => {
        const withColumn = () =>
            render(
                <CookingFrame
                    busy={false}
                    topBar={<Text>Top bar</Text>}
                    body={<Text>Body</Text>}
                    foot={{ actions: <Text>Actions</Text> }}
                    column={<Text>Ingredients column</Text>}
                />,
            );

        it('puts the column beside the step stack, the top bar, body and foot all in the step slot', () => {
            withColumn();

            const slot = screen.getByTestId('cooking-step-slot');

            expect(
                screen.getByTestId('cooking-ingredients-slot').contains(screen.getByText('Ingredients column')),
            ).toBe(true);
            expect(slot.contains(screen.getByText('Top bar'))).toBe(true);
            expect(slot.contains(screen.getByText('Body'))).toBe(true);
            expect(slot.contains(screen.getByText('Actions'))).toBe(true);
        });

        it('draws no columns without a column', () => {
            render(frame());

            expect(screen.queryByTestId('cooking-columns')).toBeNull();
            expect(screen.getByTestId('cooking-column')).toBeTruthy();
        });
    });
});
