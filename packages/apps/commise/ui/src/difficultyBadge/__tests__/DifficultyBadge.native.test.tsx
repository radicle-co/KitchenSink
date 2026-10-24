/**
 * The difficulty badge (native): the same tint, meter and word as the web leaf, with its colours read from the theme at
 * render so the badge follows the system scheme (`docs/design/uiOverhaul/darkTheme.md` §7).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { formatRgb, wcagContrast } from 'culori';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { role, roleDark } from '../../tokens/colors.js';
import { difficultyTone, difficultyToneDark } from '../../tokens/tones.js';
import { DifficultyBadge } from '../DifficultyBadge.native.js';
import type { DifficultyLevel } from '../props.js';

/** The system colour scheme the next render sees. */
const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));

vi.mock('react-native', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-native')>()),
    useColorScheme: () => scheme.current,
}));

afterEach(() => {
    cleanup();
    scheme.current = null;
});

/** WCAG 2.2 SC 1.4.3, normal-size text. */
const AA_TEXT = 4.5;

const LEVELS: readonly DifficultyLevel[] = ['easy', 'medium', 'hard'];

describe('DifficultyBadge (native)', () => {
    it.each<[DifficultyLevel, number]>([
        ['easy', 1],
        ['medium', 2],
        ['hard', 3],
    ])('%s fills %i of three dots', (level, filled) => {
        const { container } = render(<DifficultyBadge level={level}>Word</DifficultyBadge>);
        const dots = container.querySelectorAll('[data-meter-dot]');

        expect(dots).toHaveLength(3);
        expect([...dots].filter((dot) => dot.getAttribute('data-meter-dot') === 'filled')).toHaveLength(filled);
    });

    it.each<['light' | 'dark', typeof difficultyTone, string]>([
        ['light', difficultyTone, role.paper],
        ['dark', difficultyToneDark, roleDark.paper],
    ])('paints its %s tones, and the word passes 4.5:1 over the tint on paper', (name, tones, paper) => {
        scheme.current = name;

        for (const level of LEVELS) {
            const { unmount } = render(<DifficultyBadge level={level}>Word</DifficultyBadge>);
            const word = screen.getByText('Word');

            expect(getComputedStyle(word).color, level).toBe(formatRgb(tones[level].text));
            expect(getComputedStyle(word.parentElement as HTMLElement).backgroundColor, level).toBe(
                formatRgb(tones[level].fill),
            );
            // The tint is translucent, so the word is judged against the paper it sits on (the tint only darkens or
            // lightens it slightly; the guard is the pair the badge is read against on a card).
            expect(wcagContrast(tones[level].text, paper), `${name} ${level}`).toBeGreaterThanOrEqual(AA_TEXT);
            unmount();
        }
    });
});
