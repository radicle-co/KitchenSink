/**
 * A seed plan as the Markdown a reviewer reads in the CI summary (curated catalog plan U5, R41, KTD-22).
 *
 * @pattern Visitor — an exhaustive switch over `CatalogChange` (`describeChange`, `classOf`), so a new kind of change
 *   is a compile error here until the diff can show it
 * @pattern Registry — `CLASS_HEADINGS` names every class once, and its key order is the order the diff lists them
 *
 * The diff lists every R41 class (roots added, renamed, merged, split, aliased and retired, roots whose item changed,
 * variants moved or promoted) and every citation, tier and value change, because a tier is a hand judgment the format
 * check cannot verify (KTD-22). It reads only `plan.changes`, never the rows.
 */
import type { CatalogChange, CatalogPlan, OwnerKey } from './catalogPlanBuilder.js';
import type { ContentCitation } from './catalogSnapshot.js';
import type { CuratedPart } from './curatedSeedFormat.js';

/** How the diff is rendered. */
export interface CatalogDiffOptions {
    /** A line the diff leads with, such as why its base is an empty catalog. */
    readonly note?: string;
    /** The most lines one class lists before it says how many it left out. */
    readonly limit?: number;
}

/** How many lines one class lists by default: enough to review, few enough that the summary stays readable. */
const DEFAULT_LIMIT = 50;

/** Every class a change belongs to, by heading, in the order the diff lists them. */
const CLASS_HEADINGS = {
    rootAdded: 'Roots added',
    rootSplit: 'Roots split off',
    rootRestored: 'Roots restored',
    rootRenamed: 'Roots renamed',
    rootSynonymsChanged: 'Root synonyms changed',
    rootItemChanged: 'Roots whose item changed',
    rootMerged: 'Roots merged',
    rootAliased: 'Roots aliased',
    rootDisplaced: 'Roots displaced from their item',
    rootRetired: 'Roots retired',
    variantAdded: 'Variants added',
    variantRestored: 'Variants restored',
    variantMoved: 'Variants moved',
    variantPromoted: 'Variants promoted to roots',
    variantAliased: 'Variants aliased',
    variantRetired: 'Variants retired',
    variantPartsChanged: 'Variant parts changed',
    itemChanged: 'Items whose sources, portions or categories changed',
    citationChanged: 'Citations or tiers changed',
    nutritionValuesChanged: 'Nutrition values changed',
    liveFoodClaimed: 'Live foods retired for a seed root’s name or a seed entry’s source key',
    liveSourceReleased: 'Source keys taken over from live foods',
} as const;

/** A class of change. */
type ChangeClass = keyof typeof CLASS_HEADINGS;

/** The classes, in the order the diff lists them. */
const CLASSES = Object.keys(CLASS_HEADINGS).filter((key): key is ChangeClass => Object.hasOwn(CLASS_HEADINGS, key));

/**
 * Escape text a committed file supplies, so it can neither format nor inject the summary. Pure.
 *
 * @param text - Any text.
 * @returns The text with Markdown punctuation backslash-escaped and HTML's three specials as entities.
 */
function escapeMarkdown(text: string): string {
    return text
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/[\\`*_[\]|#~]/gu, (character) => `\\${character}`);
}

/**
 * A key as inline code. Pure.
 *
 * @param key - A natural key or id; keys never contain a backtick.
 * @returns The key in backticks.
 */
function code(key: string): string {
    return `\`${key.replace(/`/gu, '')}\``;
}

/**
 * An owner as the diff names it. Pure.
 *
 * @param owner - A root or variant.
 * @returns `root \`key\`` or `variant \`key\``.
 */
function ownerOf(owner: OwnerKey): string {
    return `${owner.kind} ${code(owner.key)}`;
}

/**
 * A citation as the diff names it: its dataset, key and tier, or its label. Pure.
 *
 * @param citation - A citation, or `null` for no numbers.
 * @returns The text.
 */
function citationOf(citation: ContentCitation | null): string {
    if (citation === null) {
        return 'no numbers';
    }

    return citation.dataset === 'label'
        ? `label ${escapeMarkdown(citation.url)} (${escapeMarkdown(citation.servingLabel)}, ${citation.servingGrams} g)`
        : `${citation.dataset} ${escapeMarkdown(citation.externalKey)} (${citation.match})`;
}

/**
 * A variant's parts as the diff names them. Pure.
 *
 * @param parts - The parts, in order.
 * @returns `attribute: text` joined by `; `.
 */
function partsOf(parts: readonly CuratedPart[]): string {
    return parts.map((part) => `${part.attribute}: ${escapeMarkdown(part.text)}`).join('; ');
}

/**
 * A list of names as the diff names it. Pure.
 *
 * @param names - Names.
 * @returns The names joined by `, `, or `(none)`.
 */
function namesOf(names: readonly string[]): string {
    return names.length === 0 ? '(none)' : names.map(escapeMarkdown).join(', ');
}

/**
 * The class a change belongs to: its kind, or for a removal, why. Pure.
 *
 * @param change - A change.
 * @returns Its class.
 */
function classOf(change: CatalogChange): ChangeClass {
    switch (change.kind) {
        case 'rootRemoved':
            return change.reason === 'merged'
                ? 'rootMerged'
                : change.reason === 'aliased'
                  ? 'rootAliased'
                  : 'rootDisplaced';

        case 'variantRemoved':
            return change.reason === 'promoted' ? 'variantPromoted' : 'variantAliased';

        case 'rootAdded':
        case 'rootSplit':
        case 'rootRestored':
        case 'rootRenamed':
        case 'rootSynonymsChanged':
        case 'rootItemChanged':
        case 'rootRetired':
        case 'variantAdded':
        case 'variantRestored':
        case 'variantMoved':
        case 'variantRetired':
        case 'variantPartsChanged':
        case 'itemChanged':
        case 'citationChanged':
        case 'nutritionValuesChanged':
        case 'liveFoodClaimed':
        case 'liveSourceReleased':
            return change.kind;
    }
}

/**
 * One change as one line of its class. Pure.
 *
 * @param change - A change.
 * @returns The line, without its bullet.
 */
function describeChange(change: CatalogChange): string {
    switch (change.kind) {
        case 'rootAdded':
        case 'rootRestored':
        case 'rootRetired':
            return `${code(change.seedKey)} ${escapeMarkdown(change.name)}`;

        case 'rootSplit':
            return `${code(change.seedKey)} ${escapeMarkdown(change.name)}, split from ${code(change.from)}`;

        case 'rootRenamed':
            return `${code(change.seedKey)} ${escapeMarkdown(change.from)} → ${escapeMarkdown(change.to)}`;

        case 'rootSynonymsChanged':
            return `${code(change.seedKey)} ${namesOf(change.from)} → ${namesOf(change.to)}`;

        case 'rootItemChanged':
            return `${code(change.seedKey)} item ${code(change.from)} → ${code(change.to)}`;

        case 'rootRemoved':
            return `${code(change.seedKey)} ${escapeMarkdown(change.name)} → ${ownerOf(change.to)}`;

        case 'variantAdded':
        case 'variantRestored':
        case 'variantRetired':
            return `${code(change.item)} under ${code(change.root)}`;

        case 'variantMoved':
            return `${code(change.item)} ${code(change.from)} → ${code(change.to)}`;

        case 'variantRemoved':
            return `${code(change.item)} under ${code(change.root)} → ${ownerOf(change.to)}`;

        case 'variantPartsChanged':
            return `${code(change.item)} ${partsOf(change.from)} → ${partsOf(change.to)}`;

        case 'itemChanged':
            return code(change.item);

        case 'citationChanged':
            return `${ownerOf(change.owner)} ${citationOf(change.from)} → ${citationOf(change.to)}`;

        case 'nutritionValuesChanged':
            return ownerOf(change.owner);

        case 'liveFoodClaimed':
            return `live food ${code(change.id)} → ${code(change.seedKey)}`;

        case 'liveSourceReleased':
            return `${escapeMarkdown(change.source.source)} ${code(change.source.externalKey)} from live food ${code(change.id)}`;
    }
}

/**
 * Render a plan's changes as Markdown: a count per class, then each class's lines, capped. Pure.
 *
 * @param plan - A plan.
 * @param options - A leading note, and the most lines a class lists.
 * @returns The Markdown, ending in a newline.
 */
export function renderCatalogDiff(plan: CatalogPlan, options: CatalogDiffOptions): string {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const byClass = new Map<ChangeClass, string[]>();

    for (const change of plan.changes) {
        const changeClass = classOf(change);

        byClass.set(changeClass, [...(byClass.get(changeClass) ?? []), describeChange(change)]);
    }

    const lines = ['## Catalog seed diff', ''];

    if (options.note !== undefined) {
        lines.push(`> ${escapeMarkdown(options.note)}`, '');
    }

    if (byClass.size === 0) {
        lines.push('No catalog change.');

        return `${lines.join('\n')}\n`;
    }

    const present = CLASSES.filter((changeClass) => byClass.has(changeClass));

    lines.push('| Change | Count |', '| --- | ---: |');
    lines.push(
        ...present.map(
            (changeClass) => `| ${CLASS_HEADINGS[changeClass]} | ${String(byClass.get(changeClass)?.length ?? 0)} |`,
        ),
    );

    for (const changeClass of present) {
        const described = byClass.get(changeClass) ?? [];
        const shown = described.slice(0, limit);

        lines.push('', `### ${CLASS_HEADINGS[changeClass]} (${String(described.length)})`, '');
        lines.push(...shown.map((line) => `- ${line}`));

        if (described.length > shown.length) {
            lines.push(`- … ${String(described.length - shown.length)} more`);
        }
    }

    return `${lines.join('\n')}\n`;
}
