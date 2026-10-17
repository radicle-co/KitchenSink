'use client';

/**
 * @module @commise/features-recipes — web notice for a failed save of the library's grid/list choice (presentational).
 *
 * The choice is an account setting (ADR-0059): the screen shows it at once, and when the save fails the view has already
 * gone back to what it was. This says so, as an alert, so a screen reader hears it without moving focus. The host
 * renders it only while the save is failed (`useRecipeViewSetting().saveFailed`).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';

/**
 * Says the cook's grid/list choice was not saved; the view has already gone back to what it was. An alert, so it is
 * announced without moving focus. The host renders it only while the save is failed.
 *
 * @returns The notice.
 */
export const ViewSaveFailedNotice: FC = () => {
    const { list } = useMessages(recipeMessages);

    return (
        <p role="alert" className="text-meta text-danger-text">
            {list.viewSaveFailed}
        </p>
    );
};
