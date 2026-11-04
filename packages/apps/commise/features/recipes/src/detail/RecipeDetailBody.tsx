'use client';

/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block; `docs/design/uiOverhaul/buildSpec.md`
 * §6, the first slice of 008 FR-035).
 *
 * The PURE render half of the recipe page, in reading order: the hero, the back link, the rating card, the cuisine eyebrow
 * and the title, the status row, the source line and byline, the fact tiles, the actions, the Screen on row, the
 * description and the tags; then the body — one column below a 720 px body, and from 720 two columns, ingredients (5/12,
 * sticky with its own scroll) beside the steps (7/12), with the review surface under the steps. The collapsed Nutrition
 * row sits before the columns, full width.
 *
 * There is no section switch (`nativeBoards/buildLists.md`): the page is one scroll. Left out until their features
 * ship (`designAnswers.md` section "2026-11-02: card, Home header and Recipe detail build questions", bullets
 * "8 comments" row and "Start cooking"): the comments row and "Start cooking".
 *
 * Every width rule is a CONTAINER query on the article (`@container/detail`), never a script measurement, so the
 * server render and the hydrated page are the same page. "Screen on" is a labelled row, and the toggle itself renders
 * nothing where the browser cannot keep the screen awake.
 *
 * Its orchestration shell — `RecipeDetailView.tsx`, which binds the serving scale, the cook's marks, Screen on and
 * the description's disclosure — is a separate file because a file does ONE thing (CODING_STANDARDS §1).
 *
 * @pattern Humble Object — the pure render half of the orchestration/render split whose shell is
 *     `RecipeDetailView.tsx`. It holds no fetch state and decides nothing.
 */
import { useMessages } from '@commise/i18n/react';
import { Button, buttonSurfaceClass } from '@commise/ui/button';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { Icon } from '@commise/ui/icon';
import { KeepAwakeToggle } from '@commise/ui/keep-awake';
import { LARGE_TITLE_CLASS } from '@commise/ui/large-title-header';
import { LiveRegion } from '@commise/ui/live-region';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { StatusBadge } from '@commise/ui/status-badge';
import { surfaceToneClass } from '@commise/ui/surface-tone';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import Link from 'next/link';
import { useId, type ComponentProps, type FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { bylineMessages } from '../byline/messages.js';
import { AmbiguityReview } from './AmbiguityReview.js';
import { DetailEmptySection } from './DetailEmptySection.js';
import { DetailNutritionSection } from './DetailNutritionSection.js';
import {
    detailByline,
    detailEyebrow,
    detailStatCells,
    detailStatusLine,
    ingredientGroupRuns,
    isLongDescription,
} from './detailFacts.js';
import {
    BODY_GRID,
    DETAIL_ARTICLE,
    DETAIL_TOP_GRID,
    HEADER_BESIDE_PHOTO,
    HEADER_UNDER_BAND,
    HERO_BAND_CELL,
    HERO_PHOTO_CELL,
    INGREDIENTS_COLUMN,
    STEPS_COLUMN,
} from './detailLayoutClasses.js';
import { IngredientCheckRow } from './IngredientCheckRow.js';
import { allLinesFoodRemoved, detailNoticeState, removedFoodNotice, type RecipeDetailBodyProps } from './model.js';
import { RecipeHero } from './RecipeHero.js';
import { RecipeSourceLine } from './RecipeSourceLine.js';
import { ServingScaleControl } from './ServingScaleControl.js';
import { StepRow } from './StepRow.js';

/** A Next.js link target from a plain address. */
type Href = ComponentProps<typeof Link>['href'];

/*
 * The 720 px body breakpoint (§6.1) is the container variant `@min-[45rem]/detail:`. ⛔ Every class that uses it is
 * written out IN FULL below: Tailwind generates only the class names it finds whole in the source, so a variant
 * prefix concatenated at run time produces no CSS at all and the page silently stays one column.
 */

/** A section heading: `sectionTitle`, focusable so the owner's Edit and a recovery can move the cursor to it. */
const SECTION_HEADING = 'text-section-title text-ink focus:outline-none';

/** The owner's ghost Edit link on a section heading: the ghost button surface. */
const EDIT_LINK = buttonSurfaceClass('ghost', { size: 'sm' });

/** The glyph on each fact tile: the native tiles draw the same ones. */
const TILE_GLYPH = { total: 'clock', prep: 'timer', difficulty: 'chartColumn' } as const;

/**
 * The pure `props → JSX` detail render: no state, no fetching, no ref of its own. Everything it shows for a chosen
 * serving count comes from `scaleRecipeForServings`, so what scales (and what deliberately does not) is decided once,
 * in the domain, for both platforms.
 *
 * Exported for tests and for its shell; deliberately NOT on the package barrel — an app composes `RecipeDetailView`.
 */
export const RecipeDetailBody: FC<RecipeDetailBodyProps> = ({
    recipe,
    headerActions,
    back,
    heroControls,
    rating,
    servings,
    onServingsChange,
    refreshNotice,
    unreachableRetry,
    dataSourcesHref,
    editHref,
    versionsHref,
    viewerIsOwner,
    visibilityNotice,
    marks,
    screenOn,
    descriptionExpanded,
    onToggleDescription,
    nutritionExpanded,
    onToggleNutrition,
}) => {
    const { detail, duration, card } = useMessages(recipeMessages);
    const bylineCopy = useMessages(bylineMessages);
    const owner = viewerIsOwner === true;
    const noPhoto = recipe.photos.length === 0;
    // A retry from the refresh notice that succeeds removes the button the viewer pressed, so focus goes to the title.
    const titleRef = useFocusOnSignal<HTMLHeadingElement>(refreshNotice?.recoveries ?? 0);
    // Plan 002 R2 — ONE notice per recipe for the lines food could not be asked about, read from the STORED lines.
    const { unreachable, pageRefreshFailed, saysRecovered } = detailNoticeState(
        recipe.ingredients,
        detail,
        refreshNotice,
        unreachableRetry,
    );
    // `recoveries` counts only retries that loaded EVERY name, so focus moves to this heading only when the button the
    // cook pressed is gone.
    const ingredientsHeadingRef = useFocusOnSignal<HTMLHeadingElement>(unreachableRetry.recoveries);
    const recoveredDescriptionId = useId();
    const descriptionId = useId();
    const removedNotice = removedFoodNotice(recipe.ingredients, detail);
    const allRemoved = allLinesFoodRemoved(recipe.ingredients);
    // ONE derivation of what the chosen serving count means; cook time and step timers stay as stored.
    const scaled = scaleRecipeForServings(recipe, servings);
    const tiles = detailStatCells(scaled, recipe.difficulty, { detail, duration, card });
    const eyebrow = detailEyebrow(recipe);
    const byline = detailByline(recipe, owner, detail, bylineCopy);
    const status = detailStatusLine(recipe, owner, { detail, card });
    const tags = [...recipe.dietaryFlags, ...recipe.tags];
    const editSectionHref = (section: string): Href | undefined =>
        owner && editHref !== undefined ? (`${editHref}#${section}` as Href) : undefined;
    const ingredientsEdit = editSectionHref('ingredients');
    const stepsEdit = editSectionHref('steps');

    return (
        // No gutter of its own and no centring: `<main>` owns the page gutter (16 below 600, `buildSpec.md` §1.2), and
        // content is left-aligned to it (§1.3). A second `px-4` drew a 32 px phone gutter on this page alone (F15).
        <article aria-label={recipe.title} className={DETAIL_ARTICLE}>
            <div className={DETAIL_TOP_GRID}>
                {/* The hero IS the carousel, so the cover shows once (F2). From a 960 body it sits at the END, 7/12. */}
                <div className={noPhoto ? HERO_BAND_CELL : HERO_PHOTO_CELL}>
                    <RecipeHero
                        title={recipe.title}
                        photos={recipe.photos}
                        {...(heroControls === undefined ? {} : { overlay: heroControls })}
                    />
                </div>
                <header className={`flex min-w-0 flex-col gap-3 ${noPhoto ? HEADER_UNDER_BAND : HEADER_BESIDE_PHOTO}`}>
                    {back}
                    {/* The rating card leads the header: the whole rating, summary and input, lives in it (D3). */}
                    {rating}
                    {eyebrow !== undefined && <p className="text-label text-ink-muted">{eyebrow}</p>}
                    {/* `min-w-0`: a recipe title is user-authored and unbounded, and it wraps; it is never clamped. Manrope
                        `largeTitle`, the header primitive's class, so the title cannot lose its face again (F8). */}
                    <h1 ref={titleRef} tabIndex={-1} className={`min-w-0 focus:outline-none ${LARGE_TITLE_CLASS}`}>
                        {recipe.title}
                    </h1>
                    {(status !== undefined || versionsHref !== undefined) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-4 text-meta text-ink-muted">
                            {status?.kind === 'draft' && <StatusBadge status="draft">{status.text}</StatusBadge>}
                            {status?.kind === 'visibility' && (
                                <span className="inline-flex items-center gap-1 text-ink-muted">
                                    <Icon name={status.visibility === 'public' ? 'globe' : 'lock'} size={16} />
                                    {status.text}
                                </span>
                            )}
                            {versionsHref !== undefined && (
                                <Link href={versionsHref as Href} className={EDIT_LINK}>
                                    {detail.versionHistory}
                                </Link>
                            )}
                        </div>
                    )}
                    {/* The owner's visibility notice (§6.4): assertive, mounted empty and filled one render later by the host. */}
                    {owner && (
                        <LiveRegion politeness="assertive" className="text-meta text-danger-text">
                            {visibilityNotice ?? ''}
                        </LiveRegion>
                    )}
                    {/* Provenance renders for EVERY viewer: it is a property of the recipe. */}
                    <RecipeSourceLine
                        {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                        {...(recipe.sourceAttribution === undefined
                            ? {}
                            : { sourceAttribution: recipe.sourceAttribution })}
                    />
                    {byline !== undefined && <p className="text-meta text-ink-muted">{byline}</p>}
                    {tiles.length > 0 && (
                        <dl className="flex flex-wrap gap-2">
                            {tiles.map((tile) => (
                                <div
                                    key={tile.id}
                                    className="flex min-w-[6.25rem] flex-1 flex-col-reverse justify-end gap-1 rounded-lg bg-cover-steel p-3"
                                >
                                    <dt className="flex items-center gap-1 text-caption text-ink-muted">
                                        <Icon name={TILE_GLYPH[tile.id]} size={16} />
                                        {tile.label}
                                    </dt>
                                    <dd className="text-figure-stat text-ink">{tile.value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    {/* The action row: the host's text action (Edit recipe, Save a copy), then Screen on, a quiet action with the sun glyph
                        (which renders nothing where the browser cannot keep the screen awake). */}
                    <div className="flex flex-wrap items-center gap-2 empty:hidden">
                        {headerActions}
                        <KeepAwakeToggle
                            on={screenOn.on}
                            onChange={screenOn.onChange}
                            label={detail.screenOn}
                            hint={detail.screenOnHint}
                        />
                    </div>
                    {recipe.description !== '' && (
                        <div className="flex flex-col items-start gap-1">
                            <p
                                id={descriptionId}
                                className={`max-w-[62ch] text-reading-body text-ink ${
                                    descriptionExpanded ? '' : 'line-clamp-4 @min-[37.5rem]/detail:line-clamp-none'
                                }`}
                            >
                                {recipe.description}
                            </p>
                            {isLongDescription(recipe.description) && (
                                <button
                                    type="button"
                                    aria-expanded={descriptionExpanded}
                                    aria-controls={descriptionId}
                                    onClick={onToggleDescription}
                                    className={`${buttonSurfaceClass('ghost')} @min-[37.5rem]/detail:hidden`}
                                >
                                    {descriptionExpanded ? detail.descriptionLess : detail.descriptionMore}
                                </button>
                            )}
                        </div>
                    )}
                    {tags.length > 0 && <p className="text-meta text-ink-muted">{tags.join(' · ')}</p>}
                </header>
            </div>

            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={pageRefreshFailed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: detail.refreshError, retry: detail.refreshRetry }}
                />
            )}

            {/* The Nutrition row comes before the columns, full width (`RecipeDetailAndroid384` item 12, `RecipeDetailWeb1024`). */}
            <DetailNutritionSection
                recipe={recipe}
                expanded={nutritionExpanded}
                onToggle={onToggleNutrition}
                {...(dataSourcesHref === undefined ? {} : { dataSourcesHref })}
            />

            <div className={BODY_GRID}>
                {/* From 720 the ingredients stay beside the steps, sticky, with their own scroll (§6.1). */}
                <section aria-labelledby="ingredients" className={INGREDIENTS_COLUMN}>
                    <div className="flex flex-wrap items-center gap-2 pb-1 pe-3 ps-4 pt-3.5">
                        <h2
                            id="ingredients"
                            ref={ingredientsHeadingRef}
                            tabIndex={-1}
                            aria-describedby={saysRecovered ? recoveredDescriptionId : undefined}
                            className={SECTION_HEADING}
                        >
                            {detail.ingredientsHeading}
                        </h2>
                        <span className="me-auto text-meta text-ink-muted">
                            {fillTemplate(detail.ingredientsFor, { count: servings })}
                        </span>
                        <ServingScaleControl
                            servings={servings}
                            baseServings={recipe.servings}
                            onServingsChange={onServingsChange}
                        />
                    </div>
                    {/* The owner's Edit sits under the heading row, at the start (`RecipeDetailAndroid384`). */}
                    {ingredientsEdit !== undefined && recipe.ingredients.length > 0 && (
                        <div className="flex px-4 pb-1">
                            <Link href={ingredientsEdit} aria-label={detail.editIngredientsLabel} className={EDIT_LINK}>
                                <Icon name="pencilLine" size={16} />
                                {detail.editSection}
                            </Link>
                        </div>
                    )}
                    <div className="flex flex-col gap-2 px-4 empty:hidden">
                        {/* The disclosure is part of the feature: a cook reading doubled amounts is told, in the same breath,
                        that the cook times beside them did NOT double. */}
                        {scaled.scaling.isScaled && (
                            <div
                                role="status"
                                className={`flex flex-col items-start gap-1 rounded-lg ${surfaceToneClass('muted')} px-3 py-2`}
                            >
                                <p className="text-meta text-ink">
                                    {fillTemplate(detail.scaledFrom, { original: recipe.servings })}{' '}
                                    <Button variant="ghost" onPress={() => onServingsChange(recipe.servings)}>
                                        {detail.resetScale}
                                    </Button>
                                </p>
                                <p className="text-caption text-ink">{detail.scaledTimingCaveat}</p>
                            </div>
                        )}
                        {/* Plan 002 R2 — ALWAYS MOUNTED, hidden through `failed`: a live region inserted with its content
                        already inside is unreliable. No automatic polling during a food outage. */}
                        <RefreshNotice
                            failed={unreachable !== undefined}
                            refreshing={unreachableRetry.refreshing}
                            onRetry={unreachableRetry.onRetry}
                            labels={{ failed: unreachable ?? '', retry: detail.refreshRetry }}
                        />
                        {saysRecovered && (
                            <p id={recoveredDescriptionId} hidden>
                                {detail.unreachableResolved}
                            </p>
                        )}
                        {/* The withdrawn-food tile (owner ruling 4): head of THIS section, warning tint, `role="note"`, no
                        dismiss — the condition is permanent. */}
                        {removedNotice !== undefined && (
                            <p role="note" className="rounded-md bg-attention-tint px-4 py-3 text-meta text-ink">
                                {removedNotice}
                            </p>
                        )}
                    </div>
                    {recipe.ingredients.length === 0 ? (
                        <DetailEmptySection
                            text={detail.noIngredients}
                            action={ingredientsEdit}
                            actionLabel={detail.addIngredients}
                        />
                    ) : (
                        // A group is a label over its run of lines (§6.1, F9); an ungrouped recipe draws one list.
                        ingredientGroupRuns(scaled.ingredients).map((run, index) => (
                            <div key={`${run.label ?? ''}-${String(index)}`} className="flex flex-col">
                                {run.label !== undefined && (
                                    <h3 className="px-4 pb-1 pt-4 text-caption text-ink-muted">{run.label}</h3>
                                )}
                                <ul className="flex flex-col">
                                    {run.lines.map((ingredient, lineIndex) => (
                                        <IngredientCheckRow
                                            key={ingredient.ingredientId}
                                            divided={lineIndex > 0}
                                            ingredient={ingredient}
                                            checked={marks.checkedLines.has(ingredient.ingredientId)}
                                            allRemoved={allRemoved}
                                            onToggle={marks.toggleLine}
                                        />
                                    ))}
                                </ul>
                            </div>
                        ))
                    )}
                </section>

                <div className={STEPS_COLUMN}>
                    <section aria-labelledby="steps" className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-2">
                            <h2 id="steps" tabIndex={-1} className={SECTION_HEADING}>
                                {detail.instructionsHeading}
                            </h2>
                            {stepsEdit !== undefined && recipe.steps.length > 0 && (
                                <Link href={stepsEdit} aria-label={detail.editStepsLabel} className={EDIT_LINK}>
                                    <Icon name="pencilLine" size={16} />
                                    {detail.editSection}
                                </Link>
                            )}
                        </div>
                        {recipe.steps.length === 0 ? (
                            <DetailEmptySection
                                text={detail.noSteps}
                                action={stepsEdit}
                                actionLabel={detail.addSteps}
                            />
                        ) : (
                            <ol className="flex flex-col gap-6">
                                {recipe.steps.map((step) => (
                                    <StepRow
                                        key={step.stepNumber}
                                        step={step}
                                        current={marks.currentStep === step.stepNumber}
                                        onToggle={marks.toggleStep}
                                    />
                                ))}
                            </ol>
                        )}
                    </section>

                    {/* U13 — the ambiguity review surface + the one-time clone banner, from the STORED lines. */}
                    <AmbiguityReview recipe={recipe} viewerIsOwner={owner} />
                </div>
            </div>
        </article>
    );
};
