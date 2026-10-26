/**
 * @module @commise/features-recipes/import — `ImportLineOptionsSheet` (native): the React Native leaf of
 * `./ImportLineOptionsSheet.tsx`. The house bottom `Sheet`, so the options open under the thumb: search first, then the
 * foods, then keep as written, titled with the line and its recipe.
 */
import { useMessages } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { ImportLineOptions } from './ImportLineOptions.js';
import { importMessages } from './messages.js';
import type { ImportLineOptionsSheetProps } from './props.js';

/** A flagged line's options, in a sheet. */
export const ImportLineOptionsSheet: FC<ImportLineOptionsSheetProps> = ({ open, onOpenChange, title, ...options }) => {
    const { flagged: f } = useMessages(importMessages);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            closeLabel={fillTemplate(f.sheetClose, { line: options.lineText })}
            size="content"
        >
            <View style={styles.column}>
                <ImportLineOptions {...options} />
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({ column: { gap: nativeTokens.spacing[3] } });
