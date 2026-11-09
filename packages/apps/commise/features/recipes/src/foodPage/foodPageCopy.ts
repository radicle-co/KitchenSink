/**
 * @module @commise/features-recipes/foodPage — `foodPageCopyOf`: what each author state of the food page SAYS and OFFERS
 * (private foods spec section 5.8 to 5.16): its badges, status statement and detail lines, the actions in order with their
 * weight, the "Your edit" comparison, and the Withdraw body. Both leaves only draw this, so the web and native pages
 * cannot drift and the twelve states are pinned once. Pure.
 *
 * @pattern Template Method — one table of per-state copy that the platform leaves render
 */
import type { BadgeStatus } from '@commise/ui/status-badge';

import { fillTemplate } from '../format/fillTemplate.js';
import { foodEditComparison, type ComparedRow } from './foodEditComparison.js';
import type { FoodPageState } from './foodPageState.js';
import type { FoodPageMessages } from './messages.js';

/** The states that have a food to show. */
export type FoodShownState = Extract<
    FoodPageState,
    {
        kind:
            | 'private'
            | 'asked'
            | 'notApproved'
            | 'public'
            | 'editWaiting'
            | 'editNotApproved'
            | 'withdrawn'
            | 'othersPublic';
    }
>;

/** A badge of the state's row. */
export interface FoodBadge {
    readonly status: BadgeStatus;
    readonly text: string;
}

/** An action of the status panel, in the order it is drawn; the primary is the one filled control. */
export interface FoodAction {
    readonly key: 'edit' | 'ask';
    readonly variant: 'primary' | 'secondary';
}

/** One changed field of the waiting edit. */
export interface FoodComparisonRow {
    /** The field’s name, as a label. */
    readonly label: string;
    /** "{from} → {to}", the arrow hidden from a screen reader by the leaf. */
    readonly text: string;
    /** The row as a screen reader says it. */
    readonly spoken: string;
}

/** Everything a leaf draws below the title. */
export interface FoodPageCopy {
    readonly badges: readonly FoodBadge[];
    /** The panel’s statement; absent where there is no panel (state 12). */
    readonly statement: string | undefined;
    /** The panel’s detail lines: the reason as staff wrote it is the first, where there is one. */
    readonly details: readonly string[];
    readonly actions: readonly FoodAction[];
    readonly actionsDisabled: boolean;
    /** Why the actions are disabled; present exactly then. */
    readonly actionsNote: string | undefined;
    readonly comparison:
        { readonly heading: string; readonly rows: readonly FoodComparisonRow[]; readonly rest: string } | undefined;
    readonly withdraw: { readonly offered: boolean; readonly body: string };
}

const EDIT_SECONDARY: FoodAction = { key: 'edit', variant: 'secondary' };

function dateText(iso: string | undefined, locale: string): string {
    return iso === undefined ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
}

function comparisonOf(state: FoodShownState, m: FoodPageMessages): FoodPageCopy['comparison'] {
    if (state.kind !== 'editWaiting' || state.request === undefined) {
        return undefined;
    }

    const rows = foodEditComparison(state.food, state.request.snapshot).map((row) => rowOf(row, m));

    return { heading: m.yourEdit.heading, rows, rest: m.yourEdit.rest };
}

function rowOf(row: ComparedRow, m: FoodPageMessages): FoodComparisonRow {
    const unit = row.unit === null ? '' : ` ${m.unit[row.unit]}`;
    const from = `${row.from}${row.from === '' ? '' : unit}`;
    const to = `${row.to}${unit}`;
    const label = m.yourEdit.fields[row.field];

    return {
        label,
        text: fillTemplate(m.yourEdit.row, { from, to }),
        spoken: fillTemplate(m.yourEdit.rowSpoken, { field: label, from, to }),
    };
}

/**
 * The copy of one state. Pure.
 *
 * @param state - A state with a food to show.
 * @param m - The page’s messages.
 * @param locale - The active locale, for the date.
 * @returns What the leaves draw.
 */
export function foodPageCopyOf(state: FoodShownState, m: FoodPageMessages, locale: string): FoodPageCopy {
    const base = {
        actionsDisabled: state.kind !== 'othersPublic' && state.actionsDisabled,
        actionsNote: state.kind !== 'othersPublic' && state.actionsDisabled ? m.offlineActions : undefined,
        comparison: comparisonOf(state, m),
    };
    const reason = state.kind !== 'othersPublic' ? state.request?.request.declineReason : null;
    const reasonLine = reason === null || reason === undefined ? [] : [fillTemplate(m.declined.reason, { reason })];
    const date = dateText(state.kind === 'othersPublic' ? undefined : state.request?.request.createdAt, locale);
    const withdrawOffered = { offered: true };
    const noWithdraw = { offered: false, body: '' };

    switch (state.kind) {
        case 'private':
            return {
                ...base,
                badges: [{ status: 'private', text: m.status.private }],
                statement: m.private.statement,
                details: [m.private.askNote],
                actions: [EDIT_SECONDARY, { key: 'ask', variant: 'primary' }],
                withdraw: { ...withdrawOffered, body: m.withdraw.bodyPrivate },
            };
        case 'asked':
            return {
                ...base,
                badges: [
                    { status: 'private', text: m.status.private },
                    { status: 'note', text: m.status.asked },
                ],
                statement: fillTemplate(m.asked.statement, { date }),
                details: [m.asked.detail],
                actions: [EDIT_SECONDARY],
                withdraw: { ...withdrawOffered, body: m.withdraw.bodyAsked },
            };
        case 'notApproved':
            return {
                ...base,
                badges: [
                    { status: 'private', text: m.status.private },
                    { status: 'attention', text: m.status.declined },
                ],
                statement: m.declined.statement,
                details: [...reasonLine, m.declined.next],
                actions: [{ key: 'edit', variant: 'primary' }],
                withdraw: { ...withdrawOffered, body: m.withdraw.bodyPrivate },
            };
        case 'public':
            return {
                ...base,
                badges: [{ status: 'public', text: m.status.public }],
                statement: m.public.statement,
                details: [m.public.detail],
                actions: [EDIT_SECONDARY],
                withdraw: { ...withdrawOffered, body: m.withdraw.bodyPublic },
            };
        case 'editWaiting':
            return {
                ...base,
                badges: [
                    { status: 'public', text: m.status.public },
                    { status: 'note', text: m.status.editWaiting },
                ],
                statement: fillTemplate(m.editWaiting.statement, { date }),
                details: [m.editWaiting.detail],
                actions: [EDIT_SECONDARY],
                withdraw: { ...withdrawOffered, body: m.withdraw.bodyPublic },
            };
        case 'editNotApproved':
            return {
                ...base,
                badges: [
                    { status: 'public', text: m.status.public },
                    { status: 'attention', text: m.status.editDeclined },
                ],
                statement: m.editDeclined.statement,
                details: [...reasonLine, m.editDeclined.next],
                actions: [EDIT_SECONDARY],
                withdraw: { ...withdrawOffered, body: m.withdraw.bodyPublic },
            };
        case 'withdrawn':
            return {
                ...base,
                badges: [{ status: 'note', text: m.status.withdrawn }],
                statement: m.withdrawn.statement,
                details: [m.withdrawn.detail],
                actions: [],
                withdraw: noWithdraw,
            };
        case 'othersPublic':
            return {
                ...base,
                badges: [{ status: 'public', text: m.status.public }],
                statement: undefined,
                details: [],
                actions: [],
                withdraw: noWithdraw,
            };
    }
}
