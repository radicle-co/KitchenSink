/**
 * @module @commise/features-recipes/card — the native recipe card: one data shape, three variants
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1), the twin of the web leaf.
 *
 * - **grid** — the full CR-002 card: a 4:3 cover with its chips, then the title; difficulty · rating; cuisine ·
 *   calories · servings; the tags as text; the version and the timestamp.
 * - **row** — the list view: an 80 × 80 cover, the title on up to two lines, a meta line and a status line.
 * - **compact** — the cover with its chips, then the title.
 *
 * The orchestration layer decides the variant with `cardVariantOf`; this leaf draws the arrangement it is handed. The
 * card is ONE pressable link named by the title. Its surface is a level-1 card — `paper`, a `lineDivider` hairline,
 * the `sm` elevation — and never glass (owner ruling D12). Every colour is read from `useTheme()` at render, so the
 * card follows the system scheme (D15); the stylesheet holds layout only.
 *
 * iOS masks a layer's shadow when the same layer clips, so the elevation sits on an outer shell that never clips and the
 * clip on the content view inside it.
 *
 * One line that runs out of room: native has no `:empty`, so the meta line spaces its items with a gap rather than the
 * web's middots — a nutrition slot that settles on nothing would otherwise leave an orphan separator.
 *
 * @pattern Compound Component — a Root carrying the view in context, and parts each surface arranges
 * @pattern Registry — the variant's default arrangement, keyed by the closed variant union
 */
import { nativeTokens } from '@commise/ui/native';
import { DifficultyBadge } from '@commise/ui/difficulty-badge';
import { Icon } from '@commise/ui/icon';
import { PressScale } from '@commise/ui/press-scale';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import { useContext, type FC, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CardVariant } from './cardVariant.js';
import { STAR_COUNT } from './model.js';
import {
    RecipeCardNutritionContext,
    RecipeCardViewContext,
    useCardView,
    type RecipeCardProps,
} from './recipeCardContext.js';
import { useRecipeCardView } from './useRecipeCardView.js';

/** A cover chip: solid `photoChip`, `ink`, the `sm` radius. */
const CoverChip: FC<{ readonly children: ReactNode; readonly label?: string }> = ({ children, label }) => {
    const { colors } = useTheme();

    return (
        <View
            collapsable={false}
            {...(label === undefined ? {} : { accessible: true, accessibilityLabel: label })}
            style={[styles.coverChip, { backgroundColor: colors.photoChip }]}
        >
            {children}
        </View>
    );
};

/** The cover: the photo or its monogram, with the status chip, PRO and the time chip over it. */
const CardCover: FC<{ readonly thumbnail?: boolean }> = ({ thumbnail = false }) => {
    const { recipe, cover } = useCardView();
    const { colors } = useTheme();

    return (
        <View style={thumbnail ? styles.thumbnail : styles.cover}>
            <RecipeCover
                recipeId={recipe.id}
                title={recipe.title}
                aspect={thumbnail ? '1:1' : '4:3'}
                {...(recipe.cuisine === undefined ? {} : { cuisine: recipe.cuisine })}
                {...(recipe.coverPhotoUrl === undefined ? {} : { photoUrl: recipe.coverPhotoUrl })}
            />
            {!thumbnail && cover.status !== undefined && (
                <View style={styles.topStart}>
                    <CoverChip>
                        <Icon name={cover.status.status === 'draft' ? 'pencilLine' : 'lock'} size={16} tone="ink" />
                        <Text style={[styles.caption, { color: colors.ink }]}>{cover.status.text}</Text>
                    </CoverChip>
                </View>
            )}
            {cover.pro !== undefined && (
                <View
                    accessible
                    accessibilityLabel={cover.pro.label}
                    style={thumbnail ? styles.topEndTight : styles.topEnd}
                >
                    <StatusBadge status="pro">{cover.pro.text}</StatusBadge>
                </View>
            )}
            {!thumbnail && (
                <View style={styles.bottomStart}>
                    <CoverChip label={cover.time.label}>
                        <Icon name="clock" size={16} tone="ink" />
                        <Text style={[styles.caption, styles.figure, { color: colors.ink }]}>{cover.time.text}</Text>
                    </CoverChip>
                </View>
            )}
        </View>
    );
};

/** The title. */
const CardTitle: FC = () => {
    const { recipe } = useCardView();
    const { colors } = useTheme();

    return (
        <Text numberOfLines={2} style={[styles.title, { color: colors.ink }]}>
            {recipe.title}
        </Text>
    );
};

/** The rating: display-only. Rated → a named star group and the figure; unrated → "No ratings yet". */
const CardRating: FC = () => {
    const { rating } = useCardView();
    const { colors } = useTheme();

    if (rating.kind === 'unrated') {
        return (
            <Text numberOfLines={1} style={[styles.meta, { color: colors.inkMuted }]}>
                {rating.text}
            </Text>
        );
    }

    return (
        <View accessible accessibilityRole="image" accessibilityLabel={rating.label} style={styles.stars}>
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <Text
                    key={index}
                    style={[styles.star, { color: rating.fills[index] === true ? colors.rating : colors.inkMuted }]}
                >
                    {rating.fills[index] === true ? '★' : '☆'}
                </Text>
            ))}
            <Text style={[styles.meta, styles.figure, styles.ratingFigure, { color: colors.ink }]}>{rating.short}</Text>
        </View>
    );
};

/** Difficulty, then the rating. */
const CardDifficultyRating: FC = () => {
    const { meta } = useCardView();

    return (
        <View style={styles.oneLine}>
            {meta.difficulty !== undefined && (
                <DifficultyBadge level={meta.difficulty.level}>{meta.difficulty.label}</DifficultyBadge>
            )}
            <CardRating />
        </View>
    );
};

/** The grid card's meta line: cuisine, calories, servings. */
const CardMeta: FC = () => {
    const { recipe, meta } = useCardView();
    const nutrition = useContext(RecipeCardNutritionContext);
    const { colors } = useTheme();
    const text = [styles.meta, { color: colors.inkMuted }];

    return (
        <View style={styles.oneLine}>
            {recipe.cuisine !== undefined && (
                <Text numberOfLines={1} style={[text, styles.shrink]}>
                    {recipe.cuisine}
                </Text>
            )}
            {nutrition}
            <Text accessibilityLabel={meta.servingsLabel} style={text}>
                {meta.servingsText}
            </Text>
        </View>
    );
};

/** The status as the design-system badge, the version and the timestamp. */
const CardBadges: FC = () => {
    const { badges } = useCardView();
    const { colors } = useTheme();

    return (
        <View style={styles.wrapLine}>
            {badges.version !== undefined && (
                <Text accessibilityLabel={badges.version.label} style={[styles.caption, { color: colors.inkMuted }]}>
                    {badges.version.text}
                </Text>
            )}
            <StatusBadge status={badges.status.status}>{badges.status.text}</StatusBadge>
            <Text style={[styles.caption, { color: colors.inkMuted }]}>{badges.timestamp}</Text>
        </View>
    );
};

/** The tags as one line of text. An empty line keeps its height, so cards side by side keep their rows. */
const CardTags: FC = () => {
    const { tags } = useCardView();
    const { colors } = useTheme();

    return (
        <Text
            numberOfLines={1}
            {...(tags === undefined ? {} : { accessibilityLabel: tags.label })}
            style={[styles.caption, styles.lineBox, { color: colors.inkMuted }]}
        >
            {tags?.text ?? ''}
        </Text>
    );
};

/** The version (past v1) and the timestamp. */
const CardFooter: FC = () => {
    const { footer } = useCardView();
    const { colors } = useTheme();

    return (
        <Text numberOfLines={1} style={[styles.caption, { color: colors.inkMuted }]}>
            {footer}
        </Text>
    );
};

/** Row line 2: cuisine, ⏱ total, 👥 servings, calories. */
const RowMeta: FC = () => {
    const { recipe, meta } = useCardView();
    const nutrition = useContext(RecipeCardNutritionContext);
    const { colors } = useTheme();
    const text = [styles.meta, { color: colors.inkMuted }];

    return (
        <View style={styles.oneLine}>
            {recipe.cuisine !== undefined && (
                <Text numberOfLines={1} style={[text, styles.shrink]}>
                    {recipe.cuisine}
                </Text>
            )}
            <View accessible accessibilityLabel={meta.timeLabel} style={styles.iconItem}>
                <Icon name="clock" size={16} tone="inkMuted" />
                <Text style={[text, styles.figure]}>{meta.duration}</Text>
            </View>
            <View accessible accessibilityLabel={meta.servingsLabel} style={styles.iconItem}>
                <Icon name="users" size={16} tone="inkMuted" />
                <Text style={[text, styles.figure]}>{recipe.servings}</Text>
            </View>
            {nutrition}
        </View>
    );
};

/** Row line 3: difficulty, rating, the visibility glyph or the Draft badge, then the timestamp. */
const RowStatus: FC = () => {
    const { meta, badges } = useCardView();
    const { colors } = useTheme();

    return (
        <View style={styles.oneLine}>
            {meta.difficulty !== undefined && (
                <DifficultyBadge level={meta.difficulty.level}>{meta.difficulty.label}</DifficultyBadge>
            )}
            <CardRating />
            {badges.status.status === 'draft' ? (
                <StatusBadge status="draft">{badges.status.text}</StatusBadge>
            ) : (
                <Icon
                    name={badges.status.status === 'private' ? 'lock' : 'globe'}
                    size={16}
                    tone="inkMuted"
                    label={badges.status.text}
                />
            )}
            <Text numberOfLines={1} style={[styles.caption, styles.trailing, { color: colors.inkMuted }]}>
                {badges.timestamp}
            </Text>
        </View>
    );
};

/**
 * What a variant's arrangement is handed beyond the recipe: how to wrap the part of the card that is its link, and the
 * surface's own slots. A card with controls of its own links only the part that holds the recipe, because a pressable
 * that is one accessible element would swallow a control inside it.
 */
interface ArrangementSlots {
    readonly link: (node: ReactNode) => ReactNode;
    readonly footer?: ReactNode;
    readonly note?: ReactNode;
    readonly trailing?: ReactNode;
}

const GridArrangement: FC<ArrangementSlots> = ({ link, footer }) => (
    <>
        {link(
            <>
                <CardCover />
                <View style={[styles.body, footer !== undefined && styles.bodyBeforeFooter]}>
                    <CardTitle />
                    <CardDifficultyRating />
                    <CardMeta />
                    <CardTags />
                    {footer === undefined ? <CardFooter /> : null}
                </View>
            </>,
        )}
        {footer === undefined ? null : <View style={styles.footerBox}>{footer}</View>}
    </>
);

const RowArrangement: FC<ArrangementSlots> = ({ link, note, trailing }) => (
    <View style={styles.row}>
        {link(
            <View style={styles.rowLink}>
                <CardCover thumbnail />
                <View style={styles.rowText}>
                    <CardTitle />
                    <RowMeta />
                    <RowStatus />
                    {note === undefined ? null : <NoteLine>{note}</NoteLine>}
                </View>
            </View>,
        )}
        {trailing === undefined ? null : <View style={styles.trailingBox}>{trailing}</View>}
    </View>
);

const CompactArrangement: FC<ArrangementSlots> = ({ link, footer }) => (
    <>
        {link(
            <>
                <CardCover />
                <View style={styles.compactBody}>
                    <CardTitle />
                </View>
            </>,
        )}
        {footer === undefined ? null : <View style={styles.compactFooterBox}>{footer}</View>}
    </>
);

/** A row's note: one muted caption line. */
const NoteLine: FC<{ readonly children: ReactNode }> = ({ children }) => {
    const { colors } = useTheme();

    return (
        <Text numberOfLines={1} style={[styles.caption, { color: colors.inkMuted }]}>
            {children}
        </Text>
    );
};

/**
 * The default arrangement of each variant: a Registry keyed by the closed variant union, so a variant without an
 * arrangement does not compile.
 */
const ARRANGEMENT: Readonly<Record<CardVariant, FC<ArrangementSlots>>> = {
    grid: GridArrangement,
    row: RowArrangement,
    compact: CompactArrangement,
};

/** The level-1 surface: an elevated shell that never clips, and the clipping content view inside it. */
const CardSurface: FC<{ readonly children: ReactNode }> = ({ children }) => {
    const { colors } = useTheme();

    return (
        <View style={[styles.shell, { backgroundColor: colors.paper, borderColor: colors.lineDivider }]}>
            <View style={styles.clip}>{children}</View>
        </View>
    );
};

const RecipeCardRoot: FC<RecipeCardProps> = (props) => {
    const { recipe, onSelect, nutrition = null } = props;
    const view = useRecipeCardView(recipe);
    const Arrangement = props.variant === undefined ? null : ARRANGEMENT[props.variant];
    const ownControls = props.footer !== undefined || props.trailing !== undefined;
    const select = (node: ReactNode): ReactNode =>
        onSelect === undefined ? (
            node
        ) : (
            <PressScale
                accessibilityRole="link"
                accessibilityLabel={recipe.title}
                width="fill"
                onPress={() => onSelect(recipe.id)}
            >
                {node}
            </PressScale>
        );
    const asIs = (node: ReactNode): ReactNode => node;
    const surface = (
        <CardSurface>
            {Arrangement === null ? (
                props.children
            ) : (
                <Arrangement
                    link={ownControls ? select : asIs}
                    footer={props.footer}
                    note={props.note}
                    trailing={props.trailing}
                />
            )}
        </CardSurface>
    );

    return (
        <RecipeCardViewContext.Provider value={view}>
            <RecipeCardNutritionContext.Provider value={nutrition}>
                {ownControls ? surface : select(surface)}
            </RecipeCardNutritionContext.Provider>
        </RecipeCardViewContext.Provider>
    );
};

/** The compound card: `<RecipeCard>` plus its parts. */
// PLATFORM-FORK: the compound's part names are the public contract both leaves must expose identically, so a
// surface's custom arrangement works on either platform.
export const RecipeCard = Object.assign(RecipeCardRoot, {
    Cover: CardCover,
    Title: CardTitle,
    Meta: CardMeta,
    Badges: CardBadges,
    Rating: CardRating,
    Tags: CardTags,
});

const styles = StyleSheet.create({
    shell: {
        flexGrow: 1,
        borderRadius: nativeTokens.radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        ...nativeTokens.elevation.sm,
    },
    clip: { flexGrow: 1, borderRadius: nativeTokens.radius.md, overflow: 'hidden' },
    cover: { position: 'relative', width: '100%' },
    thumbnail: {
        position: 'relative',
        width: 80,
        height: 80,
        borderRadius: nativeTokens.radius.md,
        overflow: 'hidden',
    },
    topStart: { position: 'absolute', top: nativeTokens.spacing[2], start: nativeTokens.spacing[2] },
    topEnd: { position: 'absolute', top: nativeTokens.spacing[2], end: nativeTokens.spacing[2] },
    topEndTight: { position: 'absolute', top: nativeTokens.spacing[1], end: nativeTokens.spacing[1] },
    bottomStart: { position: 'absolute', bottom: nativeTokens.spacing[2], start: nativeTokens.spacing[2] },
    coverChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        minHeight: 24,
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: nativeTokens.spacing[2],
        paddingVertical: 2,
    },
    body: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[3],
        paddingBottom: nativeTokens.spacing[4],
        gap: nativeTokens.spacing[1],
    },
    bodyBeforeFooter: { paddingBottom: nativeTokens.spacing[1] },
    footerBox: {
        paddingHorizontal: nativeTokens.spacing[4],
        paddingBottom: nativeTokens.spacing[4],
        paddingTop: nativeTokens.spacing[1],
    },
    compactBody: { padding: nativeTokens.spacing[3] },
    compactFooterBox: { paddingHorizontal: nativeTokens.spacing[3], paddingBottom: nativeTokens.spacing[3] },
    row: { flexDirection: 'row', gap: nativeTokens.spacing[3], padding: nativeTokens.spacing[3], minHeight: 96 },
    rowLink: { flexDirection: 'row', gap: nativeTokens.spacing[3], flex: 1, minWidth: 0 },
    trailingBox: {
        alignItems: 'flex-start',
        marginVertical: -nativeTokens.spacing[1],
        marginEnd: -nativeTokens.spacing[1],
    },
    rowText: { flex: 1, minWidth: 0, gap: nativeTokens.spacing[1] },
    title: { ...nativeTokens.type.cardTitle },
    meta: { ...nativeTokens.type.meta },
    caption: { ...nativeTokens.type.caption },
    figure: { fontVariant: ['tabular-nums', 'lining-nums'] },
    // One line: an item that does not fit wraps to a second line that the fixed height hides, so items drop from the end.
    oneLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[2],
        height: 24,
        overflow: 'hidden',
    },
    wrapLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    lineBox: { minHeight: 18 },
    shrink: { flexShrink: 1 },
    iconItem: { flexDirection: 'row', alignItems: 'center', gap: nativeTokens.spacing[1] },
    trailing: { marginStart: 'auto', flexShrink: 1 },
    stars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
    star: { fontSize: 14, lineHeight: 18 },
    ratingFigure: { marginStart: nativeTokens.spacing[1] },
});
