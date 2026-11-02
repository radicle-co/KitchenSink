/**
 * KeyboardLift (native) — pads a window-high frame's content by the part of its BOTTOM EDGE the keyboard covers, measured in
 * window coordinates against the keyboard's own top.
 *
 * Device gate (Android): `KeyboardAvoidingView` adds its padding from its frame READ RELATIVE TO ITS PARENT, so inside the
 * Sheet's transformed engine frame it fell short and the panel's action ("Create collection", "Done") stayed behind the
 * keyboard, 78 and 88 px under its top. The lift measures where the box really ends and subtracts where the keyboard
 * really starts, so no offset between the two coordinate spaces can leave the foot behind it.
 *
 * ⚠️ jsdom has no keyboard and no layout: `Keyboard` is a recorded double and `getBoundingClientRect` is stubbed, which is
 * what react-native-web's `measureInWindow` reads.
 */
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { KeyboardLift } from '../KeyboardLift.native.js';

type KeyboardListener = (event: {
    readonly endCoordinates: { readonly screenY: number; readonly height: number };
}) => void;

const keyboard = vi.hoisted(() => ({
    listeners: new Map<string, (event: unknown) => void>(),
    visible: false,
    metrics: undefined as { screenY: number; height: number } | undefined,
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: { ...actual.Platform, OS: 'android' },
        Keyboard: {
            ...actual.Keyboard,
            isVisible: () => keyboard.visible,
            metrics: () => keyboard.metrics,
            addListener: (name: string, listener: (event: unknown) => void) => {
                keyboard.listeners.set(name, listener);

                return { remove: () => keyboard.listeners.delete(name) };
            },
        },
    };
});

/** The box ends at `bottom` in window coordinates. */
function boxEndsAt(bottom: number, height = 800): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: bottom - height,
        top: bottom - height,
        left: 0,
        width: 390,
        height,
        right: 390,
        bottom,
        toJSON: () => ({}),
    });
}

const shows = (screenY: number, height = 2400 - screenY): void => {
    const listener = keyboard.listeners.get('keyboardDidShow') as KeyboardListener | undefined;

    act(() => listener?.({ endCoordinates: { screenY, height } }));
};

const hides = (): void => {
    act(() => keyboard.listeners.get('keyboardDidHide')?.({}));
};

/** The padding the lift put under its content, read from the element that holds the content. */
const padding = (): string => resolvedStyle(screen.getByText('Foot').parentElement as HTMLElement, 'paddingBottom');

/**
 * The lane runs Tamagui's web build, whose `measureInWindow` reads a node's rectangle through an `IntersectionObserver`,
 * which jsdom lacks. The double answers with the node's bounding rectangle, the same measurement.
 */
class RectObserver {
    private readonly report: (
        entries: readonly { readonly boundingClientRect: DOMRect; readonly target: Element }[],
    ) => void;

    public constructor(
        report: (entries: readonly { readonly boundingClientRect: DOMRect; readonly target: Element }[]) => void,
    ) {
        this.report = report;
    }

    public observe(node: Element): void {
        this.report([{ boundingClientRect: node.getBoundingClientRect(), target: node }]);
    }

    public disconnect(): void {}
}

beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', RectObserver);
    keyboard.listeners.clear();
    keyboard.visible = false;
    keyboard.metrics = undefined;
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const renderLift = (topInset = 0, bottomInset = 0): void => {
    render(
        <KeyboardLift topInset={topInset} bottomInset={bottomInset}>
            <Text>Foot</Text>
        </KeyboardLift>,
    );
};

describe('KeyboardLift (native)', () => {
    it('pads by nothing while no keyboard is up', async () => {
        boxEndsAt(2400);
        renderLift();

        await waitFor(() => expect(padding()).toMatch(/^(0px|)$/u));
    });

    it('pads the content up by the distance from the keyboard top to the box’s bottom edge, whatever the box’s offset', async () => {
        // The box ends 120 px above the screen's foot (an offset the old arithmetic did not see): the keyboard top is at
        // 1389, so the foot must rise 1500 - 1389 = 111 px, not the keyboard's whole height of 1011.
        boxEndsAt(1500);
        renderLift();
        shows(1389);

        await waitFor(() => expect(padding()).toBe('111px'));
        void 0;
    });

    it('pads by the keyboard’s whole height when the box ends at the foot of the screen', async () => {
        boxEndsAt(2400);
        renderLift();
        shows(1389);

        await waitFor(() => expect(padding()).toBe('1011px'));
    });

    it('never pads by more than the keyboard is tall, even when the box is measured past the screen', async () => {
        // The Android regression: the whole panel vanished behind the scrim with the keyboard up. A bottom edge read at
        // 4800 (twice the screen) must not become a 3411 px lift; the keyboard covers at most its own 1011 px.
        boxEndsAt(4800);
        renderLift();
        shows(1389);

        await waitFor(() => expect(padding()).toBe('1011px'));
    });

    // Device case (Android, Pixel 6, dp): the window is 866.28 tall, the keyboard 288.38 tall with its top at 577.90, and the
    // status bar is 48.76. The frame is the whole window, so the room for the panel is the keyboard's top minus the status
    // bar: 529.14. The lift takes the keyboard off the foot and the status bar off the head, and what is left is that room.
    // Pixel 6 (dp), measured on a device with the panel's foot under the keyboard: the window is 914.29 tall, the status bar
    // 48.76 and the navigation bar 48. React Native's Android keyboard `height` (288.38) EXCLUDES the navigation bar, which
    // the translucent window extends under, and the keyboard's top is 577.90. The foot must rise 914.29 - 577.90 = 336.39 (288.38 + 48):
    // the keyboard's height plus the navigation bar. A cap at the height alone left Create 32 dp under the keyboard.
    it('lifts by the keyboard’s height plus the navigation bar the window extends under, so the foot clears the keyboard top', async () => {
        boxEndsAt(914.29, 914.29);
        renderLift(48.76, 48);
        shows(577.9, 288.38);

        await waitFor(() => expect(padding()).toBe('336.38px'));
        expect(914.29 - Number.parseFloat(padding())).toBeCloseTo(577.9, 1);
    });

    it('still never lifts further than the keyboard plus the navigation bar, whatever the measured bottom', async () => {
        boxEndsAt(10914.29, 914.29);
        renderLift(48.76, 48);
        shows(577.9, 288.38);

        await waitFor(() => expect(padding()).toBe('336.38px'));
    });

    it('leaves the panel exactly the room between the status bar and the keyboard', async () => {
        boxEndsAt(865.52, 865.52);
        renderLift(48.76);
        shows(577.9, 288.38);

        await waitFor(() => expect(padding()).toBe('287.62px'));

        const frame = screen.getByText('Foot').parentElement as HTMLElement;
        const room =
            865.52 -
            Number.parseFloat(resolvedStyle(frame, 'paddingBottom')) -
            Number.parseFloat(resolvedStyle(frame, 'paddingTop'));

        expect(resolvedStyle(frame, 'paddingTop')).toBe('48.76px');
        expect(room).toBeCloseTo(577.9 - 48.76, 1);
    });

    it('lets the foot go again when the keyboard hides', async () => {
        boxEndsAt(2400);
        renderLift();
        shows(1389);
        await waitFor(() => expect(padding()).toBe('1011px'));

        hides();

        await waitFor(() => expect(padding()).toMatch(/^(0px|)$/u));
    });

    it('pads by nothing when the keyboard top is below the box’s bottom edge', async () => {
        boxEndsAt(1000);
        renderLift();
        shows(1389);

        await waitFor(() => expect(padding()).toMatch(/^(0px|)$/u));
    });

    it('lifts a sheet that opens with the keyboard already up', async () => {
        keyboard.visible = true;
        keyboard.metrics = { screenY: 1389, height: 1011 };
        boxEndsAt(2400);
        renderLift();

        await waitFor(() => expect(padding()).toBe('1011px'));
    });
});
