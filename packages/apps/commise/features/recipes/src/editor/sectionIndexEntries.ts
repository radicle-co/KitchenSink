/**
 * @module @commise/features-recipes/editor — the editor's section statuses, as the design-system `SectionIndex` draws
 * them (build spec §7.2).
 *
 * The index primitive knows nothing about recipes; this Adapter turns each section's status into a tone, its words
 * and its count, composes the phone bar's accessible name, and adds guided progress for a first recipe (owner D1): a
 * hint per section, "Start here" on an untouched Details, and "{done} of 4 done". Order is a suggestion, never a gate.
 *
 * Pure and platform-agnostic. No React, no platform APIs.
 *
 * @pattern Adapter — the editor's status vocabulary onto the index's tone vocabulary, with the copy resolved
 */
import type { SectionIndexItem } from '@commise/ui/section-index';

import { pluralOf, type EditorMessages } from './messages.js';
import { EDITOR_SECTIONS, type EditorSectionId } from './sections.js';
import { doneCount, type SectionStatus, type SectionStatuses } from './sectionStatus.js';

/** What the index is given. */
export interface SectionIndexEntries {
    readonly items: readonly SectionIndexItem[];
    readonly barName: string;
    readonly barSuffix?: string;
    readonly barCount?: string;
    /** "{done} of 4 done", for the rail's foot — a first recipe only. */
    readonly doneText?: string;
}

/** What the entries are derived from. */
export interface SectionIndexEntriesInput {
    readonly statuses: SectionStatuses;
    /** Whether the cook has never published a recipe: guided progress shows. */
    readonly guided: boolean;
    /** The section the reader is in. */
    readonly current: EditorSectionId;
    readonly messages: EditorMessages;
    readonly locale: string;
}

/**
 * The index's items, bar name and counts.
 *
 * @param input - The statuses, the guided flag, the current section and the copy.
 * @returns What the `SectionIndex` draws. Pure.
 */
export function sectionIndexEntries(input: SectionIndexEntriesInput): SectionIndexEntries {
    const { statuses, guided, current, messages, locale } = input;
    const { index } = messages;
    const items = EDITOR_SECTIONS.map((section) => itemOf(section, statuses[section], input));
    const attention = items.reduce((sum, item) => sum + (item.count ?? 0), 0);
    const done = String(doneCount(statuses));
    const barName =
        index.barName.replace('{current}', index.sections[current]) +
        (attention > 0 ? pluralOf(index.barNameAttention, attention, locale) : '') +
        (guided ? index.barNameDone.replace('{done}', done) : '');

    return {
        items,
        barName,
        ...(guided
            ? { barSuffix: index.barDone.replace('{done}', done), doneText: index.done.replace('{done}', done) }
            : {}),
        ...(attention > 0 ? { barCount: index.barCount.replace('{count}', String(attention)) } : {}),
    };
}

/** One section's item. Pure. */
function itemOf(section: EditorSectionId, status: SectionStatus, input: SectionIndexEntriesInput): SectionIndexItem {
    const { index } = input.messages;
    const base = {
        id: section,
        label: index.sections[section],
        ...(section === 'photos' ? { shortLabel: index.photosShort } : {}),
        ...(input.guided ? { hint: index.hint[section] } : {}),
    };

    switch (status.kind) {
        case 'fix':
            return {
                ...base,
                tone: 'fix',
                reason: pluralOf(index.status.fix, status.count, input.locale),
                count: status.count,
            };

        case 'attention': {
            const words = index.reason[status.reason];
            const reason = typeof words === 'string' ? words : pluralOf(words, status.count, input.locale);

            return { ...base, tone: 'attention', reason, count: status.count };
        }

        case 'inProgress':
            return { ...base, tone: 'muted', reason: index.reason[status.reason] };

        case 'notStarted':
            return {
                ...base,
                tone: 'muted',
                reason: input.guided && section === 'details' ? index.status.startHere : index.status.notStarted,
            };

        case 'optional':
            return { ...base, tone: 'muted', reason: index.status.optional };

        case 'complete':
            return section === 'photos'
                ? { ...base, tone: 'complete', reason: index.status.ready }
                : { ...base, tone: 'complete', spokenStatus: index.status.complete };

        default: {
            const unreachable: never = status;

            return unreachable;
        }
    }
}
