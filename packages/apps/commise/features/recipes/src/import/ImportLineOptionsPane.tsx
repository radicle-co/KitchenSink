'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineOptionsPane` (web): a flagged line's options beside the list at
 * the wide container class (board FlaggedLine, 1194 and web). A region headed by the line and its recipe, then the same
 * list the sheet shows (`ImportLineOptions`), search first.
 *
 * Presentational and controlled. The native leaf is `./ImportLineOptionsPane.native.tsx`.
 */
import { useId, type FC } from 'react';

import { ImportLineOptions } from './ImportLineOptions.js';
import type { ImportLineOptionsPaneProps } from './props.js';

/** A flagged line's options, as a pane. */
export const ImportLineOptionsPane: FC<ImportLineOptionsPaneProps> = ({ title, ...options }) => {
    const headingId = useId();

    return (
        <section
            aria-labelledby={headingId}
            className="flex flex-col gap-3 rounded-lg border border-line-divider bg-paper p-4"
        >
            <h2 id={headingId} className="break-words text-section-title text-ink">
                {title}
            </h2>
            <ImportLineOptions {...options} />
        </section>
    );
};
