/**
 * @module @commise/features-recipes/form — `RecipeVisibilityStatement` (web): "Who can see it: Public", what the editor
 * shows in place of `RecipeVisibilityField` when Private is not offered (`offersPrivate` false: the paid features are
 * hidden for this cook, or their state is still loading). Plan 2026-10-14-009 D14; owner ruling 2026-10-13.
 *
 * A statement, not a one-card radio group: a group with one option is not a choice, and a disabled Private card would
 * itself be an upsell. Whether a recipe is public is still a fact the cook needs before publishing, so it is said.
 *
 * Presentational and pure. The native leaf is `./RecipeVisibilityStatement.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { editorMessages } from '../editor/messages.js';

/** "Who can see it: Public". */
export const RecipeVisibilityStatement: FC = () => {
    const { visibility: v } = useMessages(editorMessages);

    return (
        <div className="flex flex-col gap-1">
            <span className="text-label text-ink-muted">{v.legend}</span>
            <span className="text-body font-semibold text-ink">{v.public}</span>
            <span className="text-meta text-ink-muted">{v.publicHint}</span>
        </div>
    );
};
