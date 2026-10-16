/**
 * The native `ScrollHost`, the field reveal host and a real `Input` together (`docs/design/uiOverhaul/specSharedSystem.md`
 * §16.3): a screen names a field by id, the field is centred, and the screen-reader cursor moves to it, once per call,
 * with the keyboard left down. The unit tests of each part pass their neighbour's half of this by hand; this one
 * passes it through the real parts. Only the native layout (`measureField`, `scrollContentTo`) is scripted, because
 * react-native-web has none.
 */
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, type FC } from 'react';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({
    /** Every scroll, the section's and the field's, in the order they happened. */
    scrolls: [] as { readonly by: 'section' | 'field'; readonly y: number }[],
}));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});
vi.mock('../../motion/useReduceMotion.native.js', () => ({ useReduceMotion: () => false }));
vi.mock('../../fieldReveal/measureField.native.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../fieldReveal/measureField.native.js')>();

    return {
        ...actual,
        measureField: () => Promise.resolve({ top: 300, height: 48, offset: 100 }),
        scrollContentTo: (_scroller: unknown, y: number) => {
            seam.scrolls.push({ by: 'field', y });
        },
    };
});

import { FieldRevealContext } from '../../fieldReveal/fieldRevealContext.js';
import { isRevealScroller, type RevealScroller } from '../../fieldReveal/measureField.native.js';
import { useFieldRevealHost } from '../../fieldReveal/useFieldRevealHost.native.js';
import { Input } from '../../input/Input.native.js';
import type { ScrollBind, ScrollHostApi } from '../props.js';
import { ScrollHost } from '../ScrollHost.native.js';
import { useScrollHost } from '../scrollHostContext.js';

const seen: { bind?: ScrollBind; api?: ScrollHostApi; viewport?: (height: number) => void } = {};

/** What a screen does: its scroller's handle goes to the reveal host, and the reveal host's revealer goes to its fields. */
const Screen: FC = () => {
    const api = useScrollHost();
    const { handle } = api;
    const reveal = useFieldRevealHost({
        current: handle.current !== null && isRevealScroller(handle.current) ? handle.current : null,
    });
    const { onViewportLayout } = reveal;

    // The test drives the screen from outside: it reads the host's API and reports the visible area.
    useEffect(() => {
        seen.api = api;

        seen.viewport = (height) => {
            onViewportLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } } as never);
        };
    });

    return (
        <FieldRevealContext.Provider value={reveal.revealer}>
            <Input id="title" label="Title" value="" onChangeText={vi.fn()} />
        </FieldRevealContext.Provider>
    );
};

beforeEach(() => {
    seam.scrolls = [];
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

afterEach(cleanup);

/** Mount the screen with a scroller whose `scrollTo` is recorded, and a laid-out visible area. */
async function mount() {
    const scrollView: RevealScroller & { scrollTo: ReturnType<typeof vi.fn> } = {
        getNativeScrollRef: () => null,
        scrollTo: vi.fn((to: { y?: number }) => {
            seam.scrolls.push({ by: 'section', y: to.y ?? 0 });
        }),
    };

    render(
        <ScrollHost sections={['details', 'steps']}>
            {(bind) => {
                seen.bind = bind;

                return <Screen />;
            }}
        </ScrollHost>,
    );
    await act(async () => {
        seen.bind?.ref(scrollView);
        seen.api?.sectionLayout('details')({ nativeEvent: { layout: { y: 0, height: 500 } } } as never);
        seen.api?.sectionLayout('steps')({ nativeEvent: { layout: { y: 500, height: 900 } } } as never);
        seen.viewport?.(400);
        await Promise.resolve();
    });

    return scrollView;
}

const input = (): HTMLInputElement => {
    const node = document.querySelector('input');

    if (node === null) {
        throw new Error('no input');
    }

    return node;
};

describe('ScrollHost + field reveal host + Input (native) — naming a field', () => {
    it('moves the screen-reader cursor to the field once per call, and never takes keyboard focus', async () => {
        const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
        await mount();

        await act(async () => {
            seen.api?.scrollToField('title');
            await Promise.resolve();
        });

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledExactlyOnceWith(input(), 'focus');

        await act(async () => {
            seen.api?.scrollToField('title');
            await Promise.resolve();
        });

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(2);
        expect(focus).not.toHaveBeenCalled();
        focus.mockRestore();
    });

    it('centres the field after the section jump, and the field’s scroll is the last one', async () => {
        await mount();

        await act(async () => {
            seen.api?.scrollToSection('steps');
            seen.api?.scrollToField('title');
            await Promise.resolve();
        });

        // The section jump scrolls to its line (500); the field's own centring (100 + 300 + 24 - 200) comes last.
        expect(seam.scrolls).toEqual([
            { by: 'section', y: 500 },
            { by: 'field', y: 224 },
        ]);
        expect(seen.api?.current).not.toBe('steps');
    });

    it('does not jump to a section whose layout arrives after the field was named', async () => {
        const scrollView = await mount();
        scrollView.scrollTo.mockClear();
        seam.scrolls = [];

        await act(async () => {
            seen.api?.scrollToSection('later');
            seen.api?.scrollToField('title');
            await Promise.resolve();
        });
        seam.scrolls = [];
        act(() => {
            seen.api?.sectionLayout('later')({ nativeEvent: { layout: { y: 1800, height: 300 } } } as never);
        });

        expect(seam.scrolls).toEqual([]);
    });
});
