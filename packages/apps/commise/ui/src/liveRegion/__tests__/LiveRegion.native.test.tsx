import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';

import { formatRgb } from 'culori';

import { VISUALLY_HIDDEN_GEOMETRY } from '../../accessibility/visuallyHidden.native.js';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { role } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';
import { LiveRegion } from '../LiveRegion.native.js';

/**
 * ⛔ ONE CHANNEL PER PLATFORM, NEVER BOTH. Android speaks a live region on its own; iOS has no live region, so
 * VoiceOver users heard nothing when a failure or a progress caption appeared. `LiveRegion` owns the choice so
 * no caller can forget iOS or make Android speak twice. `Platform.OS` and the announce API are mocked because
 * the react-native-web renderer is `'web'` and implements neither announcement channel.
 */
const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
        AccessibilityInfo: { ...actual.AccessibilityInfo, announceForAccessibilityWithOptions: vi.fn() },
    };
});

beforeEach(() => {
    platform.os = 'ios';
});

afterEach(() => {
    cleanup();
    vi.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
});

describe('LiveRegion (native)', () => {
    it('iOS: announces an ASSERTIVE message at once, and a polite one queued behind current speech', () => {
        render(<LiveRegion politeness="assertive">Could not create the food.</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith(
            'Could not create the food.',
            { queue: false },
        );

        cleanup();
        render(<LiveRegion politeness="polite">Creating…</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith('Creating…', {
            queue: true,
        });
    });

    it('iOS: announces again when the MESSAGE changes, and not on an unrelated re-render', () => {
        const { rerender } = render(<LiveRegion politeness="polite">Creating…</LiveRegion>);
        rerender(<LiveRegion politeness="polite">Creating…</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(1);

        rerender(<LiveRegion politeness="polite">Created.</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(2);
    });

    /**
     * A polite region waits behind OTHER speech, but not behind itself: five quick steps would otherwise queue
     * "3 servings… 4… 5… 6… 7" to be read long after the cook stopped. Its newer message supersedes its own
     * earlier one, which is what Android's live region does on its own.
     */
    it("iOS: a polite message that REPLACES the region's own previous message interrupts it instead of queueing", () => {
        const { rerender } = render(<LiveRegion politeness="polite">4 servings</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith('4 servings', {
            queue: true,
        });

        rerender(<LiveRegion politeness="polite">5 servings</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith('5 servings', {
            queue: false,
        });

        // Emptied and refilled, the region has nothing of its own to supersede, so it waits its turn again.
        rerender(<LiveRegion politeness="polite">{''}</LiveRegion>);
        rerender(<LiveRegion politeness="polite">Added Basil</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith('Added Basil', {
            queue: true,
        });
    });

    /**
     * An always-mounted region is EMPTY until there is something to say — Android needs the live region to exist
     * before its text changes — and an empty announcement is a VoiceOver blip that says nothing.
     */
    it('iOS: says nothing while the message is empty, and announces once it is filled', () => {
        const { rerender } = render(<LiveRegion politeness="polite">{''}</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).not.toHaveBeenCalled();

        rerender(<LiveRegion politeness="polite">Added Basil</LiveRegion>);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith('Added Basil', {
            queue: true,
        });
    });

    /**
     * Callers mount a region before it has anything to say, usually inside a `gap` layout — so the EMPTY region
     * must take no layout space (no blank row) while staying mounted, which Android's live region needs.
     */
    it('an EMPTY region stays mounted but out of the layout flow, and rejoins it once filled', () => {
        const { container, rerender } = render(
            <LiveRegion politeness="polite" style={{ marginTop: 4 }}>
                {''}
            </LiveRegion>,
        );
        const node = container.querySelector('[aria-live="polite"]') as HTMLElement;
        expect(getComputedStyle(node).position).toBe('absolute');

        rerender(
            <LiveRegion politeness="polite" style={{ marginTop: 4 }}>
                Added Basil
            </LiveRegion>,
        );
        expect(container.querySelector('[aria-live="polite"]')).toBe(node);
        expect(getComputedStyle(node).position).not.toBe('absolute');
        expect(getComputedStyle(node).marginTop).toBe('4px');

        // …and an empty ASSERTIVE region is not yet an alert, so it never counts among a screen's alerts.
        cleanup();
        render(<LiveRegion politeness="assertive">{''}</LiveRegion>);
        expect(screen.queryAllByRole('alert')).toEqual([]);
    });

    /**
     * A VISUALLY HIDDEN region says what the screen already shows another way (a stepper's count). iOS speaks it
     * through the announcement, so its node would only be a second, invisible VoiceOver stop reading the same
     * value; Android's live region IS the node, so there it must stay exposed or nothing is spoken at all.
     */
    it('visually hidden, iOS: stays out of the layout once filled, and out of the VoiceOver swipe order', () => {
        render(
            <LiveRegion politeness="polite" visuallyHidden>
                5 servings
            </LiveRegion>,
        );

        const node = screen.getByText('5 servings');
        expect(getComputedStyle(node).position).toBe('absolute');
        expect(node.getAttribute('aria-hidden')).toBe('true');
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith('5 servings', {
            queue: true,
        });
    });

    it('⛔ visually hidden, Android: stays EXPOSED — hiding the node would silence its live region', () => {
        platform.os = 'android';

        render(
            <LiveRegion politeness="polite" visuallyHidden>
                5 servings
            </LiveRegion>,
        );

        const node = screen.getByText('5 servings');
        expect(getComputedStyle(node).position).toBe('absolute');
        expect(node.getAttribute('aria-hidden')).toBeNull();
        expect(node.getAttribute('aria-live')).toBe('polite');
    });

    it('⛔ Android: NEVER announces imperatively — its live region already speaks, and both would speak twice', () => {
        platform.os = 'android';

        render(<LiveRegion politeness="assertive">Could not create the food.</LiveRegion>);

        expect(AccessibilityInfo.announceForAccessibilityWithOptions).not.toHaveBeenCalled();
    });

    it('renders its message as visible text carrying the live-region politeness', () => {
        render(<LiveRegion politeness="assertive">Could not create the food.</LiveRegion>);

        const node = screen.getByText('Could not create the food.');
        expect(node.getAttribute('aria-live')).toBe('assertive');
    });
});

describe('LiveRegion (native) — saying the same message again (R8, `occurrence`)', () => {
    const LIMIT = 'You’ve reached your limit for USDA lookups.';
    const regions = (container: HTMLElement): readonly string[] =>
        Array.from(container.querySelectorAll('[aria-live="assertive"]')).map((node) => node.textContent ?? '');

    it('iOS: each new occurrence of the same message is announced again, and a plain re-render is not', () => {
        const { rerender } = render(
            <LiveRegion politeness="assertive" occurrence={1}>
                {LIMIT}
            </LiveRegion>,
        );

        rerender(
            <LiveRegion politeness="assertive" occurrence={2}>
                {LIMIT}
            </LiveRegion>,
        );
        rerender(
            <LiveRegion politeness="assertive" occurrence={2}>
                {LIMIT}
            </LiveRegion>,
        );

        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(2);
        expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenLastCalledWith(LIMIT, { queue: false });
    });

    it('Android: the message moves to the other mounted region at each occurrence, a change from empty there', () => {
        platform.os = 'android';
        const { container, rerender } = render(
            <LiveRegion politeness="assertive" occurrence={1}>
                {LIMIT}
            </LiveRegion>,
        );

        expect(regions(container)).toEqual([LIMIT, '']);

        rerender(
            <LiveRegion politeness="assertive" occurrence={2}>
                {LIMIT}
            </LiveRegion>,
        );

        expect(regions(container)).toEqual(['', LIMIT]);
    });

    it('without an occurrence it is one region, as before', () => {
        const { container } = render(<LiveRegion politeness="assertive">{LIMIT}</LiveRegion>);

        expect(regions(container)).toEqual([LIMIT]);
    });
});

/**
 * A region that names its TYPE ROLE and colour (ADR-0080 §8): it is the design-system Text, so it grows with the system
 * scale, size and leading together, up to the 2× cap, and its tone is a literal theme token the colour guard reads. The old
 * `style` region stays for callers not yet ported, and the two are exclusive in the type.
 */
describe('LiveRegion (native) — a region in a type role', () => {
    it('draws its message in its role and colour, as a live region', () => {
        renderWithTamagui(
            <LiveRegion politeness="polite" typeRole="caption" tone="inkMuted">
                Saving…
            </LiveRegion>,
            'light',
        );

        const node = screen.getByText('Saving…');

        expect(getComputedStyle(node).fontSize).toBe(`${String(nativeTokens.type.caption.fontSize)}px`);
        expect(resolvedColour(node, 'color')).toBe(formatRgb(role.inkMuted));
        expect(node.getAttribute('aria-live')).toBe('polite');
    });

    it('is ink when no tone is named', () => {
        renderWithTamagui(
            <LiveRegion politeness="assertive" typeRole="body">
                Could not save.
            </LiveRegion>,
            'light',
        );

        expect(resolvedColour(screen.getByText('Could not save.'), 'color')).toBe(formatRgb(role.ink));
    });

    it('draws a failure in dangerText', () => {
        renderWithTamagui(
            <LiveRegion politeness="assertive" typeRole="body" tone="dangerText">
                Could not save.
            </LiveRegion>,
            'light',
        );

        expect(resolvedColour(screen.getByText('Could not save.'), 'color')).toBe(formatRgb(role.dangerText));
    });

    it('grows its size and leading to 2× above the cap', () => {
        const { fontSize, lineHeight } = nativeTokens.type.body;

        renderWithTamagui(
            <LiveRegion politeness="polite" typeRole="body">
                Added Basil
            </LiveRegion>,
            'light',
            3.1,
        );

        expect(getComputedStyle(screen.getByText('Added Basil')).fontSize).toBe(`${String(fontSize * 2)}px`);
        expect(getComputedStyle(screen.getByText('Added Basil')).lineHeight).toBe(`${String(lineHeight * 2)}px`);
    });

    // The `offFlow` variant restates `VISUALLY_HIDDEN_GEOMETRY` as a literal for the style guards, so this holds the
    // two equal: a change to either one alone fails here.
    it('stays mounted but leaves the layout flow by the one visually-hidden geometry while empty', () => {
        const { container } = renderWithTamagui(
            <LiveRegion politeness="polite" typeRole="body">
                {''}
            </LiveRegion>,
            'light',
        );

        const node = container.querySelector('[aria-live="polite"]') as HTMLElement;

        // Read from the constant's own keys, so a key added to it fails here until the variant carries it too.
        // `Object.keys` widens to `string[]`; these are the constant's own keys, every one a style property.
        const keys = Object.keys(VISUALLY_HIDDEN_GEOMETRY) as (keyof typeof VISUALLY_HIDDEN_GEOMETRY)[];
        const expected = (key: (typeof keys)[number]): string => {
            const value = VISUALLY_HIDDEN_GEOMETRY[key];

            return typeof value === 'number' ? `${String(value)}px` : value;
        };

        expect(Object.fromEntries(keys.map((key) => [key, resolvedStyle(node, key)]))).toEqual(
            Object.fromEntries(keys.map((key) => [key, expected(key)])),
        );
    });
});
