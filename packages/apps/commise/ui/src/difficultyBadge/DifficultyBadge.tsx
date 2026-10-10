/**
 * @module @commise/ui/difficulty-badge — the web `DifficultyBadge`: a tint, a three-dot meter and the word.
 *
 * Its colours are the `--color-difficulty-{level}-*` variables `themeCss` emits for both schemes, so the badge
 * re-themes with the rest of the page and carries no palette class.
 *
 * @pattern Registry consumer — the level picks its tint and meter fill from closed `Record`s
 */
import type { FC } from 'react';

import { DIFFICULTY_METER, METER_DOTS, type DifficultyBadgeProps, type DifficultyLevel } from './props.js';

const LEVEL_CLASS: Readonly<Record<DifficultyLevel, string>> = {
    easy: 'bg-difficulty-easy-fill text-difficulty-easy-ink',
    medium: 'bg-difficulty-medium-fill text-difficulty-medium-ink',
    hard: 'bg-difficulty-hard-fill text-difficulty-hard-ink',
};

/**
 * A stated difficulty.
 *
 * @param props - The level and its word.
 * @returns The badge.
 */
export const DifficultyBadge: FC<DifficultyBadgeProps> = ({ level, children }) => (
    <span
        className={`inline-flex min-h-6 max-w-full shrink-0 items-center gap-1 rounded-sm px-2 py-0.5 text-caption font-medium ${LEVEL_CLASS[level]}`}
    >
        <span aria-hidden="true" className="inline-flex items-center gap-0.5">
            {Array.from({ length: METER_DOTS }, (_unused, index) => (
                <span
                    key={index}
                    data-meter-dot={index < DIFFICULTY_METER[level] ? 'filled' : 'empty'}
                    className={`size-1.5 rounded-full border border-current ${index < DIFFICULTY_METER[level] ? 'bg-current' : ''}`}
                />
            ))}
        </span>
        <span className="min-w-0 truncate">{children}</span>
    </span>
);
