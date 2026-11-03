/**
 * @module @commise/features-recipes/card — the native recipe card: one data shape, three variants
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1), the twin of the web leaf.
 *
 * - **grid** — a 4:3 cover with its chips, then the title, the meta line (time · difficulty · rating · calories) and
 *   the timestamp.
 * - **row** — the list view: an 80 × 80 cover, the title on up to two lines, the same meta line and a status line.
 * - **compact** — the cover with its chips, then the title and a brief meta line (time, calories); the whole line with `fullMeta`.
 *
 * The orchestration layer decides the variant with `cardVariantOf`; this leaf draws the arrangement it is handed. The
 * card is ONE pressable link named by the title. Its surface is a level-1 card — `paper`, a `lineDivider` hairline,
 * the `sm` elevation — and never glass (owner ruling D12). Every colour is read from `useTheme()` at render, so the
 * card follows the system scheme (D15); the stylesheet holds layout only.
 *
 * iOS masks a layer's shadow when the same layer clips, so the elevation sits on an outer shell that never clips and the
 * clip on the content view inside it.
 *
 * The meta line wraps and never clips: native has no `:empty`, so it spaces its items with a gap rather than the web's
 * middots — a nutrition slot that settles on nothing would otherwise leave an orphan separator. A part that does not fit
 * moves to the next line. A badge line is a wrapping row of EXACTLY one line's height (`./oneLine.ts`, scaled by the OS
 * font scale), so an item that does not fit wraps to a second line that is fully hidden (W-06).
 *
 * No variant shows servings, cuisine, the tags, the version, a cover time chip or a difficulty badge (designer ruling
 * 2026-11-02, `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`); difficulty is a plain word in the meta line.
 *
 * @pattern Compound Component — a Root carrying the view in context, and parts each surface arranges
 * @pattern Registry — the variant's default arrangement, keyed by the closed variant union
 */
import { nativeTokens } from '@commise/ui/native';
import { Icon } from '@commise/ui/icon';
import { PressScale } from '@commise/ui/press-scale';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { StatusBadge } from '@commise/ui/status-badge';
import { useTheme } from '@commise/ui/theme';
import { createContext, useContext, type FC, type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { CardVariant } from './cardVariant.js';
import { META_SEPARATOR, MetaLeadContext, metaRunOf } from './metaRun.js';
import { COVER_CHIP_INSET, COVER_CHIP_PADDING, COVER_CHIP_PADDING_V } from './coverChip.js';
import { badgeLineHeightOf, metaLineHeightOf } from './oneLine.js';
import {
    RecipeCardNutritionContext,
    RecipeCardViewContext,
    useCardView,
    type RecipeCardProps,
} from './recipeCardContext.js';
import { useRecipeCardView } from './useRecipeCardView.js';

/**
 * The OS font scale, read once by the Root. Module-private: only the one-line rows read it, and the card's view stays a
 * pure derivation of the model that does not depend on the device.
 */
const FontScaleContext = createContext(1);

/** One line of a card that holds a badge: a wrapping row of exactly the badge line's height, hiding what does not fit. */
const OneLine: FC<{ readonly children: ReactNode }> = ({ children }) => {
    const fontScale = useContext(FontScaleContext);
    const height = badgeLineHeightOf(fontScale);

    return <View style={[styles.oneLine, { height }]}>{children}</View>;
};

/**
 * A wrapping row (the meta line; the status and timestamp) with no fixed height, no clip and no truncation, so no part
 * with data is ever hidden. A part that does not fit moves to the next line (designer ruling 2026-11-03, Android QA on
 * 7ae95db2e).
 */
const WrapLine: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <View style={styles.wrapLine}>{children}</View>
);

/**
 * A cover chip: solid `photoChip`, `ink`, the `sm` radius.
 *
 * `oneLine` is the status chip (designer ruling 2026-11-03): its word, then its glyph, drawn right to left in a row that is
 * exactly one line and clips what wraps, so a chip wider than the cover drops the GLYPH (the last item to wrap) and keeps
 * the word. The line is the meta line scaled by the OS font scale, as the card's other one-line rows are.
 */
const CoverChip: FC<{ readonly children: ReactNode; readonly label?: string; readonly oneLine?: boolean }> = ({
    children,
    label,
    oneLine = false,
}) => {
    const { colors } = useTheme();
    const fontScale = useContext(FontScaleContext);

    return (
        <View
            collapsable={false}
            {...(label === undefined ? {} : { accessible: true, accessibilityLabel: label })}
            style={[
                styles.coverChip,
                oneLine && styles.chipLine,
                oneLine && { height: metaLineHeightOf(fontScale) + 2 * COVER_CHIP_PADDING_V },
                { backgroundColor: colors.photoChip },
            ]}
        >
            {children}
        </View>
    );
};

/** The cover: the photo or its monogram, with the status chip and PRO over it. */
const CardCover: FC<{ readonly thumbnail?: boolean }> = ({ thumbnail = false }) => {
    const { recipe, cover } = useCardView();
    const { colors } = useTheme();

    return (
        // Kept, so the thumbnail's clipping never moves the cover into it (`nativeFlattenFlips.test.ts`).
        <View collapsable={false} style={thumbnail ? styles.thumbnail : styles.cover}>
            <RecipeCover
                recipeId={recipe.id}
                title={recipe.title}
                aspect={thumbnail ? '1:1' : '4:3'}
                {...(recipe.coverPhotoUrl === undefined ? {} : { photoUrl: recipe.coverPhotoUrl })}
            />
            {thumbnail
                ? cover.pro !== undefined && (
                      <View accessible accessibilityLabel={cover.pro.label} style={styles.topEndTight}>
                          <StatusBadge status="pro">{cover.pro.text}</StatusBadge>
                      </View>
                  )
                : (cover.status !== undefined || cover.pro !== undefined) && (
                      // One wrapping row: a second chip that does not fit moves whole to the next line.
                      <View style={styles.coverTop}>
                          {cover.status !== undefined && (
                              <CoverChip oneLine label={cover.status.text}>
                                  <Text style={[styles.caption, { color: colors.ink }]}>{cover.status.text}</Text>
                                  <Icon
                                      name={cover.status.status === 'draft' ? 'pencilLine' : 'lock'}
                                      size={16}
                                      tone="ink"
                                  />
                              </CoverChip>
                          )}
                          {cover.pro !== undefined && (
                              <View accessible accessibilityLabel={cover.pro.label}>
                                  <StatusBadge status="pro">{cover.pro.text}</StatusBadge>
                              </View>
                          )}
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

/** The rating as the run's part: "No ratings yet", or the star with the figure ("★ 4.8 (12)"), named as one unit. */
const RatingPart: FC = () => {
    const { rating } = useCardView();
    const { colors } = useTheme();

    if (rating.kind === 'unrated') {
        return rating.text;
    }

    return (
        <Text accessibilityRole="image" accessibilityLabel={rating.label} style={styles.figure}>
            <Text style={{ color: colors.rating }}>★</Text> {rating.short}
        </Text>
    );
};

/** The time as the run's part, absent when the recipe has none. */
const TimePart: FC = () => {
    const { meta } = useCardView();

    return meta.duration === undefined ? null : <Text style={styles.figure}>{meta.duration}</Text>;
};

/**
 * The calorie figure at the end of a run. It draws its own lead (the separator) when it has something to say, so a figure
 * that settles on nothing leaves no dot behind (`MetaLeadContext`).
 */
const MetaCalories: FC<{ readonly hasLead: boolean }> = ({ hasLead }) => {
    const nutrition = useContext(RecipeCardNutritionContext);

    return <MetaLeadContext.Provider value={hasLead ? META_SEPARATOR : ''}>{nutrition}</MetaLeadContext.Provider>;
};

/** The meta line's text: one run in the muted meta style. It wraps like text, with no clip and no `numberOfLines`. */
const MetaRun: FC<{ readonly children: ReactNode }> = ({ children }) => {
    const { colors } = useTheme();

    return <Text style={[styles.meta, { color: colors.inkMuted }]}>{children}</Text>;
};

/**
 * The meta line of the grid card and the list row: ONE run of text, time · difficulty · rating · calories, each only when
 * present (UI Designer ruling, 2026-11-03). The star stays with the rating, and there is no clock glyph.
 */
const CardMeta: FC = () => {
    const { meta } = useCardView();
    const hasTime = meta.duration !== undefined;
    const run = metaRunOf([
        hasTime ? <TimePart key="time" /> : undefined,
        meta.difficulty,
        <RatingPart key="rating" />,
    ]);

    return (
        <MetaRun>
            {run}
            <MetaCalories hasLead={run.length > 0} />
        </MetaRun>
    );
};

/**
 * The compact tile's brief run (Home, a collection's members): time, then calories, each only when present. A run with
 * neither is not drawn at all, so the tile does not hold a blank row (UI Designer ruling, 2026-11-03).
 */
const CardBriefMeta: FC = () => {
    const { meta } = useCardView();
    const nutrition = useContext(RecipeCardNutritionContext);
    const run = metaRunOf([meta.duration === undefined ? undefined : <TimePart key="time" />]);

    if (run.length === 0 && nutrition === null) {
        return null;
    }

    return (
        <MetaRun>
            {run}
            <MetaCalories hasLead={run.length > 0} />
        </MetaRun>
    );
};

/** The status as the design-system badge, and the timestamp. */
const CardBadges: FC = () => {
    const { badges } = useCardView();
    const { colors } = useTheme();

    return (
        <WrapLine>
            <StatusBadge status={badges.status.status}>{badges.status.text}</StatusBadge>
            <Text style={[styles.caption, { color: colors.inkMuted }]}>{badges.timestamp}</Text>
        </WrapLine>
    );
};

/** The timestamp. */
const CardFooter: FC = () => {
    const { badges } = useCardView();
    const { colors } = useTheme();

    return (
        <Text numberOfLines={1} style={[styles.caption, { color: colors.inkMuted }]}>
            {badges.timestamp}
        </Text>
    );
};

/**
 * Row line 3: the Draft or Private badge, then the timestamp. A public recipe shows no status mark, and a glyph alone is
 * never a status (UI Designer ruling, 2026-11-03).
 */
const RowStatus: FC = () => {
    const { badges } = useCardView();
    const { colors } = useTheme();

    return (
        <OneLine>
            {badges.status.status === 'public' ? null : (
                <StatusBadge status={badges.status.status}>{badges.status.text}</StatusBadge>
            )}
            <Text numberOfLines={1} style={[styles.caption, styles.trailing, { color: colors.inkMuted }]}>
                {badges.timestamp}
            </Text>
        </OneLine>
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
    readonly showEdited?: boolean;
    readonly fullMeta?: boolean;
}

const GridArrangement: FC<ArrangementSlots> = ({ link, footer }) => (
    <>
        {link(
            <>
                <CardCover />
                <View style={[styles.body, footer !== undefined && styles.bodyBeforeFooter]}>
                    <CardTitle />
                    <CardMeta />
                    {footer === undefined ? <CardFooter /> : null}
                </View>
            </>,
        )}
        {footer === undefined ? null : <View style={styles.footerBox}>{footer}</View>}
    </>
);

const RowArrangement: FC<ArrangementSlots> = ({ link, note, trailing }) => (
    <View style={styles.row}>
        {/* The link's `PressScale fill` is `alignSelf: stretch`, which in a ROW stretches height and not width: without
            this box a card with its own trailing control gave the link no width, and the title and meta drew in none. */}
        <View style={styles.rowLinkBox}>
            {link(
                <View style={styles.rowLink}>
                    <CardCover thumbnail />
                    <View style={styles.rowText}>
                        <CardTitle />
                        <CardMeta />
                        <RowStatus />
                        {note === undefined ? null : <NoteLine>{note}</NoteLine>}
                    </View>
                </View>,
            )}
        </View>
        {trailing === undefined ? null : <View style={styles.trailingBox}>{trailing}</View>}
    </View>
);

const CompactArrangement: FC<ArrangementSlots> = ({ link, footer, showEdited, fullMeta }) => (
    <>
        {link(
            <>
                <CardCover />
                <View style={styles.compactBody}>
                    <CardTitle />
                    {fullMeta === true ? <CardMeta /> : <CardBriefMeta />}
                    {footer === undefined && showEdited === true ? <CardFooter /> : null}
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
    const { fontScale } = useWindowDimensions();
    const Arrangement = props.variant === undefined ? null : ARRANGEMENT[props.variant];
    // The link sits INSIDE the surface when the card has controls of its own, and on the tiles that share a grid row: the
    // surface must be the outermost box to grow to the tallest tile's height, and a press frame around it would hold it at
    // its content height (UI Designer ruling, 2026-11-03). A row and a custom arrangement keep the whole card as the link.
    const linkInside =
        props.footer !== undefined ||
        props.trailing !== undefined ||
        props.variant === 'grid' ||
        props.variant === 'compact';
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
                    link={linkInside ? select : asIs}
                    footer={props.footer}
                    note={props.note}
                    trailing={props.trailing}
                    showEdited={props.showEdited}
                    fullMeta={props.fullMeta}
                />
            )}
        </CardSurface>
    );

    return (
        <RecipeCardViewContext.Provider value={view}>
            <RecipeCardNutritionContext.Provider value={nutrition}>
                <FontScaleContext.Provider value={fontScale}>
                    {linkInside ? surface : select(surface)}
                </FontScaleContext.Provider>
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
    // The status chip and PRO share one wrapping row (designer ruling 2026-11-03, reversing W-08's half-cover cap): the
    // chip takes its content width, and PRO moves whole to the next line when the two do not fit.
    coverTop: {
        position: 'absolute',
        top: COVER_CHIP_INSET,
        start: COVER_CHIP_INSET,
        end: COVER_CHIP_INSET,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: nativeTokens.spacing[1],
    },
    topEndTight: { position: 'absolute', top: nativeTokens.spacing[1], end: nativeTokens.spacing[1] },
    coverChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: nativeTokens.spacing[1],
        minHeight: 24,
        maxWidth: '100%',
        borderRadius: nativeTokens.radius.sm,
        paddingHorizontal: COVER_CHIP_PADDING,
        paddingVertical: COVER_CHIP_PADDING_V,
    },
    // One line, drawn right to left, clipping what wraps: the glyph wraps first and the word stays.
    chipLine: {
        flexDirection: 'row-reverse',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[1],
        overflow: 'hidden',
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
    rowLinkBox: { flex: 1, minWidth: 0 },
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
    // One badge line: an item that does not fit wraps to a second line that the row's height (`OneLine`) hides entirely, so
    // items drop from the end.
    oneLine: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: nativeTokens.spacing[2],
        overflow: 'hidden',
    },
    wrapLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: nativeTokens.spacing[2] },
    trailing: { marginStart: 'auto', flexShrink: 1 },
});
