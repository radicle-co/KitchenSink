'use client';

/**
 * @module @commise/features-recipes/form — `IngredientLineEditorSheet` (web): the row editor's phone frame (build spec
 * §7.5.2, below a 600 container): a content-height bottom sheet, so the list stays still and the fields rise above the
 * keyboard, with Done (primary, `check`) pinned at its foot. Every close route (Done, Escape, the scrim, Close) is Done:
 * the editor closes and focus returns to the row.
 *
 * Presentational: it frames `IngredientLineEditor` over the open row's view.
 *
 * @pattern Decorator — the sheet frame around the row editor's one field layout
 */
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC, ReactNode } from 'react';

import { IngredientLineEditor } from './IngredientLineEditor.js';
import type { IngredientRowView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';

/** Props for {@link IngredientLineEditorSheet}. */
export interface IngredientLineEditorSheetProps {
    readonly open: boolean;
    /** The row the sheet edits, kept while it closes. */
    readonly row: IngredientRowView | undefined;
    readonly m: RecipeFormMessages;
    readonly details: ReactNode;
}

/** The row editor, as a phone sheet. */
export const IngredientLineEditorSheet: FC<IngredientLineEditorSheetProps> = ({ open, row, m, details }) => (
    <Sheet
        open={open && row !== undefined}
        onOpenChange={(next) => {
            if (!next) {
                row?.lineEditor.onDone();
            }
        }}
        title={row?.lineEditor.title ?? ''}
        closeLabel={row?.lineEditor.closeLabel ?? ''}
        size="content"
        footer={
            <div className="flex justify-end">
                <Button icon="check" width="fill" onPress={() => row?.lineEditor.onDone()}>
                    {m.rowDone}
                </Button>
            </div>
        }
    >
        {row === undefined ? null : (
            <IngredientLineEditor view={row.lineEditor} index={row.index} m={m} details={details} />
        )}
    </Sheet>
);
