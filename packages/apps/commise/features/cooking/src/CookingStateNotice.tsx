'use client';

/**
 * @module CookingStateNotice — the web cooking notices: the load error, no steps and recipe gone. The house `StateNotice`, centred at a max width of 480 in every band.
 *
 * Presentational: props → JSX.
 */
import { StateNotice, type StateNoticeProps } from '@commise/ui/state-notice';
import type { FC } from 'react';

import { NOTICE_COLUMN } from './cookingLayout.js';

/** The web cooking notice. */
export const CookingStateNotice: FC<StateNoticeProps> = (props) => (
    <div className={`mx-auto w-full px-4 ${NOTICE_COLUMN.webClassName}`}>
        <StateNotice {...props} />
    </div>
);
