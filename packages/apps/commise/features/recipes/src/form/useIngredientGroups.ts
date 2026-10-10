/**
 * @module @commise/features-recipes/form — the Ingredients section's groups (build spec §7.5.5), shared by the web and
 * native `RecipeIngredientsFields` leaves through `useIngredientsFields`: each group heading's `⋯` (Rename group · Add
 * ingredient to this group · Remove group), the inline name field for "+ Add a group" and Rename group, the cook's new,
 * empty groups, where the one add field sits and what it is named, and the Move to group… sheet.
 *
 * The draft keeps no group of its own: a group is its lines' `groupLabel`, and every edit here is one draft transition
 * (`ingredientGroups.ts`), dispatched to the editor so it meets the draft as it is when it runs. A group the cook has just named has no line to carry its label, so it lives here, as view
 * state, until a line is added to it. ⚠️ So an empty group does not survive a reload or a draft restore: there is
 * nothing in the draft to restore it from.
 *
 * ONE add field serves every group: it sits at the foot of the group it adds to (`IngredientEntry.placement`), and every
 * other group's foot offers a button that moves it there. One field keeps one text, one pending check and one focus
 * target; a field per group would have multiplied each.
 *
 * @pattern Headless hook — the groups' state and views, which each leaf draws
 */
import type { ActionMenuItem } from '@commise/ui/action-menu';
import { useState } from 'react';

import type { EditorMessages } from '../editor/messages.js';
import type { IngredientEntry } from '../hooks/useIngredientEntry.js';
import type { DraftAction } from './draftAction.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { groupNameFieldId } from './fieldIds.js';
import { groupLabelOf, ingredientGroupLabels } from './ingredientGroups.js';
import type { IngredientLineKey } from './lineKey.js';
import type { RecipeFormMessages } from './messages.js';
import type { ControlFocus } from './useRowFocus.js';
import type { RecipeFormValues } from './values.js';

/** The inline group-name field (§7.5.5), for a new group or a rename. */
export interface GroupNameFieldView {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly saveLabel: string;
    readonly cancelLabel: string;
    /** The field takes focus as it shows. */
    readonly focusRequested: boolean;
    readonly onFocusRequestHandled: () => void;
    readonly onChange: (text: string) => void;
    /** Save the name; a blank one does nothing. */
    readonly onSubmit: () => void;
    readonly onCancel: () => void;
}

/** A group heading (an H3 in `label`, `inkMuted`) and its `⋯`. */
export interface GroupHeadingView {
    readonly label: string;
    readonly actionsLabel: string;
    readonly closeLabel: string;
    readonly actions: readonly ActionMenuItem[];
    readonly destructiveAction: ActionMenuItem;
    readonly actionsFocus: ControlFocus;
    /** The heading is being renamed: its name field shows in its place. */
    readonly renaming: GroupNameFieldView | undefined;
}

/** What sits at a group's foot: the add field itself, a button that moves it here, or nothing. */
export type SectionAddView =
    | { readonly kind: 'none' }
    | { readonly kind: 'field' }
    | { readonly kind: 'button'; readonly label: string; readonly onPress: () => void };

/** One run of rows, decorated with its group chrome. */
export interface GroupedSection<Row> {
    readonly key: string;
    readonly label: string | undefined;
    readonly rows: readonly Row[];
    /** A named run's heading; `undefined` for an unnamed one, which draws no chrome. */
    readonly group: GroupHeadingView | undefined;
    readonly addHere: SectionAddView;
}

/** "+ Add a group" at the section's foot. */
export interface AddGroupView {
    readonly label: string;
    /** The button takes focus back (a cancelled name). */
    readonly focusRequested: boolean;
    readonly onFocusRequestHandled: () => void;
    readonly onOpen: () => void;
    /** The name field, while it shows. */
    readonly field: GroupNameFieldView | undefined;
}

/** One choice in the Move to group sheet. */
interface MoveToGroupChoice {
    readonly key: string;
    readonly label: string;
    /** The line is in this group now. */
    readonly current: boolean;
    readonly onSelect: () => void;
}

/** The Move to group sheet: the groups, then No group. */
export interface MoveToGroupView {
    readonly open: boolean;
    readonly title: string;
    readonly closeLabel: string;
    readonly choices: readonly MoveToGroupChoice[];
    readonly onClose: () => void;
}

/** What the groups need from the field group. */
export interface IngredientGroupsInput {
    readonly values: RecipeFormValues;
    /** The editor's draft transition (`rowEditor.dispatch`), which meets the draft as it is when an edit runs. */
    readonly dispatch: (action: DraftAction) => void;
    /** The entry's one answer to where the add field adds (`placementOf`), and the move that changes it. */
    readonly entry: Pick<IngredientEntry, 'placement' | 'place'>;
    readonly requestTrailing: () => void;
    /** After a move, focus stays on the row's `⋯`. */
    readonly requestActions: (key: IngredientLineKey) => void;
    readonly m: RecipeFormMessages;
    readonly add: Pick<EditorMessages['ingredients'], 'addLabel' | 'addToGroup'>;
}

/** The groups' views. */
export interface IngredientGroupsModel {
    /** The named groups, the cook's empty ones included. */
    readonly groupCount: number;
    /** Decorate the fold's runs with their group chrome and the add field's place. */
    readonly decorate: <Row>(
        runs: readonly { readonly key: string; readonly label: string | undefined; readonly rows: readonly Row[] }[],
    ) => readonly GroupedSection<Row>[];
    /** The cook's new groups that no line is in yet, after the runs. */
    readonly emptyGroups: readonly GroupedSection<never>[];
    readonly addGroup: AddGroupView;
    /** The add field's name: "Add to {group}" in a group, "Add an ingredient" otherwise. */
    readonly trailingLabel: string;
    readonly moveToGroup: MoveToGroupView;
    readonly openMoveToGroup: (key: IngredientLineKey) => void;
}

/** The name field's target: a new group, or a rename of one. */
type NameForm = { readonly kind: 'add' } | { readonly kind: 'rename'; readonly from: string };

/**
 * The Ingredients section's groups.
 *
 * @param input - The draft, its setter, the add field's placement and the copy.
 * @returns The groups' views.
 * @sideEffect Edits the draft through `dispatch`, and moves the add field through `entry.place`, when a control calls
 *   the handlers it returns.
 */
export function useIngredientGroups(input: IngredientGroupsInput): IngredientGroupsModel {
    const { values, dispatch, entry, m, add } = input;
    const [made, setMade] = useState<readonly string[]>([]);
    const [form, setForm] = useState<NameForm | undefined>(undefined);
    const [text, setText] = useState('');
    const [fieldFocus, setFieldFocus] = useState(false);
    const [addButtonFocus, setAddButtonFocus] = useState(false);
    const [headingFocus, setHeadingFocus] = useState<string | undefined>(undefined);
    const [moving, setMoving] = useState<IngredientLineKey | undefined>(undefined);
    const lineGroups = ingredientGroupLabels(values);
    const empty = made.filter((label) => !lineGroups.includes(label));
    const groups = [...lineGroups, ...empty];
    const runLabels = (runs: readonly { readonly label: string | undefined }[]) => runs.map((run) => run.label);

    // The group the add field adds to: the entry's one answer (`placementOf`), else the group being built. A pick on the
    // field commits the same answer, so the label cannot name one group while the line lands in another.
    const placed = entry.placement;
    const lastLine = values.ingredients[values.ingredients.length - 1];
    const fieldGroup =
        placed !== undefined ? placed.group : lastLine === undefined ? undefined : groupLabelOf(lastLine);

    // A group the cook made holds the field before any line is in it; the entry is told which, so it can say so.
    const moveFieldTo = (group: string | undefined, madeByCook = group !== undefined && made.includes(group)): void => {
        entry.place({ group, madeByCook });
        input.requestTrailing();
    };

    const openForm = (next: NameForm, initial: string): void => {
        setForm(next);
        setText(initial);
        setFieldFocus(true);
    };

    const closeForm = (): void => {
        setForm(undefined);
        setText('');
    };

    const submit = (): void => {
        const name = text.trim();

        if (form === undefined || name === '') {
            return;
        }

        if (form.kind === 'add') {
            if (!groups.includes(name)) {
                setMade((current) => [...current, name]);
            }

            closeForm();
            moveFieldTo(name, made.includes(name) || !groups.includes(name));

            return;
        }

        const madeByCook = made.includes(form.from);

        if (madeByCook) {
            setMade((current) => current.map((label) => (label === form.from ? name : label)));
        }

        if (!empty.includes(form.from)) {
            dispatch({ kind: 'renameIngredientGroup', from: form.from, to: name });
        }

        if (placed?.group === form.from) {
            entry.place({ group: name, madeByCook });
        }

        closeForm();
        setHeadingFocus(name);
    };

    const fieldOf = (cancel: () => void): GroupNameFieldView => ({
        id: groupNameFieldId,
        label: m.groupNameLabel,
        value: text,
        saveLabel: m.groupNameSave,
        cancelLabel: m.groupNameCancel,
        focusRequested: fieldFocus,
        onFocusRequestHandled: () => setFieldFocus(false),
        onChange: setText,
        onSubmit: submit,
        onCancel: () => {
            closeForm();
            cancel();
        },
    });

    const headingOf = (label: string): GroupHeadingView => ({
        label,
        actionsLabel: fillTemplate(m.groupActionsLabel, { group: label }),
        closeLabel: fillTemplate(m.groupActionsClose, { group: label }),
        actions: [
            { id: 'rename', label: m.groupRename, onSelect: () => openForm({ kind: 'rename', from: label }, label) },
            { id: 'addHere', label: m.groupAddIngredient, onSelect: () => moveFieldTo(label) },
        ],
        destructiveAction: {
            id: 'remove',
            label: m.groupRemove,
            onSelect: () => {
                if (made.includes(label)) {
                    setMade((current) => current.filter((each) => each !== label));
                }

                if (!empty.includes(label)) {
                    dispatch({ kind: 'removeIngredientGroup', label });
                }

                if (placed?.group === label) {
                    entry.place(undefined);
                }

                input.requestTrailing();
            },
        },
        actionsFocus: {
            requested: headingFocus === label,
            onHandled: () => setHeadingFocus(undefined),
        },
        renaming: form?.kind === 'rename' && form.from === label ? fieldOf(() => setHeadingFocus(label)) : undefined,
    });

    const anyGroup = groups.length > 0;

    const addViewOf = (label: string | undefined, hosts: boolean): SectionAddView => {
        if (hosts) {
            return { kind: 'field' };
        }

        if (label === undefined) {
            return anyGroup
                ? { kind: 'button', label: add.addLabel, onPress: () => moveFieldTo(undefined) }
                : { kind: 'none' };
        }

        return {
            kind: 'button',
            label: fillTemplate(add.addToGroup, { group: label }),
            onPress: () => moveFieldTo(label),
        };
    };

    const fieldInEmptyGroup = fieldGroup !== undefined && empty.includes(fieldGroup);
    const movingLine = values.ingredients.find((line) => line.key === moving);
    const movingGroup = movingLine === undefined ? undefined : groupLabelOf(movingLine);

    const moveTo = (group: string | undefined): void => {
        if (moving !== undefined) {
            dispatch({ kind: 'moveIngredientToGroup', key: moving, group });
            input.requestActions(moving);
        }

        setMoving(undefined);
    };

    return {
        groupCount: groups.length,
        decorate: (runs) => {
            const labels = runLabels(runs);

            return runs.map((run, index) => {
                // Only a group's LAST run takes its add control: a split group draws one.
                const lastOfGroup = labels.lastIndexOf(run.label) === index;
                const hosts = !fieldInEmptyGroup && lastOfGroup && run.label === fieldGroup;

                return {
                    ...run,
                    group: run.label === undefined ? undefined : headingOf(run.label),
                    addHere: lastOfGroup ? addViewOf(run.label, hosts) : { kind: 'none' },
                };
            });
        },
        emptyGroups: empty.map((label) => ({
            key: `group-${label}`,
            label,
            rows: [],
            group: headingOf(label),
            addHere: addViewOf(label, fieldGroup === label),
        })),
        addGroup: {
            label: m.groupAdd,
            focusRequested: addButtonFocus,
            onFocusRequestHandled: () => setAddButtonFocus(false),
            onOpen: () => openForm({ kind: 'add' }, ''),
            field: form?.kind === 'add' ? fieldOf(() => setAddButtonFocus(true)) : undefined,
        },
        trailingLabel: fieldGroup === undefined ? add.addLabel : fillTemplate(add.addToGroup, { group: fieldGroup }),
        moveToGroup: {
            open: movingLine !== undefined,
            title: m.moveToGroupTitle,
            closeLabel: m.moveToGroupClose,
            choices: [
                ...groups.map((label) => ({
                    key: `group-${label}`,
                    label,
                    current: movingGroup === label,
                    onSelect: () => moveTo(label),
                })),
                {
                    key: 'none',
                    label: m.moveToGroupNone,
                    current: movingGroup === undefined,
                    onSelect: () => moveTo(undefined),
                },
            ],
            onClose: () => setMoving(undefined),
        },
        openMoveToGroup: setMoving,
    };
}
