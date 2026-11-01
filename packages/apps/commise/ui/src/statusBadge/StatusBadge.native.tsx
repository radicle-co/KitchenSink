/**
 * @module @commise/ui/status-badge — the native badge that states a status (`Draft`, `Custom`, `Needs review`, …).
 *
 * React Native's nested `Text` takes no reliable radius or padding, so the badge is a row holding the glyph and a
 * `Text`, the same mechanism as `StandIn` (`docs/design/ingredientSpecialization.md` E2 I1). The same contract as the
 * web leaf: the words are the content, the badge is filled and never dashed, each status's label clears 4.5:1 on its
 * fill, a neutral one wears a 1 pt `lineDivider` edge, the label wraps and is never cut off, and it is 24 pt tall with
 * the `sm` radius.
 *
 * Styled with Tamagui (ADR-0080): every colour is a theme key, so the badge follows the scheme with no hook. PRO's pair
 * is `proFill` under `proInk`, the PRO tone's own keys. A glyph takes the label's colour, as `currentColor` does on web;
 * only neutral badges carry one.
 *
 * @pattern Registry consumer — the status picks its tone and glyph from closed `Record`s (`TONE_OF`, `BADGE_GLYPH`)
 * @pattern Variant — the tone is a Tamagui variant on the badge and on its label, the discriminated-union render map
 */
import type { FC } from 'react';
import { styled, XStack } from 'tamagui';

import { BADGE_BOX } from '../badgeBox/badgeBox.js';
import { Icon } from '../icon/Icon.native.js';
import { Text } from '../text/Text.native.js';
import { BADGE_GLYPH, type BadgeStatus, type StatusBadgeProps } from './props.js';

/** The three paint jobs a badge has (`componentFixes.md` §7). */
type BadgeTone = 'pro' | 'attention' | 'neutral';

/**
 * Each status's tone. A neutral badge is paper under `inkMuted` with a 1 pt `lineDivider` edge. Every tone carries the
 * same 1 pt edge (`BADGE_BOX`), so all tones draw one height at every font scale. PRO's and attention's edge is
 * transparent: React Native paints the fill under the border, so an edge in a translucent fill's own colour would show.
 */
const TONE_OF: Readonly<Record<BadgeStatus, BadgeTone>> = {
    pro: 'pro',
    attention: 'attention',
    draft: 'neutral',
    private: 'neutral',
    public: 'neutral',
    soon: 'neutral',
    note: 'neutral',
};

const Badge = styled(XStack, {
    name: 'StatusBadge',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: '$1',
    maxWidth: '100%',
    minHeight: BADGE_BOX.minHeight,
    borderRadius: '$sm',
    paddingHorizontal: '$2',
    paddingVertical: BADGE_BOX.paddingVertical,
    borderWidth: BADGE_BOX.borderWidth,

    variants: {
        tone: {
            pro: { backgroundColor: '$proFill', borderColor: 'transparent' },
            attention: { backgroundColor: '$attentionTint', borderColor: 'transparent' },
            neutral: { backgroundColor: '$paper', borderColor: '$lineDivider' },
        } as const satisfies Record<BadgeTone, object>,
    } as const,
});

const Label = styled(Text, {
    name: 'StatusBadgeLabel',
    typeRole: 'caption',
    flexShrink: 1,

    variants: {
        tone: {
            pro: { color: '$proInk' },
            attention: { color: '$ink' },
            neutral: { color: '$inkMuted' },
        } as const satisfies Record<BadgeTone, object>,
    } as const,
});

/** The status badge: filled, and as wide as its words allow. */
export const StatusBadge: FC<StatusBadgeProps> = ({ status, children }) => {
    const glyph = BADGE_GLYPH[status];
    const tone = TONE_OF[status];

    return (
        <Badge tone={tone}>
            {glyph === null ? null : <Icon name={glyph} size={16} tone="inkMuted" />}
            <Label tone={tone}>{children}</Label>
        </Badge>
    );
};
