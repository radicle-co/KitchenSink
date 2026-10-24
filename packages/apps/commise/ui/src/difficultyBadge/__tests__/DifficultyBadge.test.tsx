// @vitest-environment jsdom
/**
 * The difficulty badge (web): a tint, a three-dot meter and the word (`docs/design/uiOverhaul/buildSpec.md` §1.4), so a
 * difficulty never rests on colour alone (SC 1.4.1). The tint and the word come from the `--color-difficulty-*`
 * variables the theme emits for both schemes, never from a palette class.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DifficultyBadge } from '../DifficultyBadge.js';
import { DIFFICULTY_METER, type DifficultyLevel } from '../props.js';

afterEach(cleanup);

describe('DifficultyBadge (web)', () => {
    it.each<[DifficultyLevel, number]>([
        ['easy', 1],
        ['medium', 2],
        ['hard', 3],
    ])('%s fills %i of the meter’s three dots', (level, filled) => {
        const { container } = render(<DifficultyBadge level={level}>Word</DifficultyBadge>);
        const dots = container.querySelectorAll('[data-meter-dot]');

        expect(DIFFICULTY_METER[level]).toBe(filled);
        expect(dots).toHaveLength(3);
        expect([...dots].filter((dot) => dot.getAttribute('data-meter-dot') === 'filled')).toHaveLength(filled);
    });

    it('says the word, and keeps the meter out of the accessibility tree', () => {
        const { container } = render(<DifficultyBadge level="medium">Medium</DifficultyBadge>);

        expect(screen.getByText('Medium').closest('[aria-hidden="true"]')).toBeNull();
        expect(container.querySelector('[data-meter-dot]')?.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it.each<DifficultyLevel>(['easy', 'medium', 'hard'])('draws %s from its own theme variables', (level) => {
        render(<DifficultyBadge level={level}>Word</DifficultyBadge>);
        const badge = screen.getByText('Word').parentElement;

        expect(badge?.className).toContain(`bg-difficulty-${level}-fill`);
        expect(badge?.className).toContain(`text-difficulty-${level}-ink`);
    });
});
