/**
 * Ingredient typeahead (mobile, T067 support; U6 styled). A thin renderer (CP-6/P2) over the shared,
 * platform-agnostic `useIngredientResolver` (`@commise/features-recipes/hooks`), which owns the search text,
 * the disambiguation state, and all four ways a line resolves (catalog-hit, addByName, candidate pick,
 * freeform). This leaf's job is ONLY to render `viewState` with its own RN markup and wire the hook's actions
 * to `PressScale`/`TextInput` events — see the hook's module doc for the full state machine, the
 * async-resolution vertical (data-model R5 / FR-007), and the drift-unification decisions made when it was
 * extracted from this leaf and its web sibling.
 *
 * U6 gave the previously unstyled leaf (bare `<Text>/<TextInput>/<Pressable>` rows) the form's
 * field/card/list-row treatment: a search field with a leading icon + a clear (×) control, tappable result
 * rows with `PressScale` press feedback, inline loading/error text, a subtle "USDA database" badge, and a
 * STYLED-BUT-INERT "Search USDA for '…'" seam that a separate USDA-autocomplete CR will wire (owner decision:
 * local-first, USDA on-demand). No behaviour changed: every accessible name, role, and the resolution wiring
 * are preserved from the pre-U6 leaf.
 *
 * The hook's callback contract is `onResolved: (line: RecipeFormIngredient) => void`; this leaf keeps its own
 * public `onResolve` prop (its `ResolvedIngredient` shape, narrower than `RecipeFormIngredient` — no
 * `quantity`) unchanged for its existing caller (`RecipeEditor`), adapting at this boundary.
 *
 * **Search Stage 2 — the blended, sectioned result list.** Results are now a discriminated `local | catalog`
 * union: the caller's own previously-used ingredients and food-catalog golden records (the USDA-seeded
 * catalog, previously invisible to this typeahead). They render as TWO labeled sections — "Your ingredients"
 * then "Food catalog" — never interleaved, per the command-palette pattern: the fast familiar list keeps a
 * stable position whether or not the catalog section is present, which matters more on a small screen where a
 * reflow can move a row out from under a thumb mid-tap. Catalog rows carry a provenance badge and cost one
 * admit round-trip on pick (hence disabled while `addByFoodStatus.isPending`). When the food catalog is
 * unreachable, a muted notice says so and the local section still renders in full (F2).
 */
import { fillTemplate } from '@commise/features-recipes';
import type { RecipeFormIngredient } from '@commise/features-recipes';
import { useIngredientResolver } from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import { PressScale } from '@commise/ui/press-scale';
import { Feather } from '@expo/vector-icons';
import { suggestionKey } from '@commise/features-recipes/hooks';
import type { FoodResolutionStatus, Ingredient } from '@kitchensink/recipe-core';
import type { IngredientCandidate, IngredientSuggestion } from '@kitchensink/recipe-service-client';
import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { mobileMessages } from '../i18n/messages.js';

/** A resolved ingredient handed upward: the catalog id, display name, and (when known) resolution status. */
export interface ResolvedIngredient {
    readonly id: string;
    readonly name: string;
    /** The line's async resolution status, when the catalog row carries one (drives the form's badge). */
    readonly resolutionStatus?: FoodResolutionStatus;
}

/** Props for {@link IngredientPicker}. */
export interface IngredientPickerProps {
    /** Invoked with the resolved catalog ingredient when the user selects a hit or creates a freeform one. */
    readonly onResolve: (ingredient: ResolvedIngredient) => void;
}

/** Narrow the hook's `RecipeFormIngredient` line down to this leaf's `ResolvedIngredient` prop shape. */
function toResolvedIngredient(line: RecipeFormIngredient): ResolvedIngredient | null {
    if (line.ingredientId === null) {
        return null;
    }

    return {
        id: line.ingredientId,
        name: line.name,
        ...(line.resolutionStatus === undefined ? {} : { resolutionStatus: line.resolutionStatus }),
    };
}

/** One search-result row: the clickable match. No terminal notice — matches this leaf's prior behavior. */
function ResultRow({ ingredient, onPress }: { ingredient: Ingredient; onPress: () => void }): JSX.Element {
    return (
        <PressScale accessibilityRole="button" accessibilityLabel={ingredient.name} onPress={onPress}>
            <View style={styles.row}>
                <Text style={styles.rowText}>{ingredient.name}</Text>
                <Feather name="chevron-right" size={18} color={palette.slate} />
            </View>
        </PressScale>
    );
}

/**
 * One food-CATALOG row (search Stage 2): a golden record with no `ingredients` row yet. Badged so its
 * provenance is unmistakable, and disabled while an admit is in flight — picking it costs one round-trip
 * before the line can resolve.
 */
function CatalogRow({
    name,
    badge,
    disabled,
    onPress,
}: {
    name: string;
    badge: string;
    disabled: boolean;
    onPress: () => void;
}): JSX.Element {
    return (
        <PressScale
            accessibilityRole="button"
            accessibilityLabel={name}
            disabled={disabled}
            busy={disabled}
            onPress={onPress}
        >
            <View style={[styles.row, disabled && styles.actionDisabled]}>
                <Text style={styles.rowText}>{name}</Text>
                <View style={styles.badge}>
                    <Text style={styles.badgeLabel}>{badge}</Text>
                </View>
            </View>
        </PressScale>
    );
}

/** One disambiguation-candidate row. */
function CandidateRow({
    candidate,
    disabled,
    onPress,
}: {
    candidate: IngredientCandidate;
    disabled: boolean;
    onPress: () => void;
}): JSX.Element {
    return (
        <PressScale
            accessibilityRole="button"
            accessibilityLabel={candidate.name}
            disabled={disabled}
            onPress={onPress}
        >
            <View style={styles.row}>
                <View style={styles.rowTextGroup}>
                    <Text style={styles.rowText}>{candidate.name}</Text>
                    {candidate.summary !== null && <Text style={styles.rowSubText}>{candidate.summary}</Text>}
                </View>
            </View>
        </PressScale>
    );
}

/**
 * The ingredient typeahead.
 *
 * @param props - The resolution callback.
 * @returns The search + results + disambiguation + create affordances.
 */
export function IngredientPicker({ onResolve }: IngredientPickerProps): JSX.Element {
    const { ingredientPicker: t } = useMessages(mobileMessages);
    const {
        query,
        setQuery,
        trimmed,
        viewState,
        addByNameStatus,
        addByFoodStatus,
        createStatus,
        resolveError,
        selectSuggestion,
        selectMatch,
        findNutrition,
        pickCandidate,
        addFreeform,
        cancelDisambiguation,
    } = useIngredientResolver((line) => {
        const resolved = toResolvedIngredient(line);

        if (resolved !== null) {
            onResolve(resolved);
        }
    });

    if (viewState.kind === 'disambiguating' || viewState.kind === 'resolving') {
        const title = fillTemplate(t.disambiguateTitle, { name: viewState.name });
        const resolving = viewState.kind === 'resolving';

        return (
            <View accessibilityLabel={title} style={styles.card}>
                <Text accessibilityRole="header" style={styles.heading}>
                    {title}
                </Text>
                {viewState.kind === 'disambiguating' && viewState.isLoading && (
                    <Text style={styles.muted}>{t.disambiguateLoading}</Text>
                )}
                {viewState.kind === 'disambiguating' && viewState.isError && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {t.disambiguateError}
                    </Text>
                )}
                {viewState.kind === 'disambiguating' &&
                    !viewState.isLoading &&
                    !viewState.isError &&
                    viewState.candidates.length === 0 && <Text style={styles.muted}>{t.disambiguateEmpty}</Text>}
                <View style={styles.list}>
                    {viewState.candidates.map((candidate) => (
                        <CandidateRow
                            key={candidate.candidateId}
                            candidate={candidate}
                            disabled={resolving}
                            onPress={() => pickCandidate(candidate.candidateId)}
                        />
                    ))}
                </View>
                {resolving && <Text style={styles.muted}>{t.resolving}</Text>}
                {viewState.kind === 'disambiguating' && resolveError && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {t.resolveError}
                    </Text>
                )}
                <View style={styles.actions}>
                    <PressScale
                        accessibilityRole="button"
                        accessibilityLabel={t.disambiguateBack}
                        onPress={cancelDisambiguation}
                    >
                        <View style={styles.ghostAction}>
                            <Text style={styles.ghostActionLabel}>{t.disambiguateBack}</Text>
                        </View>
                    </PressScale>
                    <PressScale
                        accessibilityRole="button"
                        accessibilityLabel={fillTemplate(t.create, { query: viewState.name })}
                        disabled={createStatus.isPending}
                        busy={createStatus.isPending}
                        onPress={addFreeform}
                    >
                        <View style={[styles.fallbackAction, createStatus.isPending && styles.actionDisabled]}>
                            <Text style={styles.fallbackActionLabel}>
                                {fillTemplate(t.create, { query: viewState.name })}
                            </Text>
                        </View>
                    </PressScale>
                </View>
            </View>
        );
    }

    // idle | searching | results | terminal. The single-match "terminal" kind renders exactly like a one-item
    // local list (no distinct notice — mobile has never surfaced one; see the CP-6/P2 report). Search Stage 2
    // splits the `results` payload into TWO sections: the caller's own ingredients, then the food catalog,
    // never interleaved (see the module doc).
    let ownRows: readonly Ingredient[] = [];
    let catalogRows: readonly Extract<IngredientSuggestion, { provenance: 'catalog' }>[] = [];

    if (viewState.kind === 'terminal') {
        ownRows = [viewState.ingredient];
    } else if (viewState.kind === 'results') {
        ownRows = viewState.suggestions.flatMap((suggestion) =>
            suggestion.provenance === 'local' ? [suggestion.ingredient] : [],
        );
        catalogRows = viewState.suggestions.flatMap((suggestion) =>
            suggestion.provenance === 'catalog' ? [suggestion] : [],
        );
    }

    // REQ-057's 2-character search trigger, read off the SHARED resolver model rather than re-derived: the
    // `idle` kind IS "nothing typed, or below the threshold". Gating on `trimmed.length > 0` instead offered
    // all three query-keyed affordances at ONE character — a divergence from the web leaf (which renders its
    // action row only inside the non-idle kinds) that Maestro `create` caught on-device. Not cosmetic:
    // "Find nutrition for “T”" fires exactly the search REQ-057 gates, and "Create “T”" mints a real catalog
    // ingredient named "T".
    const showQueryActions = viewState.kind !== 'idle';
    const showEmpty = viewState.kind === 'results' && ownRows.length === 0 && catalogRows.length === 0;
    // F2: the food catalog degraded, so only the caller's own ingredients rendered. `disabled` (an operator
    // switch) deliberately shows nothing — it is not an incident to report to the user.
    const showCatalogUnavailable = viewState.kind === 'results' && viewState.catalogAvailability === 'unavailable';

    return (
        <View accessibilityLabel={t.heading} style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>
                {t.heading}
            </Text>
            <View style={styles.searchField}>
                <Feather name="search" size={18} color={palette.slate} />
                <TextInput
                    accessibilityLabel={t.searchLabel}
                    placeholder={t.searchPlaceholder}
                    placeholderTextColor={palette.slate}
                    value={query}
                    onChangeText={setQuery}
                    style={styles.searchInput}
                />
                {query.length > 0 && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t.searchClear}
                        onPress={() => setQuery('')}
                        hitSlop={8}
                    >
                        <Feather name="x" size={18} color={palette.slate} />
                    </Pressable>
                )}
                {/* C5: names the ingredient database the typeahead searches (wireframe recipe-edit.md:56). */}
                <View style={styles.badge}>
                    <Text style={styles.badgeLabel}>{t.usdaBadge}</Text>
                </View>
            </View>

            {ownRows.length > 0 && (
                <View accessibilityLabel={t.ownSectionTitle}>
                    <Text accessibilityRole="header" style={styles.sectionTitle}>
                        {t.ownSectionTitle}
                    </Text>
                    <View style={styles.list}>
                        {ownRows.map((ingredient) => (
                            <ResultRow
                                key={ingredient.id}
                                ingredient={ingredient}
                                onPress={() => selectMatch(ingredient)}
                            />
                        ))}
                    </View>
                </View>
            )}

            {catalogRows.length > 0 && (
                <View accessibilityLabel={t.catalogSectionTitle}>
                    <Text accessibilityRole="header" style={styles.sectionTitle}>
                        {t.catalogSectionTitle}
                    </Text>
                    <View style={styles.list}>
                        {catalogRows.map((suggestion) => (
                            <CatalogRow
                                key={suggestionKey(suggestion)}
                                name={suggestion.name}
                                badge={t.catalogBadge}
                                disabled={addByFoodStatus.isPending}
                                onPress={() => selectSuggestion(suggestion)}
                            />
                        ))}
                    </View>
                </View>
            )}

            {showEmpty && <Text style={styles.muted}>{t.empty}</Text>}
            {showCatalogUnavailable && <Text style={styles.muted}>{t.catalogUnavailable}</Text>}

            {showQueryActions && (
                <>
                    <View style={styles.actions}>
                        {/* PRIMARY: resolve real nutrition via the food service (the async-resolution entry). */}
                        <PressScale
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(t.addByName, { query: trimmed })}
                            disabled={addByNameStatus.isPending}
                            busy={addByNameStatus.isPending}
                            onPress={findNutrition}
                        >
                            <View style={[styles.primaryAction, addByNameStatus.isPending && styles.actionDisabled]}>
                                <Text style={styles.primaryActionLabel}>
                                    {fillTemplate(t.addByName, { query: trimmed })}
                                </Text>
                            </View>
                        </PressScale>
                        {/* FALLBACK: an explicit freeform (user-entered) ingredient with no food resolution. */}
                        <PressScale
                            accessibilityRole="button"
                            accessibilityLabel={fillTemplate(t.create, { query: trimmed })}
                            disabled={createStatus.isPending}
                            busy={createStatus.isPending}
                            onPress={addFreeform}
                        >
                            <View style={[styles.fallbackAction, createStatus.isPending && styles.actionDisabled]}>
                                <Text style={styles.fallbackActionLabel}>
                                    {fillTemplate(t.create, { query: trimmed })}
                                </Text>
                            </View>
                        </PressScale>
                    </View>

                    {/* U6 SEAM: the styled-but-inert "Search USDA for '…'" affordance. A separate
                        USDA-autocomplete CR wires the on-demand USDA search behind it; rendered here (visibly
                        marked "coming soon", non-interactive) so its slot + styling land now without shipping a
                        dead button. Deliberately NOT a `PressScale`/button — nothing to press yet. */}
                    <View style={styles.usdaSeam}>
                        <Feather name="database" size={14} color={palette.slate} />
                        <Text style={styles.usdaSeamLabel}>{fillTemplate(t.searchUsdaFor, { query: trimmed })}</Text>
                        <View style={styles.usdaSeamTag}>
                            <Text style={styles.usdaSeamTagLabel}>{t.searchUsdaSoon}</Text>
                        </View>
                    </View>
                </>
            )}

            {addByNameStatus.isPending && <Text style={styles.muted}>{t.addingByName}</Text>}
            {addByNameStatus.isError && (
                <Text accessibilityRole="alert" style={styles.error}>
                    {t.addByNameError}
                </Text>
            )}
            {addByFoodStatus.isPending && <Text style={styles.muted}>{t.addingFromCatalog}</Text>}
            {addByFoodStatus.isError && (
                <Text accessibilityRole="alert" style={styles.error}>
                    {t.catalogAddError}
                </Text>
            )}
            {createStatus.isPending && <Text style={styles.muted}>{t.creating}</Text>}
        </View>
    );
}

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        padding: 16,
        gap: 12,
    },
    heading: { fontSize: 18, fontWeight: '600', color: palette.charcoal },
    sectionTitle: {
        fontSize: 11,
        fontWeight: '600',
        color: palette.slate,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    searchField: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: palette.white,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    searchInput: { flex: 1, fontSize: 16, color: palette.charcoal, padding: 0 },
    badge: {
        borderRadius: 999,
        backgroundColor: tint(palette.seafoam, 0.12),
        paddingVertical: 2,
        paddingHorizontal: 8,
    },
    // Text on a tint: `ocean-dark`, not `seafoam` (see the palette JSDoc in `@commise/ui`). The pill's own
    // tint is a non-text accent and stays.
    badgeLabel: { fontSize: 11, fontWeight: '600', color: palette['ocean-dark'] },
    list: { borderRadius: 10, borderWidth: 1, borderColor: border, overflow: 'hidden' },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: border,
        backgroundColor: palette.white,
    },
    rowTextGroup: { flex: 1, gap: 2 },
    rowText: { fontSize: 16, color: palette.charcoal },
    rowSubText: { fontSize: 13, color: palette.slate },
    muted: { fontSize: 13, color: palette.slate },
    error: { fontSize: 13, color: palette['error-dark'] },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
    primaryAction: { borderRadius: 999, backgroundColor: palette.seafoam, paddingVertical: 10, paddingHorizontal: 16 },
    primaryActionLabel: { fontSize: 14, fontWeight: '600', color: palette.white },
    fallbackAction: {
        borderRadius: 999,
        backgroundColor: tint(palette.seafoam, 0.12),
        paddingVertical: 10,
        paddingHorizontal: 16,
    },
    fallbackActionLabel: { fontSize: 14, fontWeight: '500', color: palette['ocean-dark'] },
    ghostAction: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
    ghostActionLabel: { fontSize: 14, fontWeight: '500', color: palette.slate },
    actionDisabled: { opacity: 0.6 },
    usdaSeam: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: border,
        paddingVertical: 8,
        paddingHorizontal: 12,
    },
    usdaSeamLabel: { flex: 1, fontSize: 13, color: palette.slate },
    usdaSeamTag: { borderRadius: 999, backgroundColor: palette.pearl, paddingVertical: 2, paddingHorizontal: 8 },
    usdaSeamTagLabel: { fontSize: 10, fontWeight: '600', color: palette.slate, textTransform: 'uppercase' },
});
