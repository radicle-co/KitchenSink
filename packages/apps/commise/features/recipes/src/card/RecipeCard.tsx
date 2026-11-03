'use client';

/**
 * @module @commise/features-recipes/card — the web recipe card: one data shape, three variants
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1).
 *
 * - **grid** — a 4:3 cover with its chips, then the title, the meta line (time · difficulty · rating · calories) and
 *   the timestamp. It is a SUBGRID four rows tall, so in a library or Home grid every card's rows line up with its
 *   neighbours' and an empty row keeps its track.
 * - **row** — the list view: an 80 × 80 cover, the title on up to two lines, the same meta line and a status line.
 *
 * No variant shows servings, cuisine, the tags, the version, a cover time chip or a difficulty badge (designer ruling
 * 2026-11-02, `docs/design/uiRefreshWorkshop5/nativeBoards/designAnswers.md`); difficulty is a plain word in the meta line.
 * - **compact** — Home below a 960 container: the cover with its chips, then the title.
 *
 * The variant is decided by `cardVariantOf` in the orchestration layer and handed in; selecting an arrangement of one
 * data shape is display derivation, which a render component may do (§11.1). A custom arrangement of the
 * `RecipeCard.*` parts (`children`) still works for the surfaces that compose their own.
 *
 * The whole card is ONE link (or, with no `href`, one button) named by the title, stretched over the card by a
 * pseudo-element, so nothing is nested inside it. The surface is a level-1 card — `paper`, a `lineDivider` hairline,
 * `shadow-sm`, `shadow-md` on hover with a fine pointer — and never glass (owner ruling D12). Every colour is a role, so
 * the card follows the browser's scheme (D15).
 *
 * The rules the parts draw are decided in `./recipeCardView.ts`, shared with the native leaf: an absent difficulty
 * renders nothing; PRO follows the materialized flag; a draft's status replaces its visibility;
 * an unrated recipe says so.
 *
 * @pattern Compound Component — a Root carrying the view in context, and parts each surface arranges
 * @pattern Registry — the variant's default arrangement, keyed by the closed variant union
 */
import { Icon } from '@commise/ui/icon';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { isModifiedClick } from '@commise/ui/route-link';
import { StatusBadge } from '@commise/ui/status-badge';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { createContext, useContext, type CSSProperties, type FC, type ReactNode } from 'react';

import { GRID_CELL_CLASS } from './cardGridClass.js';
import type { CardVariant } from './cardVariant.js';
import { COVER_CHIP_INSET, COVER_CHIP_PADDING } from './coverChip.js';
import { STAR_COUNT } from './model.js';
import {
    RecipeCardNutritionContext,
    RecipeCardViewContext,
    useCardView,
    type RecipeCardProps,
} from './recipeCardContext.js';
import { useRecipeCardView } from './useRecipeCardView.js';

const STAR_PATH =
    'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

/**
 * One line of items that never wraps: an item that does not fit moves to a second line, which the fixed height hides,
 * so items drop from the END (§4.1 "Items drop from the end").
 */
const ONE_LINE = 'flex flex-wrap content-start items-center gap-x-1 overflow-hidden';

/**
 * A one-line row of TEXT: exactly one line of its own type role (`h-lh`, the `meta` leading), so the second line a
 * dropped item wraps to is hidden entirely. The `h-6` it replaces was taller than the 19.6 px line and let the top
 * 4 px of a dropped item show under it (W-06).
 */
const TEXT_LINE = `${ONE_LINE} h-lh text-meta text-ink-muted`;

/** A one-line row that holds a badge, whose own 24 px (`min-h-6`) is the line. */
const BADGE_LINE = `${ONE_LINE} h-6`;

/**
 * One item of a one-line row. It draws the locale's separator before itself only when a VISIBLE item precedes it
 * (`[:not(:empty)~&]`), so a leading item that is absent or settled on nothing leaves no line-leading dot, and an item
 * whose content is empty (a nutrition slot that settled on nothing) hides with its separator.
 */
const LINE_ITEM_BASE =
    'inline-flex min-w-0 items-center gap-1 empty:hidden [:not(:empty)~&]:before:text-ink-muted [:not(:empty)~&]:before:content-[attr(data-sep)]';

const LINE_ITEM = `${LINE_ITEM_BASE} max-w-full`;

/**
 * The status chip (designer ruling 2026-11-03, reversing W-08's half-cover cap): it takes its content width, up to the
 * row it sits in, and its word never truncates. Its content is the word, then the glyph, in a row drawn right to left
 * that is exactly one line and clips what wraps, so a chip wider than the cover drops the GLYPH and keeps the word.
 */
const STATUS_CHIP =
    'inline-flex h-[max(1.5rem,1lh)] max-w-full flex-row-reverse flex-wrap content-start items-center gap-x-1 overflow-hidden rounded-sm bg-photo-chip text-caption font-medium leading-[max(1.5rem,1lh)] text-ink';

/** The row the status chip and PRO share, placed by the same insets the native card and the fit harness use. */
const COVER_TOP_STYLE: CSSProperties = { top: COVER_CHIP_INSET, left: COVER_CHIP_INSET, right: COVER_CHIP_INSET };

/** The status chip's padding, from `coverChip.ts`, so the number is stated once. */
const STATUS_CHIP_STYLE: CSSProperties = { paddingLeft: COVER_CHIP_PADDING, paddingRight: COVER_CHIP_PADDING };

const Star: FC<{ readonly filled: boolean; readonly extra: boolean }> = ({ filled, extra }) => (
    <svg
        aria-hidden="true"
        // An empty star states the scale, so it is `inkMuted`, never a hairline tone. Stars past the first collapse
        // under a 240 px card, leaving one star and the figure (`homeCardsA.md` §3). Outside that row (the list row) there
        // is no card container, so the list row always shows one star and the figure.
        className={`size-4 ${filled ? 'fill-rating text-rating' : 'text-ink-muted'} ${extra ? 'hidden @min-[13rem]/card:inline' : ''}`}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        viewBox="0 0 20 20"
    >
        <path d={STAR_PATH} />
    </svg>
);

/** The cover: the photo or its monogram, with the status chip and PRO over it. */
const CardCover: FC<{ readonly aspect?: '4:3' | '1:1'; readonly chips?: 'all' | 'pro' }> = ({
    aspect = '4:3',
    chips = 'all',
}) => {
    const { recipe, cover } = useCardView();

    return (
        <div
            className={`relative overflow-hidden ${aspect === '4:3' ? 'rounded-t-md' : 'size-20 shrink-0 rounded-md'}`}
        >
            <RecipeCover
                recipeId={recipe.id}
                title={recipe.title}
                aspect={aspect}
                {...(recipe.coverPhotoUrl === undefined ? {} : { photoUrl: recipe.coverPhotoUrl })}
            />
            {chips === 'all'
                ? (cover.status !== undefined || cover.pro !== undefined) && (
                      // One wrapping row: a second chip that does not fit moves whole to the next line.
                      <div
                          className="absolute flex flex-wrap items-start justify-between gap-1"
                          style={COVER_TOP_STYLE}
                      >
                          {cover.status !== undefined && (
                              <span className={STATUS_CHIP} style={STATUS_CHIP_STYLE}>
                                  <span>{cover.status.text}</span>
                                  <Icon name={cover.status.status === 'draft' ? 'pencilLine' : 'lock'} size={16} />
                              </span>
                          )}
                          {cover.pro !== undefined && (
                              <span aria-label={cover.pro.label}>
                                  <StatusBadge status="pro">{cover.pro.text}</StatusBadge>
                              </span>
                          )}
                      </div>
                  )
                : cover.pro !== undefined && (
                      <span aria-label={cover.pro.label} className="absolute end-1 top-1">
                          <StatusBadge status="pro">{cover.pro.text}</StatusBadge>
                      </span>
                  )}
        </div>
    );
};

/** What the title's link does: navigate by `href` with `onSelect` taking a plain click, or report by button. */
interface CardActivation {
    readonly href?: string;
    readonly onSelect?: (id: string) => void;
}

/**
 * The heading level of the title, from the surface that knows where it sits in the page's outline. Module-private, and
 * the Root always provides it, because its `headingLevel` prop is required.
 */
const HeadingLevelContext = createContext<2 | 3 | undefined>(undefined);

/**
 * The card's one control, present when the card is actionable. Module-private: only the title reads it, so it is not a
 * third exported context.
 */
const CardActivationContext = createContext<CardActivation | undefined>(undefined);

/** The title, carrying the card's one control when the card is actionable. */
const CardTitle: FC = () => {
    const { recipe } = useCardView();
    const activation = useContext(CardActivationContext);
    const level = useContext(HeadingLevelContext);
    const Heading = level === 2 ? 'h2' : 'h3';
    const stretch = 'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none';

    let content: ReactNode = recipe.title;

    if (activation?.href !== undefined) {
        const { href, onSelect } = activation;

        content = (
            <a
                href={href}
                className={stretch}
                onClick={(event) => {
                    if (onSelect !== undefined && !isModifiedClick(event)) {
                        event.preventDefault();
                        onSelect(recipe.id);
                    }
                }}
            >
                {recipe.title}
            </a>
        );
    } else if (activation?.onSelect !== undefined) {
        const { onSelect } = activation;

        content = (
            <button type="button" className={`text-start ${stretch}`} onClick={() => onSelect(recipe.id)}>
                {recipe.title}
            </button>
        );
    }

    return <Heading className="line-clamp-2 text-card-title text-ink">{content}</Heading>;
};

/**
 * The meta line of the grid card and the list row: ⏱ time · difficulty · rating · calories, each only when present. The
 * difficulty is a plain word, never a badge.
 */
const CardMeta: FC = () => {
    const { separator } = useCardView();
    const sep = separator.trim();

    return (
        <div className={TEXT_LINE}>
            <MetaTime sep={sep} />
            <MetaDifficulty sep={sep} />
            <span data-sep={sep} className={LINE_ITEM}>
                <CardRating />
            </span>
            <MetaCalories sep={sep} />
        </div>
    );
};

/**
 * The compact tile's brief meta line (Home): ⏱ time, then calories, each only when present. A line with neither is not
 * drawn at all, so the tile does not hold a blank row (designer, 2026-11-03).
 */
const CardBriefMeta: FC = () => {
    const { meta, separator } = useCardView();
    const nutrition = useContext(RecipeCardNutritionContext);
    const sep = separator.trim();

    if (meta.duration === undefined && nutrition === null) {
        return null;
    }

    return (
        <div className={TEXT_LINE}>
            <MetaTime sep={sep} />
            <MetaCalories sep={sep} />
        </div>
    );
};

/** The time item of a meta line, absent when the recipe has none. */
const MetaTime: FC<{ readonly sep: string }> = ({ sep }) => {
    const { meta } = useCardView();

    return meta.duration === undefined ? null : (
        <span data-sep={sep} aria-label={meta.timeLabel} className={LINE_ITEM}>
            <Icon name="clock" size={16} />
            <span className="tabular-nums lining-nums">{meta.duration}</span>
        </span>
    );
};

/** The difficulty item of a meta line, a plain word, absent when the author stated none. */
const MetaDifficulty: FC<{ readonly sep: string }> = ({ sep }) => {
    const { meta } = useCardView();

    return meta.difficulty === undefined ? null : (
        <span data-sep={sep} className={LINE_ITEM}>
            {meta.difficulty}
        </span>
    );
};

/** The calorie item of a meta line: the surface's nutrition node, which may settle on nothing. */
const MetaCalories: FC<{ readonly sep: string }> = ({ sep }) => {
    const nutrition = useContext(RecipeCardNutritionContext);

    return (
        <span data-sep={sep} className={LINE_ITEM}>
            {nutrition}
        </span>
    );
};

/** The status: Draft, Private or Public as the design-system badge, then the timestamp. */
const CardBadges: FC = () => {
    const { badges } = useCardView();

    return (
        <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={badges.status.status}>{badges.status.text}</StatusBadge>
            <span className="text-caption text-ink-muted">{badges.timestamp}</span>
        </div>
    );
};

/** The rating: display-only. Rated → a named star group and the figure; unrated → "No ratings yet". */
const CardRating: FC = () => {
    const { rating } = useCardView();

    if (rating.kind === 'unrated') {
        return <span className="truncate text-meta text-ink-muted">{rating.text}</span>;
    }

    return (
        <span role="img" aria-label={rating.label} className="inline-flex items-center gap-0.5">
            {Array.from({ length: STAR_COUNT }, (_value, index) => (
                <Star key={index} filled={rating.fills[index] ?? false} extra={index > 0} />
            ))}
            <span aria-hidden="true" className="ms-1 text-meta text-ink tabular-nums lining-nums">
                {rating.short}
            </span>
        </span>
    );
};

/** The timestamp. */
const CardFooter: FC = () => {
    const { badges } = useCardView();

    return <p className="truncate text-caption text-ink-muted">{badges.timestamp}</p>;
};

/** Row line 3: the visibility glyph (or the Draft badge), and the timestamp at the end. */
const RowStatus: FC = () => {
    const { badges, separator } = useCardView();
    const sep = separator.trim();

    return (
        <div className={BADGE_LINE}>
            <span data-sep={sep} className={LINE_ITEM}>
                {badges.status.status === 'draft' ? (
                    <StatusBadge status="draft">{badges.status.text}</StatusBadge>
                ) : (
                    <span className="text-ink-muted">
                        <Icon
                            name={badges.status.status === 'private' ? 'lock' : 'globe'}
                            size={16}
                            label={badges.status.text}
                        />
                    </span>
                )}
            </span>
            {/* Last, so it is the first to drop when the line runs out of room. */}
            <span className="ms-auto truncate ps-2 text-caption text-ink-muted">{badges.timestamp}</span>
        </div>
    );
};

/** What a variant's arrangement may be handed beyond the recipe. */
interface ArrangementSlots {
    readonly footer?: ReactNode;
    readonly note?: ReactNode;
    readonly trailing?: ReactNode;
    readonly showEdited?: boolean;
    readonly fullMeta?: boolean;
}

/**
 * A surface's own controls, lifted above the title link's stretched hit area (`z-10` on a positioned box), so a press
 * lands on the control and not on the card behind it.
 */
const SlotBox: FC<{
    readonly kind: 'footer' | 'trailing';
    readonly className: string;
    readonly children: ReactNode;
}> = ({ kind, className, children }) => (
    <div {...{ [`data-card-${kind}`]: '' }} className={`relative z-10 ${className}`}>
        {children}
    </div>
);

/** The full card's four rows, in the order the grid's subgrid aligns. */
const GridArrangement: FC<ArrangementSlots> = ({ footer }) => (
    <>
        <CardCover />
        <div className="px-4 pt-3">
            <CardTitle />
        </div>
        {/* The card's container for the star collapse lives HERE, not on the article: a container is layout-contained,
            and layout containment turns a subgrid back into a standalone grid, which would unalign the rows. The row is
            the card's width less its 2 × 16 px padding, so 13 rem here is the 240 px card of `homeCardsA.md` §3. */}
        <div className="@container/card px-4 pt-2">
            <CardMeta />
        </div>
        {footer === undefined ? (
            <div className="px-4 pb-4 pt-1">
                <CardFooter />
            </div>
        ) : (
            <SlotBox kind="footer" className="px-4 pb-4 pt-1">
                {footer}
            </SlotBox>
        )}
    </>
);

/** The list row: the thumbnail, then the title and two lines, a note, and a control at the end. */
const RowArrangement: FC<ArrangementSlots> = ({ note, trailing }) => (
    <div className="flex min-h-24 gap-3 p-3">
        <CardCover aspect="1:1" chips="pro" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle />
            <CardMeta />
            <RowStatus />
            {note === undefined ? null : <p className="truncate text-caption text-ink-muted">{note}</p>}
        </div>
        {trailing === undefined ? null : (
            <SlotBox kind="trailing" className="-my-1 -me-1 flex shrink-0 items-start">
                {trailing}
            </SlotBox>
        )}
    </div>
);

/**
 * The compact card: the cover with its chips, then the title, the meta line (brief: time, calories; the whole line when the
 * surface asks with `fullMeta`), the own-recipe footer when the surface asks for it (`showEdited`) and its own footer, if
 * there is one.
 */
const CompactArrangement: FC<ArrangementSlots> = ({ footer, showEdited, fullMeta }) => (
    <>
        <CardCover />
        <div className="p-3">
            <CardTitle />
            {fullMeta === true ? <CardMeta /> : <CardBriefMeta />}
            {footer === undefined && showEdited === true ? <CardFooter /> : null}
        </div>
        {footer === undefined ? null : (
            <SlotBox kind="footer" className="px-3 pb-3">
                {footer}
            </SlotBox>
        )}
    </>
);

/**
 * The default arrangement of each variant: a Registry keyed by the closed variant union, so a variant without an
 * arrangement does not compile.
 */
const ARRANGEMENT: Readonly<Record<CardVariant, FC<ArrangementSlots>>> = {
    grid: GridArrangement,
    row: RowArrangement,
    compact: CompactArrangement,
};

/** The shell each variant sits in. The grid card is a subgrid so its rows align with its neighbours'. */
const SHELL_CLASS: Readonly<Record<CardVariant | 'custom', string>> = {
    grid: GRID_CELL_CLASS,
    row: '',
    compact: 'flex flex-col',
    custom: 'flex flex-col',
};

/**
 * The activation, with absent members omitted rather than set to `undefined` (`exactOptionalPropertyTypes`). Pure.
 *
 * @param href - Where the card leads, if it is a link.
 * @param onSelect - The selection callback, if any.
 * @returns The activation.
 */
function activationOf(href: string | undefined, onSelect: ((id: string) => void) | undefined): CardActivation {
    return { ...(href === undefined ? {} : { href }), ...(onSelect === undefined ? {} : { onSelect }) };
}

const RecipeCardRoot: FC<RecipeCardProps> = (props) => {
    const { recipe, onSelect, href, nutrition = null, headingLevel } = props;
    const view = useRecipeCardView(recipe);
    const Arrangement = props.variant === undefined ? null : ARRANGEMENT[props.variant];
    const actionable = onSelect !== undefined || href !== undefined;
    const variant = props.variant ?? 'custom';

    return (
        <RecipeCardViewContext.Provider value={view}>
            <RecipeCardNutritionContext.Provider value={nutrition}>
                <CardActivationContext.Provider value={actionable ? activationOf(href, onSelect) : undefined}>
                    <HeadingLevelContext.Provider value={headingLevel}>
                        <article
                            aria-label={recipe.title}
                            data-card-variant={variant}
                            className={`relative h-full rounded-md border border-line-divider bg-paper text-start shadow-sm transition-shadow motion-reduce:transition-none ${
                                actionable
                                    ? `${FOCUS_RING_CLASS.within} pointer-fine:hover:shadow-md active:scale-[0.98] motion-reduce:active:scale-100`
                                    : ''
                            } ${SHELL_CLASS[variant]}`}
                        >
                            {Arrangement === null ? (
                                props.children
                            ) : (
                                <Arrangement
                                    footer={props.footer}
                                    note={props.note}
                                    trailing={props.trailing}
                                    showEdited={props.showEdited}
                                    fullMeta={props.fullMeta}
                                />
                            )}
                        </article>
                    </HeadingLevelContext.Provider>
                </CardActivationContext.Provider>
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
});
