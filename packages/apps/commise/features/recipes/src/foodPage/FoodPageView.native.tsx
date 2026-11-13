/**
 * @module @commise/features-recipes/foodPage — `FoodPageView` (native): the React Native leaf of `./FoodPageView.tsx`, on
 * the same props and the same `foodPageCopyOf` words. Styled with Tamagui only.
 *
 * Translation, not a port (private foods spec section 9): on a phone the actions stack full width at the end of the
 * content, before Withdraw, where the thumb is; from 600 dp they sit under the status panel in a row. Nothing depends on
 * hover. The frame (back, title) is the screen's, so this is the body.
 *
 * Presentational: `props → JSX`; every read, mutation and navigation is the session's (`useFoodPage`).
 *
 * @pattern Visitor — an exhaustive switch over the `FoodPageState` union
 */
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { LoadingNotice } from '@commise/ui/loading-notice';
import { OfflineReadSlot } from '@commise/ui/offline-notice';
import { StateNotice } from '@commise/ui/state-notice';
import { StatusBadge } from '@commise/ui/status-badge';
import { Text as DesignText } from '@commise/ui/text';
import type { FC } from 'react';
import { useWindowDimensions } from 'react-native';
import { XStack, YStack } from 'tamagui';

import { fillTemplate } from '@commise/i18n';
import { figureText } from './foodEditComparison.js';
import { foodPageCopyOf, type FoodAction, type FoodPageCopy, type FoodShownState } from './foodPageCopy.js';
import type { FoodPageViewProps } from './foodPageViewProps.js';
import { foodPageMessages } from './messages.js';

/** The width from which the actions sit in the status panel's reading order (a tablet). */
const TABLET_WIDTH = 600;

/** The glyph each action draws before its words. */
const ACTION_ICON = { edit: 'pencilLine', ask: 'globe' } as const;

/** The food page body. */
export const FoodPageView: FC<FoodPageViewProps> = (props) => {
    const m = useMessages(foodPageMessages);
    const offline = useMessages(offlineNoticeMessages);
    const { state } = props;

    switch (state.kind) {
        case 'loading':
            return <LoadingNotice label={m.loading} />;
        case 'offline':
            return <OfflineReadSlot message={offline.readOffline} />;
        case 'notFound':
            return (
                <StateNotice
                    title={m.notFound.title}
                    body={m.notFound.body}
                    primary={{ label: props.leaveLabel ?? m.notFound.toRecipes, icon: 'house', onPress: props.onLeave }}
                />
            );
        case 'error':
            return (
                <StateNotice
                    title={m.error.title}
                    primary={{ label: m.error.retry, icon: 'rotateCcw', onPress: props.onRetry }}
                />
            );
        default:
            return <FoodShown {...props} state={state} />;
    }
};

/** A state that has a food to show. Presentational: `props → JSX`. */
const FoodShown: FC<FoodPageViewProps & { readonly state: FoodShownState }> = ({
    state,
    ask,
    withdraw,
    onEdit,
    onAsk,
    onWithdraw,
    onWithdrawConfirm,
    onWithdrawKeep,
}) => {
    const m = useMessages(foodPageMessages);
    const locale = useLocale();
    const { width } = useWindowDimensions();
    const copy = foodPageCopyOf(state, m, locale);
    const name = state.food.name ?? m.titleFallback;
    const tablet = width >= TABLET_WIDTH;
    const actions = <FoodActions copy={copy} ask={ask} tablet={tablet} press={{ edit: onEdit, ask: onAsk }} />;

    return (
        <YStack gap="$4">
            <XStack flexWrap="wrap" gap="$2">
                {copy.badges.map((badge) => (
                    <StatusBadge key={badge.text} status={badge.status}>
                        {badge.text}
                    </StatusBadge>
                ))}
            </XStack>

            {copy.statement === undefined ? null : (
                <YStack gap="$1" borderRadius="$lg" backgroundColor="$paper" padding="$4">
                    <DesignText typeRole="cardTitle" color="$ink">
                        {copy.statement}
                    </DesignText>
                    {copy.details.map((line) => (
                        <DesignText key={line} typeRole="meta" color="$inkMuted">
                            {line}
                        </DesignText>
                    ))}
                    {/* From 600 dp the actions sit in the panel, under its text. */}
                    {tablet ? actions : null}
                </YStack>
            )}

            {tablet && copy.statement === undefined ? actions : null}

            {copy.comparison === undefined ? null : <EditComparison comparison={copy.comparison} />}

            <NutritionFigures food={state.food} />

            {state.food.portions.length === 0 ? null : (
                <YStack gap="$1">
                    <DesignText role="header" typeRole="sectionTitle" color="$ink">
                        {m.portions.heading}
                    </DesignText>
                    {state.food.portions.map((portion) => (
                        <DesignText key={portion.label} typeRole="meta" color="$ink">
                            {`${portion.label} · ${figureText(portion.gramWeight)} ${m.unit.g}`}
                        </DesignText>
                    ))}
                </YStack>
            )}

            {tablet ? null : actions}

            {copy.withdraw.offered ? (
                <YStack marginTop="$4" borderTopWidth={1} borderTopColor="$lineDivider" paddingTop="$6">
                    <Button variant="destructive" icon="trash" size="md" onPress={onWithdraw}>
                        {m.action.withdraw}
                    </Button>
                </YStack>
            ) : null}

            <ConfirmDialog
                open={withdraw.open}
                title={fillTemplate(m.withdraw.title, { name })}
                body={copy.withdraw.body}
                confirm={{ label: m.withdraw.confirm, icon: 'trash' }}
                keep={{ label: m.withdraw.keep }}
                busy={withdraw.busy}
                busyLabel={m.withdraw.busy}
                {...(withdraw.failed ? { error: m.withdraw.failed } : {})}
                onConfirm={onWithdrawConfirm}
                onKeep={onWithdrawKeep}
            />
        </YStack>
    );
};

/**
 * The panel's actions: on a phone a full-width column with the primary on top, from 600 dp a row with the primary last,
 * then why they are disabled and whether the ask failed. Presentational: `props → JSX`.
 */
const FoodActions: FC<{
    readonly copy: FoodPageCopy;
    readonly ask: FoodPageViewProps['ask'];
    readonly tablet: boolean;
    readonly press: Readonly<Record<FoodAction['key'], () => void>>;
}> = ({ copy, ask, tablet, press }) => {
    const m = useMessages(foodPageMessages);
    const asking = ask === 'busy';

    if (copy.actions.length === 0) {
        return null;
    }

    // Phone: the primary on top. Tablet: the primary last, at the end edge.
    const ordered = tablet ? copy.actions : [...copy.actions].reverse();

    return (
        <YStack gap="$3">
            {/* A column that also wraps shrink-wraps each button to its label on a device, so a phone's column never wraps. */}
            <XStack flexWrap={tablet ? 'wrap' : 'nowrap'} gap="$3" flexDirection={tablet ? 'row' : 'column'}>
                {ordered.map((action) => (
                    <ActionButton
                        key={action.key}
                        action={action}
                        full={!tablet}
                        disabled={copy.actionsDisabled}
                        busy={action.key === 'ask' && asking}
                        description={copy.actionsNote}
                        label={action.key === 'ask' && asking ? m.ask.busy : m.action[action.key]}
                        onPress={press[action.key]}
                    />
                ))}
            </XStack>
            {copy.actionsNote === undefined ? null : (
                <DesignText aria-hidden typeRole="meta" color="$inkMuted">
                    {copy.actionsNote}
                </DesignText>
            )}
            {ask === 'failed' ? (
                <DesignText role="alert" typeRole="meta" color="$dangerText">
                    {m.ask.failed}
                </DesignText>
            ) : null}
        </YStack>
    );
};

/** "Your edit": each changed field, read as one phrase. Presentational: `props → JSX`. */
const EditComparison: FC<{ readonly comparison: NonNullable<FoodPageCopy['comparison']> }> = ({ comparison }) => (
    <YStack gap="$2">
        <DesignText role="header" typeRole="sectionTitle" color="$ink">
            {comparison.heading}
        </DesignText>
        {comparison.rows.map((row) => (
            <YStack key={row.label} accessible aria-label={row.spoken}>
                <DesignText aria-hidden typeRole="meta" color="$inkMuted">
                    {row.label}
                </DesignText>
                <DesignText aria-hidden typeRole="body" color="$ink">
                    {row.text}
                </DesignText>
            </YStack>
        ))}
        <DesignText typeRole="meta" color="$inkMuted">
            {comparison.rest}
        </DesignText>
    </YStack>
);

/** "Nutrition per 100 g": the four figures the author wrote, a dash for one the food does not carry. Presentational. */
const NutritionFigures: FC<{ readonly food: FoodShownState['food'] }> = ({ food }) => {
    const m = useMessages(foodPageMessages);
    const macros = food.authoredMacros;
    const figures: readonly (readonly [string, number | undefined, 'kcal' | 'g'])[] = [
        [m.nutrition.calories, macros?.calories, 'kcal'],
        [m.nutrition.protein, macros?.proteinG, 'g'],
        [m.nutrition.carbs, macros?.carbsG, 'g'],
        [m.nutrition.fat, macros?.fatG, 'g'],
    ];

    return (
        <YStack gap="$2">
            <DesignText role="header" typeRole="sectionTitle" color="$ink">
                {m.nutrition.heading}
            </DesignText>
            {figures.map(([label, amount, unit]) => (
                <XStack key={label} flexWrap="wrap" justifyContent="space-between" columnGap="$4">
                    <DesignText typeRole="meta" color="$inkMuted">
                        {label}
                    </DesignText>
                    <DesignText typeRole="meta" color="$ink">
                        {amount === undefined ? '–' : `${figureText(amount)} ${m.unit[unit]}`}
                    </DesignText>
                </XStack>
            ))}
        </YStack>
    );
};

/** One action of the panel: the primary is the one filled control. Presentational: `props → JSX`. */
const ActionButton: FC<{
    readonly action: FoodAction;
    readonly label: string;
    readonly full: boolean;
    readonly disabled: boolean;
    readonly busy: boolean;
    readonly description: string | undefined;
    readonly onPress: () => void;
}> = ({ action, label, full, disabled, busy, description, onPress }) => {
    const common = {
        size: full ? 'lg' : 'md',
        width: full ? 'fill' : 'auto',
        disabled,
        busy,
        description,
        onPress,
    } as const;

    return action.variant === 'primary' ? (
        <Button variant="primary" icon={ACTION_ICON[action.key]} {...common}>
            {label}
        </Button>
    ) : (
        <Button variant="secondary" icon={ACTION_ICON[action.key]} {...common}>
            {label}
        </Button>
    );
};
