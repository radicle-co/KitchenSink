/**
 * @module @commise/features-recipes/filters — the native filter groups, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §4.4): the ONE facet tree that the tablet panel and the filter sheet both draw.
 *
 * The same contract: a named group (or, for a time ladder, a `radiogroup`) per facet with its name as a header above it,
 * Total time as a choice with an "Any", prep and cook time behind one disclosure, twelve chips then "Show all ({n})" with
 * a chosen chip never behind it, and the ingredient typeahead with its results and its chosen ingredients as removable
 * chips. Colour is read from the theme at render, so the groups follow the system scheme (D15).
 *
 * The result or chip the cook pressed unmounts on every ingredient add and removal, so once the press lands
 * (`useIngredientPressLanding`) the screen-reader cursor moves to the note when the add filled the filter, else to the
 * group's name just above the search field. It moves the reading cursor only, so no keyboard rises, and a change nobody
 * pressed moves nothing.
 *
 * Presentational: it draws the facet groups from the view and reports every change.
 *
 * @pattern Visitor — an exhaustive switch over the group view's kinds
 */
import { useMessages } from '@commise/i18n/react';
import { Chip, ChipRow } from '@commise/ui/chip';
import { nativeTokens } from '@commise/ui/native';
import { useScreenReaderFocusOnSignal } from '@commise/ui/screen-reader-focus';
import { SearchField } from '@commise/ui/search-field';
import { useTheme } from '@commise/ui/theme';
import { useId, useState, type FC, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useIngredientPressLanding } from '../hooks/useIngredientPressLanding.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { recipeMessages } from '../messages.js';
import { FACET_CHIP_LIMIT, visibleChipsOf, type FacetGroupView } from './filterBarView.js';
import type { FilterGroupsProps } from './filtersModel.js';
import { filterMessages } from './messages.js';
import type { FilterAction } from './model.js';

/** A group's visible name, a header for the screen reader as well. */
const GroupName: FC<{ readonly children: string; readonly nameRef?: React.Ref<Text> }> = ({ children, nameRef }) => {
    const { colors } = useTheme();

    return (
        <Text ref={nameRef} accessibilityRole="header" style={[styles.overline, { color: colors.inkMuted }]}>
            {children}
        </Text>
    );
};

/** A group's frame: its name, then its body. */
const GroupFrame: FC<{ readonly name: string; readonly children: ReactNode }> = ({ name, children }) => (
    <View style={styles.group}>
        <GroupName>{name}</GroupName>
        {children}
    </View>
);

export const FilterGroups: FC<FilterGroupsProps> = ({ view, chipOverflow, ingredientSearch, onFilterAction }) => {
    const m = useMessages(filterMessages);
    const { ingredientSearch: minimumCopy } = useMessages(recipeMessages);
    const { colors } = useTheme();
    const searchId = useId();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

    const ingredientGroup = view.slots.flatMap((slot) =>
        slot.kind === 'group' && slot.group?.kind === 'ingredients' ? [slot.group] : [],
    )[0];
    // One signal, two targets: only one of the note and the group's name is the cursor's, once the press lands.
    const landing = useIngredientPressLanding(ingredientGroup?.selected.length ?? 0);
    const fullNoteRef = useScreenReaderFocusOnSignal<Text>(landing.signal);
    const nameRef = useScreenReaderFocusOnSignal<Text>(landing.signal);

    const pressIngredient = (action: FilterAction): void => {
        landing.markPressed();
        onFilterAction(action);
    };

    const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
        const next = new Set(set);

        if (!next.delete(id)) {
            next.add(id);
        }

        return next;
    };

    const drawGroup = (id: string, group: FacetGroupView): ReactElement => {
        switch (group.kind) {
            case 'chips': {
                const { shown, hiddenCount } = visibleChipsOf(group.chips, expanded.has(id));
                const canFold = expanded.has(id) && group.chips.length > FACET_CHIP_LIMIT;

                return (
                    <GroupFrame name={group.label}>
                        <ChipRow mode="filter" label={group.label} overflow={chipOverflow}>
                            {shown.map(({ chip, action }) => (
                                <Chip
                                    key={chip.value}
                                    kind="filter"
                                    label={chip.value}
                                    selected={chip.selected}
                                    {...(chip.count === undefined ? {} : { count: chip.count })}
                                    onPress={() => onFilterAction(action)}
                                />
                            ))}
                        </ChipRow>
                        {hiddenCount > 0 || canFold ? (
                            <Pressable
                                role="button"
                                onPress={() => setExpanded((current) => toggle(current, id))}
                                style={styles.textButton}
                            >
                                <Text style={[styles.label, { color: colors.actionText }]}>
                                    {expanded.has(id)
                                        ? m.showFewer
                                        : fillTemplate(m.showAll, { n: group.chips.length })}
                                </Text>
                            </Pressable>
                        ) : null}
                    </GroupFrame>
                );
            }

            case 'timeChoices':
                return (
                    <GroupFrame name={group.label}>
                        <ChipRow
                            mode="choice"
                            label={group.label}
                            overflow={chipOverflow}
                            options={group.options.map(({ value, label }) => ({ value, label }))}
                            value={group.value}
                            onChange={(next) => {
                                const picked = group.options.find((option) => option.value === next);

                                if (picked !== undefined) {
                                    onFilterAction(picked.action);
                                }
                            }}
                        />
                    </GroupFrame>
                );

            case 'ingredients':
                return (
                    <View collapsable={false} role="group" aria-label={group.label} style={styles.group}>
                        <GroupName nameRef={nameRef}>{group.label}</GroupName>
                        {group.search.kind === 'full' ? (
                            <Text ref={fullNoteRef} style={[styles.body, { color: colors.inkMuted }]}>
                                {fillTemplate(m.ingredientFilterFull, { max: group.search.max })}
                            </Text>
                        ) : (
                            <>
                                <SearchField
                                    id={searchId}
                                    label={m.ingredientSearchLabel}
                                    labelVisibility="hidden"
                                    clearLabel={m.ingredientSearchClear}
                                    placeholder={m.ingredientSearchPlaceholder}
                                    value={ingredientSearch.query}
                                    onChangeText={ingredientSearch.onQueryChange}
                                />
                                {group.search.kind === 'tooShort' && (
                                    <Text style={[styles.meta, { color: colors.inkMuted }]}>
                                        {fillTemplate(minimumCopy.tooShort, { minimum: group.search.minimum })}
                                    </Text>
                                )}
                                {group.search.kind === 'searching' && (
                                    <Text
                                        role="status"
                                        aria-label={m.ingredientSearching}
                                        style={[styles.meta, { color: colors.inkMuted }]}
                                    >
                                        {m.ingredientSearching}
                                    </Text>
                                )}
                                {group.search.kind === 'results' && group.search.isError && (
                                    <Text role="alert" style={[styles.meta, { color: colors.dangerText }]}>
                                        {m.ingredientSearchError}
                                    </Text>
                                )}
                                {group.search.kind === 'results' &&
                                    !group.search.isError &&
                                    group.results.length === 0 && (
                                        <Text style={[styles.meta, { color: colors.inkMuted }]}>
                                            {m.ingredientNoMatches}
                                        </Text>
                                    )}
                                {group.results.length > 0 && (
                                    <View collapsable={false} role="list">
                                        {group.results.map(({ ingredient, action }) => (
                                            <Pressable
                                                key={ingredient.foodId}
                                                role="button"
                                                // Named by its ACTION, not the bare name: the field above already holds it.
                                                aria-label={fillTemplate(m.addIngredientFilter, {
                                                    name: ingredient.name,
                                                })}
                                                onPress={() => pressIngredient(action)}
                                                style={styles.option}
                                            >
                                                <Text style={[styles.body, { color: colors.ink }]}>
                                                    {ingredient.name}
                                                </Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                )}
                            </>
                        )}
                        {group.selected.length > 0 && (
                            <ChipRow mode="input" label={group.label} overflow="wrap">
                                {group.selected.map(({ entry, action }) => (
                                    <Chip
                                        key={entry.foodId}
                                        kind="input"
                                        label={entry.name}
                                        removeLabel={fillTemplate(m.removeIngredientFilter, { name: entry.name })}
                                        onRemove={() => pressIngredient(action)}
                                    />
                                ))}
                            </ChipRow>
                        )}
                    </View>
                );
        }
    };

    return (
        <View style={styles.groups}>
            {view.slots.map((slot) => {
                if (slot.kind === 'disclosure') {
                    const open = slot.open || opened.has(slot.id);

                    return (
                        <View key={slot.id} style={styles.group}>
                            <Pressable
                                role="button"
                                aria-expanded={open}
                                onPress={() => setOpened((current) => toggle(current, slot.id))}
                                style={styles.disclosure}
                            >
                                <Text style={[styles.label, { color: colors.ink }]}>{slot.label}</Text>
                            </Pressable>
                            {open ? (
                                <View style={styles.groups}>
                                    {slot.groups.map((entry) => (
                                        <View key={entry.id}>{drawGroup(entry.id, entry.group)}</View>
                                    ))}
                                </View>
                            ) : null}
                        </View>
                    );
                }

                return slot.group === undefined ? null : <View key={slot.id}>{drawGroup(slot.id, slot.group)}</View>;
            })}
        </View>
    );
};

const styles = StyleSheet.create({
    groups: { gap: nativeTokens.spacing[5] },
    group: { gap: nativeTokens.spacing[2] },
    overline: { ...nativeTokens.type.overline },
    label: { ...nativeTokens.type.label },
    body: { ...nativeTokens.type.body },
    meta: { ...nativeTokens.type.meta },
    textButton: {
        alignSelf: 'flex-start',
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: nativeTokens.spacing[1],
    },
    option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: nativeTokens.spacing[3] },
    disclosure: { minHeight: 44, justifyContent: 'center' },
});
