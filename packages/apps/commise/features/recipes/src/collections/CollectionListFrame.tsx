'use client';

/**
 * @module @commise/features-recipes — web collection-list FRAME (presentational).
 *
 * The chrome of the collection list — the heading and the create action — rendered OUTSIDE the list's suspense
 * boundary, which the composing container passes as `children`. A pending or failed read therefore swaps only what is
 * under the header, never the header itself. It fetches nothing.
 *
 * The heading takes focus when `headingFocusSignal` advances: a retry from the refresh notice (inside the boundary)
 * that succeeds removes the button the viewer pressed, and the container reports that across the boundary.
 */
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionListFrameProps } from './model.js';

export const CollectionListFrame: FC<CollectionListFrameProps> = ({ onCreate, headingFocusSignal, children }) => {
    const { list } = useMessages(collectionMessages);
    const headingRef = useFocusOnSignal<HTMLHeadingElement>(headingFocusSignal);

    return (
        <section aria-label={list.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            <header className="flex items-center justify-between gap-4">
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-display-md font-bold text-charcoal">
                    {list.heading}
                </h1>
                <button
                    type="button"
                    onClick={onCreate}
                    className="rounded-full bg-seafoam px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                >
                    {list.createCta}
                </button>
            </header>
            {children}
        </section>
    );
};
