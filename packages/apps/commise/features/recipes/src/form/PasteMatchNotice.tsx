'use client';

/**
 * @module @commise/features-recipes/form — `PasteMatchNotice` (web): the notice above the pasted lines when matching
 * cannot run (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, RecipeEditorPasteChooseStates):
 * offline, where the check waits and the choices are kept where the draft is (in this tab, on web — D7), or the daily
 * limit (004 FR-022), where the lines are kept as written until it resets. A standing fact, so muted with an info glyph,
 * not amber; not live, because the editor's paste announcement says the move offline (`PasteMilestone` `offline`).
 *
 * Presentational: props in, markup out; the words are `pasteMatchNoticeOf`'s. The native leaf is
 * `./PasteMatchNotice.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { recipeFormMessages } from './messages.js';
import type { PasteMatchNoticeProps } from './pasteMatchNoticeProps.js';
import { pasteMatchNoticeOf } from './pasteMatchView.js';

/** The notice above the pasted lines. */
export const PasteMatchNotice: FC<PasteMatchNoticeProps> = ({ notice }) => {
    const m = useMessages(recipeFormMessages);
    const locale = useLocale();

    return (
        <div className="flex items-start gap-2 rounded-xl bg-surface-muted px-3 py-3">
            <Icon name="info" size={20} tone="inkMuted" />
            <p className="min-w-0 flex-1 break-words text-meta text-ink">{pasteMatchNoticeOf(notice, m, locale)}</p>
        </div>
    );
};
