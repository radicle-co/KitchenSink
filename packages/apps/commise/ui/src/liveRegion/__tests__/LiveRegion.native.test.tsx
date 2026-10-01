import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccessibilityInfo } from 'react-native';

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
