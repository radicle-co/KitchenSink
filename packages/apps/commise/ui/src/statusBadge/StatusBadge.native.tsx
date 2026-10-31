/**
 * @module @commise/ui/status-badge — the native badge that states a status (`Draft`, `Custom`, `Needs review`, …).
 *
 * React Native's nested `Text` takes no reliable radius or padding, so the badge is a row holding the glyph and a
 * `Text`, the same mechanism as `StandIn` (`docs/design/ingredientSpecialization.md` E2 I1). The same contract as the
 * web leaf: the words are the content, the badge is filled and never dashed, each status's label clears 4.5:1 on its
 * fill, a neutral one wears a 1 pt `lineDivider` edge, the label wraps and is never cut off, and it is 24 pt tall with
 * the `sm` radius.
 *
 * Styled with Tamagui (ADR-0080): every colour is a theme role, so the badge follows the scheme with no hook. PRO's
 * pair is `inkMuted` under `inverseInk`, which are the PRO tone's values in both themes.
 *
 * @pattern Registry consumer — the status picks its tone and glyph from closed `Record`s (`TONE_OF`, `BADGE_GLYPH`)
 * @pattern Variant — the tone is a Tamagui variant on the badge and on its label, the discriminated-union render map
 */
import type { FC } from 'react';
import { styled, XStack } from 'tamagui';

import { Icon } from '../icon/Icon.native.js';
import { Text } from '../text/Text.native.js';
import { BADGE_GLYPH, type BadgeStatus, type StatusBadgeProps } from './props.js';

/** The three paint jobs a badge has (`componentFixes.md` §7). */
type BadgeTone = 'pro' | 'attention' | 'neutral';

/** Each status's tone. A neutral badge is paper under `inkMuted` with a 1 pt `lineDivider` edge. */
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
    minHeight: '$5',
    borderRadius: '$sm',
    paddingHorizontal: '$2',
    paddingVertical: 2,

    variants: {
        tone: {
            pro: { backgroundColor: '$inkMuted' },
            attention: { backgroundColor: '$attentionTint' },
            neutral: { backgroundColor: '$paper', borderWidth: 1, borderColor: '$lineDivider' },
        } as const satisfies Record<BadgeTone, object>,
    } as const,
});

const Label = styled(Text, {
    name: 'StatusBadgeLabel',
    typeRole: 'caption',
    flexShrink: 1,

    variants: {
        tone: {
            pro: { color: '$inverseInk' },
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
            {glyph === null ? null : <Icon name={glyph} size={16} tone="ink" />}
            <Label tone={tone}>{children}</Label>
        </Badge>
    );
};
