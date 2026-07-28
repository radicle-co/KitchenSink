'use client';

/**
 * @module @commise/features-recipes/form/ChipInput — web token (chip) input for the recipe form's tags +
 * dietary-flags fields (U6). Replaces the old single comma-separated `<input>` (`values.tags.join(', ')` →
 * `parseCommaList`) that re-parsed the whole string on every keystroke — a UX bug on web too: a comma inside a
 * tag split it, and the value round-tripped as raw text rather than discrete tokens.
 *
 * Controlled + presentational: the committed chips live in the form's `values` (the single source of truth);
 * only the in-progress DRAFT text is local UI state. Each entry commits ONE chip via the pure {@link addChip}
 * (trim + case-insensitive de-dupe), on Enter or comma; Backspace on an empty draft removes the last chip
 * (standard token-field affordance); every chip carries its own labelled remove control. No comma parsing —
 * a comma is a commit key, never split into the token. The native leaf is {@link
 * import('./ChipInput.native.js').ChipInput}; the two share this contract so the platforms cannot drift.
 */
import type { FC, KeyboardEvent } from 'react';
import { useState } from 'react';

import { fillTemplate } from '../list/model.js';
import { addChip, removeChipAt } from './props.js';

/** Props for {@link ChipInput}. */
export interface ChipInputProps {
    /** The field's visible + accessible label (also the text input's accessible name — e.g. "Tags"). */
    readonly label: string;
    /** The committed chips (from the form's `values`). */
    readonly values: readonly string[];
    /** Called with the next chip list on every add or remove. */
    readonly onChange: (next: string[]) => void;
    /** Placeholder shown in the draft text input (the type-and-enter hint). */
    readonly placeholder: string;
    /** Accessible-label template for a chip's remove control (contains `{value}`). */
    readonly removeChipLabel: string;
}

const fieldLabel = 'text-body-sm font-medium text-slate';
// `min-w-0 break-words` + the remove control's `shrink-0` are one contract: a long tag yields (and breaks)
// rather than squeezing out the only affordance that can remove it. The native leaf carries the same contract
// as `flexShrink: 1` / `flexShrink: 0` — see `ChipInput.native.tsx`.
// Contrast (WCAG 2.1 AA): the chip's tint stays seafoam; its READABLE parts — the tag label and the `×` remove
// glyph (a text glyph, not an icon) — take `ocean-dark`. See `@commise/ui`'s palette JSDoc for the one
// authoritative statement of which seafoam sites are accents and which are text.
const chip =
    'inline-flex min-w-0 items-center gap-1 break-words rounded-full bg-seafoam/10 py-1 pl-3 pr-1 text-body-sm font-medium text-ocean-dark';
// The hover tint is `/15`, not `/20`, because it STACKS on the chip's own `/10`: `seafoam/20` over `seafoam/10`
// composites to #c8dedd, where even `ocean-dark` is only 4.41:1 — a hover-only AA failure. `/15` composites to
// #d1e4e3 (4.70:1) and still reads as a deepening of the disc. The focus ring stays `seafoam-light`: a focus
// indicator is a 3:1 graphic, not text.
const chipRemove =
    'flex size-5 shrink-0 items-center justify-center rounded-full text-ocean-dark transition hover:bg-seafoam/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seafoam-light';
const chipField =
    'flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal focus-within:ring-2 focus-within:ring-seafoam-light';
const chipDraft = 'min-w-24 flex-1 border-none bg-transparent p-0 text-body-md text-charcoal outline-none';

/**
 * The web tag/dietary-flag chip input.
 *
 * @param props - The label, the committed chips, the change handler, the placeholder, and the remove-label
 *   template.
 * @returns The labelled chip row plus the draft text input.
 */
export const ChipInput: FC<ChipInputProps> = ({ label, values, onChange, placeholder, removeChipLabel }) => {
    const [draft, setDraft] = useState('');

    const commit = (): void => {
        const next = addChip(values, draft);

        // Only emit when the token actually added a chip (blank/duplicate draft is a no-op); always clear the
        // draft so a duplicate entry doesn't leave stale text behind.
        if (next.length !== values.length) {
            onChange(next);
        }

        setDraft('');
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter' || event.key === ',') {
            // A comma is a COMMIT key here, never a separator folded into the token (that was the old bug).
            event.preventDefault();
            commit();
        } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
            onChange(removeChipAt(values, values.length - 1));
        }
    };

    return (
        <label className="flex flex-col gap-1">
            <span className={fieldLabel}>{label}</span>
            <span className={chipField}>
                {values.map((value, index) => (
                    <span key={value} className={chip}>
                        {value}
                        <button
                            type="button"
                            aria-label={fillTemplate(removeChipLabel, { value })}
                            onClick={() => onChange(removeChipAt(values, index))}
                            className={chipRemove}
                        >
                            <span aria-hidden="true">×</span>
                        </button>
                    </span>
                ))}
                <input
                    type="text"
                    aria-label={label}
                    placeholder={placeholder}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    onBlur={commit}
                    className={chipDraft}
                />
            </span>
        </label>
    );
};
