/**
 * @module @commise/features-recipes/import — `ImportLineOptionsSheet` (native): the React Native leaf of
 * `./ImportLineOptionsSheet.tsx`. The house bottom `Sheet`, so the options open under the thumb: search first, then the
 * foods, then keep as written, titled with the line and its recipe. A pick that did not save says so above the list,
 * with Try again, and the sheet speaks it from its own polite region (M6, U9).
 */
import { useMessages } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { lineTextOf } from '../ingredientMatching/matchLine.js';
import { FoodChoiceList } from '../ingredientMatching/FoodChoiceList.native.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.native.js';
import { useOpenLineView } from '../ingredientMatching/useOpenLineView.js';
import { importMessages } from './messages.js';
import type { ImportLineOptionsSheetProps } from './props.js';

/** A flagged line's options, in a sheet. */
export const ImportLineOptionsSheet: FC<ImportLineOptionsSheetProps> = ({
    open,
    onOpenChange,
    title,
    line,
    online,
    pending,
    failed,
    announcement,
    onRetryPick,
    ...list
}) => {
    const view = useOpenLineView(line, { online, pending, failed });
    const { flagged: f } = useMessages(importMessages);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            closeLabel={fillTemplate(f.sheetClose, { line: lineTextOf(line.line) })}
            size="content"
        >
            <View style={styles.column}>
                {view.failure === undefined ? null : <MatchFailureLine failure={view.failure} onRetry={onRetryPick} />}
                <FoodChoiceList view={view.list} {...list} />
                <LiveRegion politeness="polite" occurrence={announcement.occurrence} visuallyHidden>
                    {announcement.text}
                </LiveRegion>
            </View>
        </Sheet>
    );
};

const styles = StyleSheet.create({ column: { gap: nativeTokens.spacing[3] } });
