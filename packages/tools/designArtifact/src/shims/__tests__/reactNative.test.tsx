// @vitest-environment jsdom
import { act, render, renderHook, screen } from '@testing-library/react';
import { createRef, type ReactElement } from 'react';
import type { TextInput as NativeTextInput } from 'react-native';
import * as ReactNativeWeb from 'react-native-web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as shim from '../reactNative.js';

const OVERRIDDEN = ['Platform', 'useColorScheme', 'AccessibilityInfo', 'Appearance', 'TextInput'] as const;
const shimNames: Record<string, unknown> = { ...shim };
const rnwNames: Record<string, unknown> = { ...ReactNativeWeb };
const upstream = Object.keys(rnwNames).filter((name) => name !== 'default' && name !== '__esModule');

afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
});

describe('react-native adapter surface', () => {
    it('exports every name react-native-web exports, so drift fails', () => {
        const missing = upstream.filter((name) => !(name in shimNames));

        expect(missing).toEqual([]);
    });

    it.each(upstream.filter((name) => !(OVERRIDDEN as readonly string[]).includes(name)))(
        'passes %s through untouched',
        (name) => {
            expect(shimNames[name]).toBe(rnwNames[name]);
        },
    );

    it.each(OVERRIDDEN)('replaces %s', (name) => {
        expect(shimNames[name]).not.toBe(rnwNames[name]);
    });
});

describe('Platform', () => {
    it('is ios', () => {
        expect(shim.Platform.OS).toBe('ios');
    });

    it('selects ios, then native, then default', () => {
        expect(shim.Platform.select({ ios: 'i', native: 'n', default: 'd' })).toBe('i');
        expect(shim.Platform.select({ native: 'n', default: 'd' })).toBe('n');
        expect(shim.Platform.select({ default: 'd' })).toBe('d');
        expect(shim.Platform.select({ android: 'a', default: 'd' })).toBe('d');
    });
});

describe('useColorScheme and Appearance', () => {
    const Scheme = (): ReactElement => <output>{shim.useColorScheme()}</output>;

    it('is light without a data-theme', () => {
        render(<Scheme />);

        expect(screen.getByRole('status').textContent).toBe('light');
        expect(shim.Appearance.getColorScheme()).toBe('light');
    });

    it('follows data-theme on the document element, both ways', async () => {
        render(<Scheme />);

        await act(async () => {
            document.documentElement.setAttribute('data-theme', 'dark');
            await Promise.resolve();
        });
        expect(screen.getByRole('status').textContent).toBe('dark');
        expect(shim.Appearance.getColorScheme()).toBe('dark');

        await act(async () => {
            document.documentElement.setAttribute('data-theme', 'light');
            await Promise.resolve();
        });
        expect(screen.getByRole('status').textContent).toBe('light');
    });

    it('reads dark at first render when the theme is already dark', () => {
        document.documentElement.setAttribute('data-theme', 'dark');
        const { result } = renderHook(() => shim.useColorScheme());

        expect(result.current).toBe('dark');
    });

    it('stops observing when the component unmounts', () => {
        const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
        const { unmount } = render(<Scheme />);
        expect(disconnect).not.toHaveBeenCalled();

        unmount();

        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('tells an Appearance listener about a theme change until it is removed', async () => {
        const listener = vi.fn();
        const subscription = shim.Appearance.addChangeListener(listener);

        await act(async () => {
            document.documentElement.setAttribute('data-theme', 'dark');
            await Promise.resolve();
        });
        expect(listener).toHaveBeenCalledWith({ colorScheme: 'dark' });

        subscription.remove();
        listener.mockClear();
        await act(async () => {
            document.documentElement.setAttribute('data-theme', 'light');
            await Promise.resolve();
        });
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('AccessibilityInfo', () => {
    it('does nothing for announcements and events', () => {
        expect(() => {
            shim.AccessibilityInfo.announceForAccessibility('x');
            shim.AccessibilityInfo.announceForAccessibilityWithOptions('x', { queue: true });
            shim.AccessibilityInfo.sendAccessibilityEvent(1 as never, 'focus');
            shim.AccessibilityInfo.setAccessibilityFocus(1);
        }).not.toThrow();
    });

    it('resolves reduce motion and screen reader as false', async () => {
        await expect(shim.AccessibilityInfo.isReduceMotionEnabled()).resolves.toBe(false);
        await expect(shim.AccessibilityInfo.isScreenReaderEnabled()).resolves.toBe(false);
    });

    it('returns a removable subscription from addEventListener', () => {
        const subscription = shim.AccessibilityInfo.addEventListener('screenReaderChanged', () => undefined);

        expect(() => subscription.remove()).not.toThrow();
    });
});

describe('TextInput multiline auto-grow', () => {
    const PAD = 16;
    const TEXT = 40;

    beforeEach(() => {
        // jsdom lays nothing out. A textarea's scrollHeight is the larger of its box and its content plus padding,
        // so it reports the natural height only when the box is collapsed to 0.
        vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function (this: Element) {
            const style = (this as HTMLElement).style;

            return style.height === '0px' ? TEXT + 2 * PAD : 400;
        });
    });

    const padded = (node: HTMLElement): void => {
        node.style.paddingTop = `${PAD}px`;
        node.style.paddingBottom = `${PAD}px`;
    };

    it('reports the text height alone, the way a device does', () => {
        render(<shim.TextInput multiline accessibilityLabel="Steps" />);
        const field = screen.getByRole('textbox', { name: 'Steps' });
        padded(field);

        expect(field.scrollHeight).toBe(TEXT);
    });

    it('collapses the box to measure and then restores the inline height it had', () => {
        render(<shim.TextInput multiline accessibilityLabel="Steps" />);
        const field = screen.getByRole('textbox', { name: 'Steps' });
        padded(field);
        field.style.height = '120px';

        void field.scrollHeight;

        expect(field.style.height).toBe('120px');
    });

    it('reaches a fixed point: a second read after growing returns the same height', () => {
        render(<shim.TextInput multiline accessibilityLabel="Steps" />);
        const field = screen.getByRole('textbox', { name: 'Steps' });
        padded(field);

        const first = field.scrollHeight;
        field.style.height = `${first + 2 * PAD}px`;

        expect(field.scrollHeight).toBe(first);
    });

    it('never goes below zero', () => {
        render(<shim.TextInput multiline accessibilityLabel="Steps" />);
        const field = screen.getByRole('textbox', { name: 'Steps' });
        field.style.paddingTop = '500px';

        expect(field.scrollHeight).toBe(0);
    });

    it('does not touch a textarea it did not render, nor the prototype', () => {
        render(<shim.TextInput multiline accessibilityLabel="Steps" />);
        const stranger = document.createElement('textarea');
        stranger.style.paddingTop = `${PAD}px`;

        expect(stranger.scrollHeight).toBe(400);
        expect(Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight')).toBeUndefined();
    });

    it('leaves a single-line field alone', () => {
        render(<shim.TextInput accessibilityLabel="Title" />);
        const field = screen.getByRole('textbox', { name: 'Title' });

        expect(Object.hasOwn(field, 'scrollHeight')).toBe(false);
    });

    it('still hands the host element to the caller ref, object and callback', () => {
        const objectRef = createRef<NativeTextInput>();
        const callback = vi.fn();
        const { rerender } = render(<shim.TextInput multiline accessibilityLabel="Steps" ref={objectRef} />);
        expect(objectRef.current).toBe(screen.getByRole('textbox', { name: 'Steps' }));

        rerender(<shim.TextInput multiline accessibilityLabel="Steps" ref={callback} />);

        expect(callback).toHaveBeenCalledWith(screen.getByRole('textbox', { name: 'Steps' }));
    });

    it('releases the caller ref on unmount', () => {
        const objectRef = createRef<NativeTextInput>();
        const { unmount } = render(<shim.TextInput multiline accessibilityLabel="Steps" ref={objectRef} />);

        unmount();

        expect(objectRef.current).toBeNull();
    });
});

describe('TextInput setSelection', () => {
    it.each<[string, boolean]>([
        ['a single-line field', false],
        ['a multiline field', true],
    ])('gives %s the device method, which selects through the DOM range', (_case, multiline) => {
        const ref = createRef<NativeTextInput>();
        render(<shim.TextInput multiline={multiline} accessibilityLabel="Name" defaultValue="Plain flour" ref={ref} />);
        const field = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement | HTMLTextAreaElement;

        ref.current?.setSelection(6, 11);

        expect([field.selectionStart, field.selectionEnd]).toEqual([6, 11]);
    });

    it('does not add the method to the element prototype', () => {
        render(<shim.TextInput accessibilityLabel="Name" />);

        expect('setSelection' in HTMLInputElement.prototype).toBe(false);
        expect('setSelection' in HTMLTextAreaElement.prototype).toBe(false);
    });
});
