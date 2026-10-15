/**
 * @module @commise/features-recipes/form — `RecipeVisibilityStatement` (web): "Who can see it: Public", what the editor
 * shows in place of `RecipeVisibilityField` when Private is not offered (`offersPrivate` false: the paid features are
 * hidden for this cook, or their state is still loading). Plan 2026-10-14-009 D14; owner ruling 2026-10-13.
 *
 * A statement, not a one-card radio group: a group with one option is not a choice, and a disabled Private card would
 * itself be an upsell. Whether a recipe is public is still a fact the cook needs before publishing, so it is said.
 *
 * It says, too, when a kept draft's Private will not be kept (`privateUnavailable`). And when it replaces the field the
 * cook just used to confirm Public (`focusOnMount`, UX SPECIFY 2026-10-15), it takes the focus the unmounted radio had,
 * so the keyboard is not dropped to the top of the page (WCAG 2.4.3) — only when focus is lost (`focusIfLost`).
 *
 * Presentational. The native leaf is `./RecipeVisibilityStatement.native.tsx`.
 *
 * @pattern Adapter over the DOM focus API — a callback ref that hands the statement to `focusIfLost` as it attaches;
 *     `.focus()` has no declarative form, and `autoFocus` does not apply to a non-control element
 */
import { useMessages } from '@commise/i18n/react';
import { focusIfLost } from '@commise/ui/dialog-focus';
import { useCallback, type FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import type { RecipeVisibilityStatementProps } from './props.js';

/** "Who can see it: Public". */
export const RecipeVisibilityStatement: FC<RecipeVisibilityStatementProps> = ({ privateUnavailable, focusOnMount }) => {
    const { visibility: v } = useMessages(editorMessages);
    // Stable, so React attaches it once per mount rather than on every render.
    const takeFocus = useCallback((node: HTMLDivElement | null) => focusIfLost(node), []);

    return (
        <div className="flex flex-col gap-1 outline-none" {...(focusOnMount ? { ref: takeFocus, tabIndex: -1 } : {})}>
            <span className="text-label text-ink-muted">{v.legend}</span>
            <span className="text-body font-semibold text-ink">{v.public}</span>
            <span className="text-meta text-ink-muted">{v.publicHint}</span>
            {privateUnavailable ? <span className="text-meta text-ink-muted">{v.privateUnavailable}</span> : null}
        </div>
    );
};
