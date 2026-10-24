'use client';

/**
 * @module @commise/features-recipes/dataSources — web Data sources PAGE frame (presentational; plan R55, design §S16).
 *
 * The page's heading and its two intro sentences, rendered OUTSIDE the read's boundary, which the composing route
 * passes as `children`. So a loading, failed or offline read swaps only what is under the intro, and the page never
 * loses its title. One column, the `reading` width, at every width; Back goes to Profile (`buildSpec.md` §9.2). The heading takes focus when
 * `headingFocusSignal` advances: a retry that took Try again away.
 *
 * With a way back the page sits in the design system's `PushedPageFrame`, so Back is pinned in a bar below 840 and the
 * header's own eyebrow carries it from 840 (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6). Without one there is
 * nowhere to go back to, so there is no bar and no frame.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { PushedPageFrame } from '@commise/ui/pushed-page';
import { useId, type FC } from 'react';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesPageWebProps } from './model.js';

/**
 * The page frame: its heading and two intro sentences, then the read's state.
 *
 * @param props - The read's state, rendered below the intro, and when the heading takes focus.
 * @returns The page frame.
 */
export const DataSourcesPage: FC<DataSourcesPageWebProps> = ({ children, headingFocusSignal, back }) => {
    const messages = useMessages(dataSourcesMessages);
    const headingId = useId();

    const page = (
        <div className="mx-auto flex w-full max-w-reading flex-col gap-4 pb-10">
            <LargeTitleHeader
                headingId={headingId}
                title={messages.title}
                focusSignal={headingFocusSignal}
                {...(back === undefined ? {} : { back })}
            />
            <div className="flex flex-col gap-2">
                <p className="text-body text-ink">{messages.intro}</p>
                <p className="text-body text-ink-muted">{messages.closeMatchNote}</p>
            </div>
            {children}
        </div>
    );

    return back === undefined ? (
        page
    ) : (
        <PushedPageFrame back={back} headingId={headingId} title={messages.title}>
            {() => page}
        </PushedPageFrame>
    );
};
