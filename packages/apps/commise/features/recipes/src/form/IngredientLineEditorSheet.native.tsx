/**
 * @module @commise/features-recipes/form — `IngredientLineEditorSheet` (native): the row editor's phone frame (build
 * spec §7.5.2, §7.12): a content-height bottom sheet that lifts the fields above the keyboard, with Done (primary,
 * `check`) at its foot. The React Native leaf of `./IngredientLineEditorSheet.tsx`; every close route (Done, Close,
 * Android back, a swipe) is Done, and the leaf returns the screen-reader cursor to the row once the sheet has gone.
 *
 * Presentational: it frames `IngredientLineEditor` over the open row's view.
 *
 * @pattern Decorator — the sheet frame around the row editor's one field layout
 */
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { IngredientLineEditor } from './IngredientLineEditor.native.js';
import type { IngredientLineEditorSheetProps } from './IngredientLineEditorSheet.js';

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
            <Button icon="check" width="fill" onPress={() => row?.lineEditor.onDone()}>
                {m.rowDone}
            </Button>
        }
    >
        {row === undefined ? null : (
            <IngredientLineEditor view={row.lineEditor} index={row.index} m={m} details={details} />
        )}
    </Sheet>
);
