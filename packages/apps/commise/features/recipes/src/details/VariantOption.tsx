'use client';

/**
 * @module details/VariantOption — one row of the details dialog's list, web (curated U14;
 * `docs/design/ingredientSpecialization.md` §S8.2 "Row", §S8.4).
 *
 * A presentational leaf, pure `props → JSX`: the parts, the `Current` word under them, and the calories at the end. Its accessible name
 * starts with that visible text (SC 2.5.3) and is built by the caller (`variantOptionName`), so the two platforms say
 * the same words.
 */
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { Icon } from '@commise/ui/icon';
import type { FC, KeyboardEvent } from 'react';

/** Props of one option. */
export interface VariantOptionProps {
    readonly id: string;
    readonly parts: readonly [string, ...string[]];
    /** The accessible name (`variantOptionName`). */
    readonly name: string;
    /** The visible calorie text. */
    readonly calories: string;
    /** Whether this is the line's current variant: a check glyph and the word `Current` (never colour alone). */
    readonly isCurrent: boolean;
    /** The word under a current row's parts. */
    readonly currentTag: string;
    /** Whether the list draws a check column: only when a LISTED row is current (§S8.2 "Check column"). */
    readonly hasCheckColumn: boolean;
    /** `aria-selected`: the current row in the short list, the active row in the long list (§S9). */
    readonly selected: boolean;
    /** The long list's keyboard-active row: the inset ring. */
    readonly active: boolean;
    /** Roving focus in the short list (`0` or `-1`); `undefined` in the long list, whose focus stays in the search. */
    readonly tabIndex: number | undefined;
    readonly onPick: () => void;
    readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
    /** The short list's roving tab stop follows the row that last took focus. */
    readonly onFocus?: () => void;
}

export const VariantOption: FC<VariantOptionProps> = ({
    id,
    parts,
    name,
    calories,
    isCurrent,
    currentTag,
    hasCheckColumn,
    selected,
    active,
    tabIndex,
    onPick,
    onKeyDown,
    onFocus,
}) => (
    <div
        id={id}
        role="option"
        aria-selected={selected}
        aria-label={name}
        tabIndex={tabIndex}
        onClick={onPick}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className={
            'flex min-h-12 cursor-pointer items-start gap-3 px-4 py-3 outline-none hover:bg-ink/6 focus-visible:bg-ink/6 ' +
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring ' +
            (active ? 'bg-surface-muted ring-2 ring-inset ring-focus-ring' : '')
        }
    >
        {hasCheckColumn && (
            <span aria-hidden="true" className="flex w-4 shrink-0 pt-1 text-action-text">
                {isCurrent && <Icon name="check" size={16} />}
            </span>
        )}
        <span className="flex min-w-0 flex-[1_1_12rem] flex-wrap items-baseline justify-between gap-x-3">
            <span className="flex min-w-0 flex-[1_1_12rem] flex-col">
                <VariantPartsLine parts={parts} tone="primary" />
                {isCurrent && <span className="text-caption font-semibold text-action-text">{currentTag}</span>}
            </span>
            <span className="ms-auto shrink-0 text-body-sm tabular-nums text-ink-muted">{calories}</span>
        </span>
    </div>
);
