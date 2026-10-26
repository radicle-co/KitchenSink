/**
 * @module @commise/features-recipes/ingredientMatching — `MatchLineList` (native): the React Native leaf of
 * `./MatchLineList.tsx`, on the same props: one `MatchRow` per line, in the recipe's order. A `list` whose rows are
 * `listitem`s, so a screen reader can say how many lines there are and where each sits; the list keeps its native node
 * for that role (`docs/design/nativeContainerNames.md` N1 rule 4). Each line has a hairline rule above it in the divider
 * tone (U3), never a bare gap. ONE polite live region per list says what the host announces (U9). Painted from the
 * theme's roles (D15).
 */
import { useLocale } from '@commise/i18n/react';
import { LiveRegion } from '@commise/ui/live-region';
import { useTheme } from '@commise/ui/theme';
import type { FC } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MatchLineListProps } from './matchLineListProps.js';
import { lineRowOf, sendsOf } from './matchLineView.js';
import { MatchRow } from './MatchRow.js';
import { useMatchCopy } from './useMatchCopy.js';
import { useRetryFocus } from './useRetryFocus.js';

/** A recipe's matched lines. */
export const MatchLineList: FC<MatchLineListProps> = ({
    lines,
    expandedKey,
    currentKey,
    online,
    pending,
    failed,
    announcement,
    focus,
    ...handlers
}) => {
    const copy = useMatchCopy();
    const locale = useLocale();
    const { colors } = useTheme();
    const rows = lines.map((line) =>
        lineRowOf(
            line,
            {
                expanded: line.key === expandedKey,
                current: line.key === currentKey,
                online,
                pending: pending.get(line.key),
                failed: failed.has(line.key),
            },
            copy,
            locale,
        ),
    );
    const retryOf = useRetryFocus(sendsOf(rows));

    return (
        <View>
            <View collapsable={false} role="list">
                {rows.map((row) => (
                    <View
                        key={row.key}
                        collapsable={false}
                        role="listitem"
                        style={[styles.line, { borderTopColor: colors.lineDivider }]}
                    >
                        <MatchRow row={row} focus={focus} retry={retryOf(row.key)} {...handlers} />
                    </View>
                ))}
            </View>
            <LiveRegion politeness="polite" occurrence={announcement.occurrence} visuallyHidden>
                {announcement.text}
            </LiveRegion>
        </View>
    );
};

const styles = StyleSheet.create({
    line: { borderTopWidth: StyleSheet.hairlineWidth },
});
