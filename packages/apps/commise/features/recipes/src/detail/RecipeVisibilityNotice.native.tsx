/**
 * @module @commise/features-recipes/detail — the owner's visibility slot on the native recipe page, in lock-step with
 * `RecipeVisibilityNotice.tsx` and presentational like it: for the owner, an assertive moment region, a muted standing
 * line outside any live region, and a polite hidden region that carries the one announcement. For anyone else, nothing.
 *
 * @pattern Presentational component — pure props to JSX; the notice and the announcement are decided in the controller
 */
import { LiveRegion } from '@commise/ui/live-region';
import { Text } from '@commise/ui/text';
import type { FC } from 'react';

import type { RecipeVisibilityNoticeProps } from './RecipeVisibilityNotice.js';

/** The owner's visibility notice (native). */
export const RecipeVisibilityNotice: FC<RecipeVisibilityNoticeProps> = ({ owner, notice, announcement }) =>
    owner ? (
        <>
            <LiveRegion politeness="assertive" typeRole="meta" tone="dangerText">
                {notice?.kind === 'moment' ? notice.text : ''}
            </LiveRegion>
            {notice?.kind === 'standing' ? (
                <Text typeRole="meta" color="$inkMuted">
                    {notice.text}
                </Text>
            ) : null}
            <LiveRegion politeness="polite" visuallyHidden>
                {announcement ?? ''}
            </LiveRegion>
        </>
    ) : null;
