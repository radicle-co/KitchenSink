'use client';

/**
 * @module @commise/features-recipes — web recipe-detail view (T066 building block; `docs/design/uiOverhaul/buildSpec.md`
 * §6, the first slice of 008 FR-035).
 *
 * The PURE render half of the recipe page, in reading order: the hero, the back link, the meta line, the title, the
 * rating line, the stat strip, the action row, the description and the tags as text; then the body — the section
 * switch below a 720 px body, and from 720 two columns, ingredients (5/12, sticky with its own scroll) beside the steps
 * (7/12), with the nutrition, the rating, the review surface and the footer facts under the steps.
 *
 * Every width rule is a CONTAINER query on the article (`@container/detail`), never a script measurement, so the
 * server render and the hydrated page are the same page. "Screen on" is therefore drawn in two places (the section
 * switch below 720, the action row from 720) from ONE state its shell holds, and the toggle itself renders nothing
 * where the browser cannot keep the screen awake.
 *
 * Its orchestration shell — `RecipeDetailView.tsx`, which binds the serving scale, the cook's marks, Screen on and
 * the description's disclosure — is a separate file because a file does ONE thing (CODING_STANDARDS §1).
 *
 * @pattern Humble Object — the pure render half of the orchestration/render split whose shell is
 *     `RecipeDetailView.tsx`. It holds no fetch state and decides nothing.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button, buttonSurfaceClass } from '@commise/ui/button';
import { DifficultyBadge } from '@commise/ui/difficulty-badge';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import { Icon } from '@commise/ui/icon';
import { KeepAwakeToggle } from '@commise/ui/keep-awake';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { SectionSwitch } from '@commise/ui/section-switch';
import { StatusBadge } from '@commise/ui/status-badge';
import { hasCatalogNutrition, hasUserEnteredIngredients } from '@kitchensink/recipe-core';
import { scaleRecipeForServings } from '@kitchensink/recipe-core/scaling';
import Link from 'next/link';
import { useId, type ComponentProps, type FC } from 'react';

import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import { AmbiguityReview } from './AmbiguityReview.js';
import { DetailEmptySection } from './DetailEmptySection.js';
import { detailMetaItems, detailRatingLine, detailStatCells, isLongDescription } from './detailFacts.js';
import { IngredientCheckRow } from './IngredientCheckRow.js';
import { NutritionFigure } from './NutritionFigure.js';
import {
    allLinesFoodRemoved,
    detailNoticeState,
    needsReviewNotice,
    rangeDerivedNotice,
    removedFoodNotice,
    staleNutritionNotice,
    type RecipeDetailBodyProps,
} from './model.js';
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

/** Screen on in the action row: from a 720 px body only (below it, it is in the section switch). */
const ACTION_ROW_SCREEN_ON = 'hidden @min-[45rem]/detail:ms-auto @min-[45rem]/detail:inline-flex';

/** The section switch: below a 720 px body only, where the two sections do not show side by side. */
const SECTION_SWITCH_SLOT = '@min-[45rem]/detail:hidden';

/** The body: one column, two from a 720 px body. */
const BODY_GRID =
    'flex flex-col gap-10 @min-[45rem]/detail:grid @min-[45rem]/detail:grid-cols-12 @min-[45rem]/detail:gap-8';

/** The ingredients: 5/12 from a 720 px body, sticky under the chrome with a scroll of their own. */
const INGREDIENTS_COLUMN =
    'flex flex-col gap-3 @min-[45rem]/detail:sticky @min-[45rem]/detail:top-20 @min-[45rem]/detail:col-span-5 ' +
    '@min-[45rem]/detail:max-h-[calc(100dvh-6rem)] @min-[45rem]/detail:self-start @min-[45rem]/detail:overflow-y-auto';

/** The steps, nutrition, rating and footer facts: 7/12 from a 720 px body. */
const STEPS_COLUMN = 'flex min-w-0 flex-col gap-10 @min-[45rem]/detail:col-span-7';

/** A section heading: `sectionTitle`, focusable for a jump, and clear of the sticky switch when jumped to. */
const SECTION_HEADING = 'scroll-mt-28 text-section-title text-ink focus:outline-none';

/** The owner's ghost Edit link on a section heading, and the footer's Version history: the ghost button surface. */
const EDIT_LINK = buttonSurfaceClass('ghost', 'sm');

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
    rating,
    servings,
    onServingsChange,
    refreshNotice,
    unreachableRetry,
    dataSourcesHref,
    editHref,
    versionsHref,
    viewerIsOwner,
    marks,
    screenOn,
    descriptionExpanded,
    onToggleDescription,
    currentSection,
}) => {
    const { detail, duration, card } = useMessages(recipeMessages);
    const locale = useLocale();
    const owner = viewerIsOwner === true;
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
    // Facts about the READ, from the stored figure — not the serving count on screen.
    const rangeNotice = rangeDerivedNotice(recipe.nutrition, {
        low: detail.nutritionRangeDerivedLow,
        high: detail.nutritionRangeDerivedHigh,
    });
    const staleNotice = staleNutritionNotice(recipe.nutrition, detail.nutritionStale);
    const reviewNotice = needsReviewNotice(recipe.ingredients, detail);
    const removedNotice = removedFoodNotice(recipe.ingredients, detail);
    const allRemoved = allLinesFoodRemoved(recipe.ingredients);
    // ONE derivation of what the chosen serving count means; cook time and step timers stay as stored.
    const scaled = scaleRecipeForServings(recipe, servings);
    const stats = detailStatCells(scaled, recipe.difficulty, { detail, duration, card });
    const meta = detailMetaItems(recipe, owner, detail);
    const ratingLine = detailRatingLine(recipe, owner, locale, { detail, card });
    const tags = [...recipe.dietaryFlags, ...recipe.tags];
    const editSectionHref = (section: string): Href | undefined =>
        owner && editHref !== undefined ? (`${editHref}#${section}` as Href) : undefined;
    const ingredientsEdit = editSectionHref('ingredients');
    const stepsEdit = editSectionHref('steps');

    return (
        <article
            aria-label={recipe.title}
            className="@container/detail mx-auto flex w-full max-w-detail flex-col gap-6 px-4 pb-10"
        >
            <div className="flex flex-col gap-4 @min-[60rem]/detail:grid @min-[60rem]/detail:grid-cols-12 @min-[60rem]/detail:gap-x-8">
                {/* The hero IS the carousel, so the cover shows once (F2). From a 960 body it sits at the END, 7/12. */}
                <div className="@min-[60rem]/detail:col-span-7 @min-[60rem]/detail:col-start-6 @min-[60rem]/detail:row-start-1">
                    <RecipeHero title={recipe.title} photos={recipe.photos} />
                </div>
                <header className="flex min-w-0 flex-col gap-3 @min-[60rem]/detail:col-span-5 @min-[60rem]/detail:col-start-1 @min-[60rem]/detail:row-start-1">
                    {back}
                    {meta.length > 0 && (
                        <p className="flex flex-wrap gap-x-2 text-overline text-ink-muted">
                            {meta.map((item, index) => (
                                <span key={item}>
                                    {index > 0 && <span aria-hidden="true">· </span>}
                                    {item}
                                </span>
                            ))}
                        </p>
                    )}
                    {/* `min-w-0 break-words`: a recipe title is user-authored and unbounded. */}
                    <h1
                        ref={titleRef}
                        tabIndex={-1}
                        className="line-clamp-3 min-w-0 break-words text-large-title text-ink focus:outline-none"
                        title={recipe.title}
                    >
                        {recipe.title}
                    </h1>
                    {(ratingLine.rating !== undefined || ratingLine.status !== undefined) && (
                        <p className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-meta text-ink">
                            {ratingLine.rating !== undefined && (
                                <span className="inline-flex items-center gap-1">
                                    <Icon name="star" size={16} tone="rating" filled />
                                    <span className="tabular-nums lining-nums">{ratingLine.rating.text}</span>
                                </span>
                            )}
                            {ratingLine.rating !== undefined && ratingLine.status !== undefined && (
                                <span aria-hidden="true" className="text-ink-muted">
                                    ·
                                </span>
                            )}
                            {ratingLine.status?.kind === 'draft' && (
                                <StatusBadge status="draft">{ratingLine.status.text}</StatusBadge>
                            )}
                            {ratingLine.status?.kind === 'visibility' && (
                                <span className="inline-flex items-center gap-1 text-ink-muted">
                                    <Icon
                                        name={ratingLine.status.visibility === 'public' ? 'globe' : 'lock'}
                                        size={16}
                                    />
                                    {ratingLine.status.text}
                                </span>
                            )}
                        </p>
                    )}
                    {stats.length > 0 && (
                        <div className="@container/stats">
                            {/* A container query styles a container's DESCENDANTS, never the container itself, so the strip's width is
                            read from this wrapper: 2 × 2 below a 360 px strip, one row of cells from it. */}
                            <dl className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-lg bg-paper px-1 py-1 shadow-sm @min-[22.5rem]/stats:auto-cols-fr @min-[22.5rem]/stats:grid-flow-col @min-[22.5rem]/stats:grid-cols-none">
                                {stats.map((cell) => (
                                    <div key={cell.id} className="flex flex-col-reverse gap-1 px-3 py-2">
                                        <dt className="text-caption text-ink-muted">{cell.label}</dt>
                                        <dd className="text-figure-stat text-ink">
                                            {cell.id === 'difficulty' ? (
                                                <DifficultyBadge level={cell.level}>{cell.value}</DifficultyBadge>
                                            ) : (
                                                cell.value
                                            )}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        </div>
                    )}
                    {headerActions !== undefined && (
                        <div className="flex items-center gap-2 [&>*:first-child]:flex-1 @min-[37.5rem]/detail:[&>*:first-child]:flex-none">
                            {headerActions}
                            <span className={ACTION_ROW_SCREEN_ON}>
                                <KeepAwakeToggle
                                    on={screenOn.on}
                                    onChange={screenOn.onChange}
                                    label={detail.screenOn}
                                    display="labelled"
                                />
                            </span>
                        </div>
                    )}
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

            {/* Below a 720 body: one column under the sticky section switch, which holds Screen on as its glyph. */}
            <div className={SECTION_SWITCH_SLOT}>
                <SectionSwitch
                    label={detail.sectionsLabel}
                    {...(currentSection === undefined ? {} : { currentId: currentSection })}
                    sections={[
                        { id: 'ingredients', label: detail.ingredientsHeading },
                        { id: 'steps', label: detail.instructionsHeading },
                        { id: 'nutrition', label: detail.nutritionLink },
                    ]}
                    trailing={
                        <KeepAwakeToggle
                            on={screenOn.on}
                            onChange={screenOn.onChange}
                            label={detail.screenOn}
                            display="icon"
                        />
                    }
                />
            </div>

            <div className={BODY_GRID}>
                {/* From 720 the ingredients stay beside the steps, sticky, with their own scroll (§6.1). */}
                <section aria-labelledby="ingredients" className={INGREDIENTS_COLUMN}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
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
                        <div className="flex items-center gap-1">
                            <ServingScaleControl
                                servings={servings}
                                baseServings={recipe.servings}
                                onServingsChange={onServingsChange}
                            />
                            {ingredientsEdit !== undefined && recipe.ingredients.length > 0 && (
                                <Link
                                    href={ingredientsEdit}
                                    aria-label={detail.editIngredientsLabel}
                                    className={EDIT_LINK}
                                >
                                    <Icon name="pencilLine" size={16} />
                                    {detail.editSection}
                                </Link>
                            )}
                        </div>
                    </div>
                    {/* The disclosure is part of the feature: a cook reading doubled amounts is told, in the same breath,
                        that the cook times beside them did NOT double. */}
                    {scaled.scaling.isScaled && (
                        <div
                            role="status"
                            className="flex flex-col items-start gap-1 rounded-md bg-surface-muted px-3 py-2"
                        >
                            <p className="text-meta text-ink">
                                {fillTemplate(detail.scaledFrom, { original: recipe.servings })}{' '}
                                <Button variant="ghost" onPress={() => onServingsChange(recipe.servings)}>
                                    {detail.resetScale}
                                </Button>
                            </p>
                            <p className="text-meta font-medium text-ink">{detail.scaledTimingCaveat}</p>
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
                    {recipe.ingredients.length === 0 ? (
                        <DetailEmptySection
                            text={detail.noIngredients}
                            action={ingredientsEdit}
                            actionLabel={detail.addIngredients}
                        />
                    ) : (
                        <ul className="flex flex-col">
                            {scaled.ingredients.map((ingredient) => (
                                <IngredientCheckRow
                                    key={ingredient.ingredientId}
                                    ingredient={ingredient}
                                    checked={marks.checkedLines.has(ingredient.ingredientId)}
                                    allRemoved={allRemoved}
                                    onToggle={marks.toggleLine}
                                />
                            ))}
                        </ul>
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

                    <section aria-labelledby="nutrition" className="@container/nutrition flex flex-col gap-3">
                        <h2 id="nutrition" tabIndex={-1} className={SECTION_HEADING}>
                            {detail.nutritionHeading}
                        </h2>
                        <dl className="grid grid-cols-2 gap-4 @min-[35rem]/nutrition:grid-cols-4">
                            <NutritionFigure label={detail.caloriesLabel} value={String(recipe.nutrition.calories)} />
                            <NutritionFigure
                                label={detail.proteinLabel}
                                value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.proteinG })}
                            />
                            <NutritionFigure
                                label={detail.carbsLabel}
                                value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.carbsG })}
                            />
                            <NutritionFigure
                                label={detail.fatLabel}
                                value={fillTemplate(detail.gramsUnit, { grams: recipe.nutrition.fatG })}
                            />
                        </dl>
                        <div className="flex flex-col gap-1 text-caption text-ink-muted">
                            {!recipe.nutrition.isComplete && <p>{detail.nutritionPartial}</p>}
                            {/* R38 and KTD-3b: two more admissions about the figures; both can be true at once. */}
                            {rangeNotice !== undefined && <p>{rangeNotice}</p>}
                            {staleNotice !== undefined && <p>{staleNotice}</p>}
                            {/* U14 — our own doubt, and actionable: re-pick the food. */}
                            {reviewNotice !== undefined && (
                                <p role="note" className="font-medium text-ink">
                                    {reviewNotice}
                                </p>
                            )}
                            {hasCatalogNutrition(recipe.ingredients) && (
                                <p>
                                    {detail.nutritionSourceNote}
                                    {dataSourcesHref !== undefined && (
                                        <>
                                            {' '}
                                            <Link
                                                href={dataSourcesHref as Href}
                                                className="inline-block py-1 text-action-text underline underline-offset-2"
                                            >
                                                {detail.nutritionSourcesLink}
                                            </Link>
                                        </>
                                    )}
                                </p>
                            )}
                            {hasUserEnteredIngredients(recipe.ingredients) && <p>{detail.nutritionCustomNote}</p>}
                        </div>
                    </section>

                    {rating}

                    {/* U13 — the ambiguity review surface + the one-time clone banner, from the STORED lines. */}
                    <AmbiguityReview recipe={recipe} viewerIsOwner={owner} />

                    <footer className="flex flex-col items-start gap-1 text-meta text-ink-muted">
                        {/* Provenance renders for EVERY viewer: it is a property of the recipe. */}
                        <RecipeSourceLine
                            {...(recipe.sourceUrl === undefined ? {} : { sourceUrl: recipe.sourceUrl })}
                            {...(recipe.sourceAttribution === undefined
                                ? {}
                                : { sourceAttribution: recipe.sourceAttribution })}
                        />
                        <p>{fillTemplate(detail.versionLabel, { version: recipe.currentVersion })}</p>
                        {versionsHref !== undefined && (
                            <Link href={versionsHref as Href} className={EDIT_LINK}>
                                <Icon name="clock" size={16} />
                                {detail.versionHistory}
                            </Link>
                        )}
                    </footer>
                </div>
            </div>
        </article>
    );
};
