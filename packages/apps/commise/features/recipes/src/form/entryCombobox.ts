/**
 * @module @commise/features-recipes/form — what an ingredient entry field's combobox lists, shows and announces, from the
 * ONE progressive answer (`useIngredientEntry`'s view). The authority is `docs/design/rowEditorOpenDecisions.md`,
 * "S7 list contract" P1 to P7, with items 1, 2, 5 and 10 and rulings R1 to R3; L1 to L4 govern the database part.
 *
 * Top to bottom (P1): the database line before the listbox when our database found no food; `Your foods`, `Food
 * catalog`; `Not listed?` with Find nutrition and Use as written; one `From {source}` group per remote source, in
 * arrival order; on the trailing row, Create my own food once the answer ends. After the listbox, the trailing lines:
 * the database line when our database found a food (`docs/design/v3Evaluation.md` V3-M2a), each source's note in
 * arrival order, then the loader while the answer runs (P3). No line is live: the polite and assertive strings are the
 * only things said, and the polite one changes only at the moments P7 names.
 *
 * ⛔ Nothing already shown moves (P2): before the database part only the loader shows, and every later part adds after
 * the last. An option's key comes from its group and its id or reference, never its index.
 *
 * Pure and platform-agnostic: both leaves render it, so the two cannot list or announce different things.
 *
 * @pattern Presentation Model — the entry's state mapped to the combobox's props, with a key decoder for the choice
 * @pattern Visitor — exhaustive switches over the search view and the remote parts
 */
import type { ComboboxGroup, ComboboxOption, ComboboxStatus } from '@commise/ui/combobox';

import { variantPartTexts } from '../detail/lineName.js';
import type {
    AuthoredFoodOption,
    CatalogFoodOption,
    DatabasePart,
    EntrySearchView,
    FoodGroup,
    FoodOption,
    RemoteFoodOption,
    RemotePart,
} from '../hooks/foodSuggestions.model.js';
import { fillTemplate } from '../list/model.js';
import type {
    IngredientDetailsMessages,
    IngredientPickerSearchMessages,
    IngredientRemoteSearchMessages,
    IngredientSearchMessages,
} from '../messages.js';
import type { RecipeFormMessages } from './messages.js';
import { sourceDisplayName, sourceNotesOf, unsearchedSentenceOf, type SourceNaming } from './progressiveNotes.js';

/** The copy the model reads, already localised. */
export interface EntryComboboxCopy {
    readonly form: Pick<
        RecipeFormMessages,
        | 'ingredientSuggestionCountOne'
        | 'ingredientSuggestionCountOther'
        | 'ingredientNoSuggestions'
        | 'ingredientDatabaseUnavailable'
        | 'ingredientSuggestionsMoreHeading'
        | 'ingredientSuggestionsCreateHeading'
        | 'ingredientEntryFindByName'
        | 'ingredientEntryUseAsWritten'
        | 'ingredientSuggestionsAuthoredHeading'
        | 'ingredientSuggestionsCatalogHeading'
        | 'ingredientCatalogUnavailable'
        | 'ingredientAuthoredUnavailable'
        | 'createCustomFoodIconLabel'
        | 'createOwnFoodOptionName'
    >;
    readonly search: IngredientSearchMessages;
    readonly pickerSearch: IngredientPickerSearchMessages;
    readonly remote: IngredientRemoteSearchMessages;
    readonly details: Pick<IngredientDetailsMessages, 'suggestionWithDetails' | 'ownFoodName'>;
    /** The app-wide parked-read sentence (`offlineNoticeMessages.readOffline`), reused rather than copied. */
    readonly readOffline: string;
}

/** What the model is derived from. */
export interface EntryComboboxInput extends SourceNaming {
    /** Whether this field is the one the entry serves. Every other field lists and says nothing. */
    readonly active: boolean;
    /** The field's text, as the cook typed it. */
    readonly text: string;
    /** The active field's food list (`IngredientEntry.view`). */
    readonly view: EntrySearchView;
    /**
     * The answer still ran 1 s after its database part settled, so that part was said then (P7's slow path), and the
     * end of the answer says only what came after (`IngredientEntry.databaseSaidEarly`).
     */
    readonly databaseSaidEarly: boolean;
    /** A pick on this field that did not take, already worded by the row; said assertively (R3). */
    readonly pickFailure: string | undefined;
    /**
     * The row sentence a refused save or Next pointed at, said assertively after the alerts above (R7). Only the native
     * leaf passes one: on web the sentence is the field's description and is never live.
     */
    readonly refusal: string | undefined;
    /**
     * The trailing row's list ends with Create my own food (owner ruling 2026-10-02, answering
     * `docs/design/rowEditorOpenDecisions.md` O3). A row's list does not: a line reaches it through its `⋮`.
     */
    readonly offersCreateOwnFood: boolean;
}

/** The pick an option stands for. */
export type EntryOption =
    | { readonly kind: 'food'; readonly food: FoodOption }
    | { readonly kind: 'remoteFood'; readonly food: RemoteFoodOption }
    | { readonly kind: 'findByName' }
    | { readonly kind: 'useAsWritten' }
    /** Open the authored-food form on the typed text (the trailing row only). */
    | { readonly kind: 'createOwnFood' };

/** The combobox's props for one field, and the decoder for its choice. */
export interface EntryComboboxView {
    readonly groups: readonly ComboboxGroup[];
    readonly status: ComboboxStatus | undefined;
    readonly trailingStatus: readonly ComboboxStatus[];
    readonly countAnnouncement: string;
    readonly alertAnnouncement: string;
    /** The pick a chosen option's key stands for, or `undefined` for a key this field did not list. */
    readonly optionFor: (key: string) => EntryOption | undefined;
}

/** A field that lists and says nothing. */
const SILENT: Omit<EntryComboboxView, 'optionFor'> = {
    groups: [],
    status: undefined,
    trailingStatus: [],
    countAnnouncement: '',
    alertAnnouncement: '',
};

/** Whole sentences join with a space; an empty one adds nothing (item 5). */
const sentences = (...parts: readonly (string | undefined)[]): string =>
    parts.filter((part): part is string => part !== undefined && part !== '').join(' ');

/** Where Create my own food stands, if it shows (P1). */
type CreatePlace = 'none' | 'notListed' | 'ownHeading';

/** What a state shows and says, before the options are built. */
interface StateSpeech {
    readonly status: ComboboxStatus | undefined;
    readonly authored: readonly AuthoredFoodOption[];
    readonly catalog: readonly CatalogFoodOption[];
    /** Whether `Not listed?` shows: once the database part is in, offline, or a resumed answer (P2). */
    readonly notListed: boolean;
    readonly remote: readonly RemotePart[];
    readonly create: CreatePlace;
    readonly trailing: readonly ComboboxStatus[];
    readonly polite: string;
    readonly assertive: string;
}

/** The foods of one database group. Pure. */
const foodsOf = <O extends FoodOption>(group: FoodGroup<O>): readonly O[] =>
    group.kind === 'answered' ? group.foods : [];

/** The count of `count` foods, or `undefined` for none (item 5). Pure. */
const countOf = (count: number, copy: EntryComboboxCopy): string | undefined =>
    count === 0
        ? undefined
        : count === 1
          ? copy.form.ingredientSuggestionCountOne
          : fillTemplate(copy.form.ingredientSuggestionCountOther, { count });

/**
 * The database line (L3, P6): what could not be searched, else, with both groups answered and no food, that nothing
 * matches. ⛔ Only an answer from BOTH groups may say no food matches. It never changes after the settle (P2). Pure.
 */
const databaseLineOf = (database: DatabasePart, query: string, copy: EntryComboboxCopy): string | undefined =>
    unsearchedSentenceOf(database, copy) ??
    (foodsOf(database.authored).length + foodsOf(database.catalog).length === 0
        ? fillTemplate(copy.form.ingredientNoSuggestions, { query })
        : undefined);

/** The remote foods a source added. Pure. */
const addedBy = (part: RemotePart): readonly RemoteFoodOption[] => (part.kind === 'answered' ? part.foods : []);

/** A served answer's part of the view (P1 to P7). Pure. */
const servedSpeechOf = (
    view: Extract<EntrySearchView, { kind: 'served' }>,
    query: string,
    input: EntryComboboxInput,
    copy: EntryComboboxCopy,
): StateSpeech => {
    const { database, remote, progress } = view;
    const authored = foodsOf(database.authored);
    const catalog = foodsOf(database.catalog);
    const databaseLine = databaseLineOf(database, query, copy);
    const unavailableSentence = unsearchedSentenceOf(database, copy);
    const ended = progress !== 'running';
    const notes = sourceNotesOf(remote, input, copy);
    const remoteShown = remote.some((part) => addedBy(part).length > 0);
    const everyPartFailed =
        ended &&
        database.authored.kind === 'unavailable' &&
        database.catalog.kind === 'unavailable' &&
        remote.every((part) => part.kind !== 'answered');
    const endNotes = [...notes, ...(progress === 'incomplete' ? [copy.remote.incomplete] : [])];
    const databaseCount = authored.length + catalog.length;
    const databaseNote: ComboboxStatus | undefined =
        databaseLine === undefined ? undefined : { kind: 'note', text: databaseLine };
    // The slot follows `ComboboxProps.status` (V3-M2a): the line leads only a list with no database food to show first.
    // The database part is settled for this text, so the line never changes place (P2).
    const databaseLineLeads = databaseCount === 0;
    const trailing: ComboboxStatus[] = [
        ...(databaseNote === undefined || databaseLineLeads ? [] : [databaseNote]),
        ...endNotes.map((text): ComboboxStatus => ({ kind: 'note', text })),
    ];

    if (progress === 'running') {
        trailing.push({ kind: 'loading', label: copy.remote.stillSearching });
    }

    const remoteCount = remote.reduce((count, part) => count + addedBy(part).length, 0);
    const noMatch =
        database.authored.kind === 'answered' && database.catalog.kind === 'answered'
            ? fillTemplate(copy.form.ingredientNoSuggestions, { query })
            : undefined;

    const polite = ((): string => {
        if (everyPartFailed) {
            return '';
        }

        if (!ended) {
            // Between the settle and the guard it stays `searching`, which is silent because it does not change (P7).
            return input.databaseSaidEarly
                ? sentences(countOf(databaseCount, copy) ?? noMatch, unavailableSentence, copy.remote.stillSearching)
                : copy.pickerSearch.searching;
        }

        if (input.databaseSaidEarly) {
            const more = remote.flatMap((part) => {
                const added = addedBy(part).length;

                if (added === 0) {
                    return [];
                }

                const source = sourceDisplayName(part.source, input, copy);

                return [
                    added === 1
                        ? fillTemplate(copy.remote.moreOne, { source })
                        : fillTemplate(copy.remote.moreOther, { count: added, source }),
                ];
            });

            return more.length === 0 && endNotes.length === 0 ? copy.remote.noMore : sentences(...more, ...endNotes);
        }

        return sentences(countOf(databaseCount + remoteCount, copy) ?? noMatch, unavailableSentence, ...endNotes);
    })();

    return {
        status: databaseLineLeads ? databaseNote : undefined,
        authored,
        catalog,
        notListed: true,
        remote,
        create: view.resumed ? 'ownHeading' : !ended ? 'none' : remoteShown ? 'ownHeading' : 'notListed',
        trailing,
        polite,
        assertive: everyPartFailed ? copy.pickerSearch.failed : '',
    };
};

/** Nothing listed and nothing said. */
const NOTHING: StateSpeech = {
    status: undefined,
    authored: [],
    catalog: [],
    notListed: false,
    remote: [],
    create: 'none',
    trailing: [],
    polite: '',
    assertive: '',
};

/** The view's part, for each state (P6). Pure. */
const speechOf = (
    view: EntrySearchView,
    query: string,
    input: EntryComboboxInput,
    copy: EntryComboboxCopy,
): StateSpeech => {
    switch (view.kind) {
        case 'idle':
            return NOTHING;
        case 'tooShort':
            return {
                ...NOTHING,
                status: { kind: 'note', text: fillTemplate(copy.search.tooShort, { minimum: view.minimum }) },
            };
        case 'searching':
            // P2: before the database part only the loader shows, unless the answer was parked first (it keeps what the
            // parked list showed, so nothing goes from under the cook).
            return {
                ...NOTHING,
                notListed: view.resumed,
                create: view.resumed ? 'ownHeading' : 'none',
                trailing: [{ kind: 'loading', label: copy.pickerSearch.searching }],
                polite: copy.pickerSearch.searching,
            };
        case 'offline':
            // R2: the offline line in the loader's place, said politely. It resumes by itself, so no retry.
            return {
                ...NOTHING,
                notListed: true,
                create: 'ownHeading',
                trailing: [{ kind: 'note', text: copy.readOffline }],
                polite: copy.readOffline,
            };
        case 'failed':
            return {
                ...NOTHING,
                status: { kind: 'note', text: copy.pickerSearch.failed },
                notListed: true,
                create: view.resumed ? 'ownHeading' : 'notListed',
                assertive: copy.pickerSearch.failed,
            };
        case 'served':
            return servedSpeechOf(view, query, input, copy);

        default: {
            const unhandled: never = view;

            return unhandled;
        }
    }
};

/** The cook's own food, as an option: no parts, no tag, and a name that says it is theirs (L4.2). Pure. */
const authoredOptionOf = (option: AuthoredFoodOption, copy: EntryComboboxCopy): ComboboxOption => ({
    key: `authored:${option.hit.id}`,
    label: option.hit.name,
    accessibleName: fillTemplate(copy.details.ownFoodName, { name: option.hit.name }),
});

/** A catalog food, as an option: the variant its search matched draws its parts (§S2, L4.1). Pure. */
const catalogOptionOf = (option: CatalogFoodOption, copy: EntryComboboxCopy): ComboboxOption => {
    const key = `catalog:${option.hit.id}`;
    const label = option.hit.name;
    const parts = variantPartTexts(option.hit.variant?.parts);

    return parts === undefined
        ? { key, label }
        : {
              key,
              label,
              detailParts: parts,
              accessibleName: fillTemplate(copy.details.suggestionWithDetails, {
                  food: label,
                  parts: parts.join(', '),
              }),
          };
};

/**
 * A remote food, as an option: its name, and an accessible name that carries its source, because a native group heading
 * is header text only. No tag and no detail line (P5, R64). Keyed by its source and the reference food issued. Pure.
 */
const remoteOptionOf = (option: RemoteFoodOption, source: string, copy: EntryComboboxCopy): ComboboxOption => ({
    key: `remote:${option.source}:${option.hit.reference}`,
    label: option.hit.name,
    accessibleName: fillTemplate(copy.remote.hitName, { name: option.hit.name, source }),
});

/**
 * The combobox's props for one entry field. Pure.
 *
 * @param input - The field, the entry's view and what the row adds.
 * @param copy - The localised copy.
 * @returns The groups, the status lines, the two channels, and the decoder for a chosen key.
 */
export const entryComboboxOf = (input: EntryComboboxInput, copy: EntryComboboxCopy): EntryComboboxView => {
    const options = new Map<string, EntryOption>();
    const optionFor = (key: string): EntryOption | undefined => options.get(key);

    if (!input.active) {
        return { ...SILENT, optionFor };
    }

    const query = input.text.trim();
    const speech = speechOf(input.view, query, input, copy);
    const groups: ComboboxGroup[] = [];
    const createOption: ComboboxOption = {
        key: 'createOwnFood',
        label: copy.form.createCustomFoodIconLabel,
        accessibleName: copy.form.createOwnFoodOptionName,
    };
    const create = input.offersCreateOwnFood ? speech.create : 'none';

    const grouped = <O extends FoodOption>(
        key: O['group'],
        label: string,
        foods: readonly O[],
        optionOf: (food: O) => ComboboxOption,
    ): void => {
        if (foods.length > 0) {
            groups.push({
                key,
                label,
                options: foods.map((food) => {
                    const option = optionOf(food);

                    options.set(option.key, { kind: 'food', food });

                    return option;
                }),
            });
        }
    };

    grouped('authored', copy.form.ingredientSuggestionsAuthoredHeading, speech.authored, (food) =>
        authoredOptionOf(food, copy),
    );
    grouped('catalog', copy.form.ingredientSuggestionsCatalogHeading, speech.catalog, (food) =>
        catalogOptionOf(food, copy),
    );

    if (speech.notListed) {
        options.set('more:findByName', { kind: 'findByName' });
        options.set('more:useAsWritten', { kind: 'useAsWritten' });
        groups.push({
            key: 'more',
            label: copy.form.ingredientSuggestionsMoreHeading,
            options: [
                { key: 'more:findByName', label: fillTemplate(copy.form.ingredientEntryFindByName, { query }) },
                { key: 'more:useAsWritten', label: fillTemplate(copy.form.ingredientEntryUseAsWritten, { query }) },
                ...(create === 'notListed' ? [createOption] : []),
            ],
        });
    }

    for (const part of speech.remote) {
        const foods = addedBy(part);

        if (foods.length > 0) {
            const source = sourceDisplayName(part.source, input, copy);

            groups.push({
                key: `remote:${part.source}`,
                label: fillTemplate(copy.remote.groupHeading, { source }),
                // The source's order, never re-ranked or merged (P4).
                options: foods.map((food) => {
                    const option = remoteOptionOf(food, source, copy);

                    options.set(option.key, { kind: 'remoteFood', food });

                    return option;
                }),
            });
        }
    }

    if (create === 'ownHeading') {
        groups.push({ key: 'create', label: copy.form.ingredientSuggestionsCreateHeading, options: [createOption] });
    }

    if (create !== 'none') {
        options.set(createOption.key, { kind: 'createOwnFood' });
    }

    return {
        groups,
        status: speech.status,
        trailingStatus: speech.trailing,
        countAnnouncement: speech.polite,
        alertAnnouncement: sentences(input.pickFailure, speech.assertive, input.refusal),
        optionFor,
    };
};
