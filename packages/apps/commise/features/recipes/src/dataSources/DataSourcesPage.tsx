'use client';

/**
 * @module @commise/features-recipes/dataSources — web Data sources PAGE frame (presentational; plan R55, design §S16).
 *
 * The page's heading and its two intro sentences, rendered OUTSIDE the read's boundary, which the composing route
 * passes as `children`. So a loading, failed or offline read swaps only what is under the intro, and the page never
 * loses its title. One column, at most 40rem wide and centred, at every width. The heading takes focus when
 * `headingFocusSignal` advances: a retry that took Try again away.
 */
import { useMessages } from '@commise/i18n/react';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import type { FC } from 'react';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesPageProps } from './model.js';

/**
 * The page frame: its heading and two intro sentences, then the read's state.
 *
 * @param props - The read's state, rendered below the intro, and when the heading takes focus.
 * @returns The page frame.
 */
export const DataSourcesPage: FC<DataSourcesPageProps> = ({ children, headingFocusSignal }) => {
    const messages = useMessages(dataSourcesMessages);
    const headingRef = useFocusOnSignal<HTMLHeadingElement>(headingFocusSignal);

    return (
        <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-4 px-4 py-8">
            <div className="flex flex-col gap-2">
                <h1 ref={headingRef} tabIndex={-1} className="font-display text-display-md font-bold text-charcoal">
                    {messages.title}
                </h1>
                <p className="text-body-md text-charcoal">{messages.intro}</p>
                <p className="text-body-md text-slate">{messages.closeMatchNote}</p>
            </div>
            {children}
        </div>
    );
};
