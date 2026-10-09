'use client';

/**
 * @module @commise/features-recipes/editor — the editor's Preview (build spec §7.7 item 4): the real detail page of the
 * draft, in a full-height sheet, under the banner "Preview. This is how it looks to others." It is the detail page
 * itself (`RecipeDetailView`), not a second rendering of the recipe, so what the cook previews is what others see.
 *
 * Presentational: props → JSX. Read-only: no owner controls, no rating, no Edit links.
 *
 * ⚠️ The detail page's section ids (`ingredients`, `steps`) are the editor's too, and the editor stays in the document
 * under the sheet, so a jump from the preview's own section switch finds the editor's heading first. Known; the
 * preview is a look, not a place to navigate.
 */
import { useMessages } from '@commise/i18n/react';
import { ScrollHost } from '@commise/ui/scroll-host';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { RecipeDetailView } from '../detail/RecipeDetailView.js';
import { editorMessages } from './messages.js';
import { NO_RETRY, type RecipePreviewSheetProps } from './previewSheetProps.js';

/** The detail page's sections, as its section switch names them. */
const PREVIEW_SECTIONS = ['ingredients', 'steps', 'nutrition'] as const;

/** The web Preview sheet. */
export const RecipePreviewSheet: FC<RecipePreviewSheetProps> = ({ open, recipe, onClose }) => {
    const m = useMessages(editorMessages);

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={m.preview}
            closeLabel={m.previewClose}
            size="full"
        >
            <p className="rounded-md bg-surface-muted px-4 py-3 text-body-sm text-ink">{m.previewBanner}</p>
            {/* Its own host: the detail page's section switch must not reach the editor's. */}
            <ScrollHost sections={PREVIEW_SECTIONS}>
                <RecipeDetailView recipe={recipe} unreachableRetry={NO_RETRY} />
            </ScrollHost>
        </Sheet>
    );
};
