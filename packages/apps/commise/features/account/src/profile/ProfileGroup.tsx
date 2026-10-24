/**
 * @module @commise/features-account/profile/ProfileGroup — a grouped list of Profile rows (web): the settings-list
 * pattern (`docs/design/uiOverhaul/buildSpec.md` §9.1). A `region` named by its H2, or by `label` when it has no
 * visible heading, so a screen reader can jump between the groups.
 *
 * Presentational: props → JSX.
 */
import { useId, type FC } from 'react';

import type { ProfileGroupProps } from './props.js';

/** The rows' card: hairlines between rows, clipped to the radius so a row's focus ring stays inside it. */
const CARD = 'flex flex-col divide-y divide-line-divider overflow-hidden rounded-xl bg-paper';

/** A grouped list of rows. */
export const ProfileGroup: FC<ProfileGroupProps> = ({ heading, label, children }) => {
    const headingId = useId();

    return (
        <section
            {...(heading === undefined ? { 'aria-label': label } : { 'aria-labelledby': headingId })}
            className="flex flex-col gap-2"
        >
            {heading === undefined ? null : (
                <h2 id={headingId} className="text-section-title text-ink">
                    {heading}
                </h2>
            )}
            <div className={CARD}>{children}</div>
        </section>
    );
};
