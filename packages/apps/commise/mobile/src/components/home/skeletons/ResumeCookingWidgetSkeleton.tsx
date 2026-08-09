/**
 * @module home/skeletons/ResumeCookingWidgetSkeleton — the "Resume cooking" roadmap placeholder (mobile).
 *
 * Mirrors the mockup's resume-cooking strip SHAPE — a thumbnail, a title line, a progress bar, and a trailing
 * action — with skeleton blocks throughout. The mockup's "Continue" button is rendered as a SHAPE, not a
 * button: a real control here would either do nothing or need a destination that does not exist, and a
 * placeholder must not offer an action it cannot honour. Feature 009 replaces it with a live widget.
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { mobileMessages } from '../../../i18n/messages.js';
import { PlaceholderWidgetCard } from './PlaceholderWidgetCard.js';

/**
 * The resume-cooking widget's skeleton placeholder (mobile).
 *
 * @returns The resume-cooking strip's shape with no session data in it.
 */
export function ResumeCookingWidgetSkeleton(): JSX.Element {
    const { home } = useMessages(mobileMessages);

    return (
        <PlaceholderWidgetCard title={home.roadmap.titles['resume-cooking']} comingSoonLabel={home.roadmap.comingSoon}>
            {/* Pure shape (the "Continue" affordance included — it is drawn, never offered), so the whole row
                is hidden from assistive tech. `aria-hidden` is the spelling react-native-web can project; RN
                reverse-maps it onto both platform props on device. See the shell's JSDoc. */}
            <View aria-hidden style={styles.row}>
                {/* The recipe thumbnail. */}
                <View style={styles.thumb} />
                <View style={styles.middle}>
                    {/* The in-progress recipe's title, then its progress bar (an empty track — any fill would
                        assert a real progress figure). */}
                    <View style={styles.titleBar} />
                    <View style={styles.progressTrack} />
                </View>
                {/* The "Continue" action, as a shape. */}
                <View style={styles.action} />
            </View>
        </PlaceholderWidgetCard>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: palette.pearl },
    middle: { flex: 1, gap: 8 },
    titleBar: { height: 16, width: '75%', borderRadius: 4, backgroundColor: palette.pearl },
    progressTrack: { height: 4, width: '100%', borderRadius: 999, backgroundColor: palette.pearl },
    action: { height: 36, width: 96, borderRadius: 999, backgroundColor: palette.pearl },
});
