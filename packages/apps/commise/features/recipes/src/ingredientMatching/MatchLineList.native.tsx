/**
 * @module @commise/features-recipes/ingredientMatching — `MatchLineList` (native): the React Native leaf of
 * `./MatchLineList.tsx`, on the same props: one `MatchRow` per line, in the recipe's order. A `list` whose rows are
 * `listitem`s, so a screen reader can say how many lines there are and where each sits; the list keeps its native node
 * for that role (`docs/design/nativeContainerNames.md` N1 rule 4). Painted from the theme's roles (D15).
 */
import { useLocale } from '@commise/i18n/react';
import { nativeTokens } from '@commise/ui/native';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MatchLineListProps } from './matchLineListProps.js';
import { lineRowOf } from './matchLineView.js';
import { MatchRow } from './MatchRow.js';
import { useMatchCopy } from './useMatchCopy.js';

/** A recipe's matched lines. */
export const MatchLineList: FC<MatchLineListProps> = ({
    lines,
    expandedKey,
    currentKey,
    online,
    pending,
    searchFocus,
    ...handlers
}) => {
    const copy = useMatchCopy();
    const locale = useLocale();

    return (
        <View collapsable={false} role="list" style={styles.list}>
            {lines.map((line) => {
                const row = lineRowOf(
                    line,
                    {
                        expanded: line.key === expandedKey,
                        current: line.key === currentKey,
                        online,
                        pending: pending?.key === line.key ? pending.send : undefined,
                    },
                    copy,
                    locale,
                );

                return (
                    <View key={line.key} collapsable={false} role="listitem">
                        <MatchRow row={row} searchFocus={searchFocus} {...handlers} />
                    </View>
                );
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: nativeTokens.spacing[1] },
});
