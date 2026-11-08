/**
 * @module @commise/features-recipes/form — `PasteMatchedBlock` (native): the React Native leaf of
 * `./PasteMatchedBlock.tsx`, on the same props: the notice, the summary and the matched lines, with the side pane beside
 * them at the wide container class (a 1194 tablet). When the last open line is chosen the screen-reader cursor goes to
 * the summary, so the cook who just chose does not lose their place (SC 2.4.3).
 *
 * @pattern Adapter over `useScreenReaderFocusOnSignal` — the screen-reader cursor move the host's signal asks for
 */
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import { MatchLineList } from '../ingredientMatching/MatchLineList.native.js';
import { PasteChoicePane } from './PasteChoicePane.native.js';
import { PasteMatchNotice } from './PasteMatchNotice.native.js';
import { PasteMatchSummary } from './PasteMatchSummary.native.js';
import type { PasteMatchedBlockProps } from './pasteMatchedBlockProps.js';

/** The width of the side pane beside the list at the wide class, dp. */
const PANE_WIDTH = 384;

/** The paste's matched lines, with their summary and notice. */
export const PasteMatchedBlock: FC<PasteMatchedBlockProps> = ({ matching, wide }) => {
    const summary = useScreenReaderFocusOnSignal<View>(matching.summaryFocusSignal);
    const layout = matching.layoutFor(wide);

    return (
        <View style={styles.block}>
            {matching.notice === undefined ? null : <PasteMatchNotice notice={matching.notice} />}
            {matching.summary === undefined ? null : (
                <View ref={summary} accessible>
                    <PasteMatchSummary view={matching.summary} />
                </View>
            )}
            {layout === undefined ? null : (
                <View style={styles.layout}>
                    <View style={styles.list}>
                        <MatchLineList {...layout.list} />
                    </View>
                    {layout.pane === undefined ? null : (
                        <View style={styles.pane}>
                            <PasteChoicePane {...layout.pane} />
                        </View>
                    )}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    block: { gap: nativeTokens.spacing[3] },
    layout: { flexDirection: 'row', gap: nativeTokens.spacing[4], alignItems: 'flex-start' },
    list: { flex: 1, minWidth: 0 },
    pane: { width: PANE_WIDTH },
});
