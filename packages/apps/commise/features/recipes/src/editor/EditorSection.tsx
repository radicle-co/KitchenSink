'use client';

/**
 * @module @commise/features-recipes/editor — one editor section (build spec §7.1, §7.10): a region named by its H2, the
 * heading row with the section's own controls at its end, then the body.
 *
 * The H2's id is the section's id (`sections.ts`), which is what the section index links to, the hash names and the
 * page's `ScrollHost` jumps to; it carries `tabIndex={-1}` so a jump can move focus to it, and a scroll margin that
 * keeps it clear of the sticky chrome (the header, and below 960 the index strip or bar).
 *
 * It tells the leaves inside whether it is the section the cook is in (`sectionPresence.ts`).
 *
 * Presentational: props → JSX.
 */
import type { FC } from 'react';

import type { EditorSectionProps } from './frameProps.js';
import { SectionPresenceContext } from './sectionPresence.js';

/** One section of the web editor. */
export const EditorSection: FC<EditorSectionProps> = ({ id, title, action, current, children }) => (
    <section aria-labelledby={id} className="flex flex-col gap-4">
        <div className="flex min-h-11 items-center justify-between gap-2">
            <h2
                id={id}
                tabIndex={-1}
                className="scroll-mt-32 text-section-title text-ink focus:outline-none @wide/main:scroll-mt-20"
            >
                {title}
            </h2>
            {action}
        </div>
        <SectionPresenceContext value={current}>{children}</SectionPresenceContext>
    </section>
);
