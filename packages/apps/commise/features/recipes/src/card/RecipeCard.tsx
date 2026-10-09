'use client';

/**
 * @module @commise/features-recipes/card — the web recipe card: one data shape, three variants
 * (`docs/design/uiOverhaul/buildSpec.md` §4.1).
 *
 * - **grid** — the full CR-002 card: a 4:3 cover with its chips, then five rows (title; difficulty · rating; cuisine ·
 *   calories · servings; the tags as text; the version and the timestamp). It is a SUBGRID six rows tall, so in a
 *   library or Home grid every card's rows line up with its neighbours' and an empty row keeps its track.
 * - **row** — the list view: an 80 × 80 cover, the title on up to two lines, a meta line and a status line. It is the
 *   only variant that drops fields (the tags and the version wait for the detail page).
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
 * The rules the parts draw are decided in `./recipeCardView.ts`, shared with the native leaf: an absent difficulty,
 * cuisine or tag list renders nothing; PRO follows the materialized flag; a draft's status replaces its visibility;
 * an unrated recipe says so.
 *
 * @pattern Compound Component — a Root carrying the view in context, and parts each surface arranges
 * @pattern Registry — the variant's default arrangement, keyed by the closed variant union
 */
import { DifficultyBadge } from '@commise/ui/difficulty-badge';
import { Icon } from '@commise/ui/icon';
import { RecipeCover } from '@commise/ui/recipe-cover';
import { StatusBadge } from '@commise/ui/status-badge';
import { createContext, useContext, type FC, type MouseEvent, type ReactNode } from 'react';

import type { CardVariant } from './cardVariant.js';
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
 * so items drop from the END (§4.1 "Items drop from the end"). Each item after the first draws the locale's separator
 * before itself, and an item whose content is empty (a nutrition slot that settled on nothing) hides with its separator.
 */
const ONE_LINE = 'flex h-6 flex-wrap content-start items-center gap-x-1 overflow-hidden';

/** One item of a {@link ONE_LINE} line. */
const LINE_ITEM =
    'inline-flex min-w-0 max-w-full items-center gap-1 empty:hidden not-first:before:text-ink-muted not-first:before:content-[attr(data-sep)]';

/** The overlay chips on a cover: solid `photoChip`, `ink`, the `sm` radius (§4.1 row 1). */
const COVER_CHIP =
    'inline-flex min-h-6 items-center gap-1 rounded-sm bg-photo-chip px-2 py-0.5 text-caption font-medium text-ink';

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

/** The cover: the photo or its monogram, with the status chip, PRO and the time chip over it. */
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
                {...(recipe.cuisine === undefined ? {} : { cuisine: recipe.cuisine })}
                {...(recipe.coverPhotoUrl === undefined ? {} : { photoUrl: recipe.coverPhotoUrl })}
            />
            {chips === 'all' && cover.status !== undefined && (
                <span className={`absolute start-2 top-2 ${COVER_CHIP}`}>
                    <Icon name={cover.status.status === 'draft' ? 'pencilLine' : 'lock'} size={16} />
                    {cover.status.text}
                </span>
            )}
            {cover.pro !== undefined && (
                <span
                    aria-label={cover.pro.label}
                    className={`absolute ${aspect === '4:3' ? 'end-2 top-2' : 'end-1 top-1'}`}
                >
                    <StatusBadge status="pro">{cover.pro.text}</StatusBadge>
                </span>
            )}
            {chips === 'all' && (
                <span aria-label={cover.time.label} className={`absolute bottom-2 start-2 ${COVER_CHIP}`}>
                    <Icon name="clock" size={16} />
                    <span className="tabular-nums lining-nums">{cover.time.text}</span>
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
 * The card's one control, present when the card is actionable. Module-private: only the title reads it, so it is not a
 * third exported context.
 */
const CardActivationContext = createContext<CardActivation | undefined>(undefined);

/**
 * Whether a click should be handed to `onSelect` instead of following the link: a plain primary click only, so a
 * modified click (new tab, new window) keeps the browser's own behaviour.
 *
 * @param event - The click.
 * @returns `true` for a plain primary click.
 */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** The title, carrying the card's one control when the card is actionable. */
const CardTitle: FC = () => {
    const { recipe } = useCardView();
    const activation = useContext(CardActivationContext);
    const stretch = 'after:absolute after:inset-0 after:content-[""] focus-visible:outline-none';

    let content: ReactNode = recipe.title;

    if (activation?.href !== undefined) {
        const { href, onSelect } = activation;

        content = (
            <a
                href={href}
                className={stretch}
                onClick={(event) => {
                    if (onSelect !== undefined && isPlainClick(event)) {
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

    return <h3 className="line-clamp-2 text-card-title text-ink">{content}</h3>;
};

/** Difficulty, then the rating: one line, the rating dropping first. */
const CardDifficultyRating: FC = () => {
    const { meta, separator } = useCardView();

    return (
        <div className={ONE_LINE}>
            {meta.difficulty !== undefined && (
                <span data-sep={separator.trim()} className={LINE_ITEM}>
                    <DifficultyBadge level={meta.difficulty.level}>{meta.difficulty.label}</DifficultyBadge>
                </span>
            )}
            <span data-sep={separator.trim()} className={LINE_ITEM}>
                <CardRating />
            </span>
        </div>
    );
};

/** The meta row of the grid card: cuisine · calories · servings, each only when present. */
const CardMeta: FC = () => {
    const { recipe, meta, separator } = useCardView();
    const nutrition = useContext(RecipeCardNutritionContext);
    const sep = separator.trim();

    return (
        <div className={`${ONE_LINE} text-meta text-ink-muted`}>
            {recipe.cuisine !== undefined && (
                <span data-sep={sep} className={LINE_ITEM}>
                    <span className="truncate">{recipe.cuisine}</span>
                </span>
            )}
            <span data-sep={sep} className={LINE_ITEM}>
                {nutrition}
            </span>
            <span data-sep={sep} aria-label={meta.servingsLabel} className={LINE_ITEM}>
                {meta.servingsText}
            </span>
        </div>
    );
};

/** The status: Draft, Private or Public as the design-system badge, then the version and the timestamp. */
const CardBadges: FC = () => {
    const { badges } = useCardView();

    return (
        <div className="flex flex-wrap items-center gap-2">
            {badges.version !== undefined && (
                <span aria-label={badges.version.label} className="text-caption text-ink-muted">
                    {badges.version.text}
                </span>
            )}
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

/** The tags as one line of text. An empty line keeps its track in the grid. */
const CardTags: FC = () => {
    const { tags } = useCardView();

    return (
        <p className="truncate text-caption text-ink-muted" {...(tags === undefined ? {} : { title: tags.label })}>
            {tags?.text}
        </p>
    );
};

/** The version (past v1) and the timestamp. */
const CardFooter: FC = () => {
    const { footer } = useCardView();

    return <p className="truncate text-caption text-ink-muted">{footer}</p>;
};

/** Row line 2: ⏱ total · 👥 servings · cuisine · calories, dropping from the end. */
const RowMeta: FC = () => {
    const { recipe, meta, separator } = useCardView();
    const nutrition = useContext(RecipeCardNutritionContext);
    const sep = separator.trim();

    return (
        <div className={`${ONE_LINE} text-meta text-ink-muted`}>
            {recipe.cuisine !== undefined && (
                <span data-sep={sep} className={LINE_ITEM}>
                    <span className="truncate">{recipe.cuisine}</span>
                </span>
            )}
            <span data-sep={sep} aria-label={meta.timeLabel} className={LINE_ITEM}>
                <Icon name="clock" size={16} />
                <span className="tabular-nums lining-nums">{meta.duration}</span>
            </span>
            <span data-sep={sep} aria-label={meta.servingsLabel} className={LINE_ITEM}>
                <Icon name="users" size={16} />
                <span className="tabular-nums lining-nums">{recipe.servings}</span>
            </span>
            <span data-sep={sep} className={LINE_ITEM}>
                {nutrition}
            </span>
        </div>
    );
};

/** Row line 3: difficulty · rating · the visibility glyph (or the Draft badge), and the timestamp at the end. */
const RowStatus: FC = () => {
    const { meta, badges, separator } = useCardView();
    const sep = separator.trim();

    return (
        <div className={ONE_LINE}>
            {meta.difficulty !== undefined && (
                <span data-sep={sep} className={LINE_ITEM}>
                    <DifficultyBadge level={meta.difficulty.level}>{meta.difficulty.label}</DifficultyBadge>
                </span>
            )}
            <span data-sep={sep} className={LINE_ITEM}>
                <CardRating />
            </span>
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

/** The full card's six rows, in the order the grid's subgrid aligns. */
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
            <CardDifficultyRating />
        </div>
        <div className="px-4 pt-1">
            <CardMeta />
        </div>
        <div className="px-4 pt-1">
            <CardTags />
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
            <RowMeta />
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

/** The compact card: the cover with its chips, then the title and the footer, if there is one. */
const CompactArrangement: FC<ArrangementSlots> = ({ footer }) => (
    <>
        <CardCover />
        <div className="p-3">
            <CardTitle />
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
    grid: 'row-span-6 grid grid-rows-subgrid gap-0',
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
    const { recipe, onSelect, href, nutrition = null } = props;
    const view = useRecipeCardView(recipe);
    const Arrangement = props.variant === undefined ? null : ARRANGEMENT[props.variant];
    const actionable = onSelect !== undefined || href !== undefined;
    const variant = props.variant ?? 'custom';

    return (
        <RecipeCardViewContext.Provider value={view}>
            <RecipeCardNutritionContext.Provider value={nutrition}>
                <CardActivationContext.Provider value={actionable ? activationOf(href, onSelect) : undefined}>
                    <article
                        aria-label={recipe.title}
                        data-card-variant={variant}
                        className={`relative h-full rounded-md border border-line-divider bg-paper text-start shadow-sm transition-shadow motion-reduce:transition-none ${
                            actionable
                                ? 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas pointer-fine:hover:shadow-md active:scale-[0.98] motion-reduce:active:scale-100'
                                : ''
                        } ${SHELL_CLASS[variant]}`}
                    >
                        {Arrangement === null ? (
                            props.children
                        ) : (
                            <Arrangement footer={props.footer} note={props.note} trailing={props.trailing} />
                        )}
                    </article>
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
    Tags: CardTags,
});
