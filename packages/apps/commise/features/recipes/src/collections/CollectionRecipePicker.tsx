/**
 * @module @commise/features-recipes — web collection recipe-picker frame (the ADD half of T072 / FR-009).
 *
 * The picker lists the caller's OWN recipes and adds them, one at a time, to a single named collection. This is its
 * FRAME — heading, Done and the search field — a controlled, presentational view that fetches nothing and stays
 * mounted around whichever body the composing app's read boundary renders: `CollectionRecipePickerCandidates` once
 * the candidates settle, or `CollectionRecipePickerLoading` / `CollectionRecipePickerLoadError` while they are
 * pending or failed. So the search field keeps its focus and value, and Done stays reachable, in every state.
 *
 * The two bare text controls (Done here, Retry in the load-error body) label in `ocean-dark`, not `seafoam`: seafoam
 * as a FOREGROUND is 4.02:1 on the white card and 3.57:1 under its own `hover:bg-seafoam/10` tint, both below the
 * 4.5:1 body-text floor. The tint itself stays seafoam — see the palette JSDoc in `@commise/ui` for that (single,
 * authoritative) accent-vs-text rule.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerProps } from './model.js';

/** The presentational picker frame: heading, Done and search, around the body the composing app renders. */
export const CollectionRecipePicker: FC<CollectionRecipePickerProps> = ({
    collectionName,
    query,
    onQueryChange,
    onDone,
    children,
}) => {
    const { picker } = useMessages(collectionMessages);
    const heading = fillTemplate(picker.heading, { name: collectionName });

    return (
        <section aria-label={heading} className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="font-display text-display-md font-bold text-charcoal">{heading}</h1>
                <button
                    type="button"
                    onClick={onDone}
                    className="rounded-full px-5 py-2.5 text-body-sm font-semibold text-ocean-dark transition hover:bg-seafoam/10"
                >
                    {picker.done}
                </button>
            </header>

            <label className="flex flex-col gap-1">
                <span className="text-body-sm font-medium text-slate">{picker.searchLabel}</span>
                <input
                    type="search"
                    value={query}
                    placeholder={picker.searchPlaceholder}
                    onChange={(event) => onQueryChange(event.target.value)}
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-body-md text-charcoal outline-none focus:ring-2 focus:ring-seafoam"
                />
            </label>

            {children}
        </section>
    );
};
