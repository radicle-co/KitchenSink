/**
 * Renders the generated parts of docs/architecture/recipeStateModel.md and recipeStateModel.json from the recipe-core
 * state module (ADR-0103). Pure: nothing here reads a file or formats text, so the bin owns I/O and prettier.
 *
 * DESIGN PATTERN: **Template Method over a table**. Every block is `header + rows` where the rows are read from the
 * module's tables, and the document's own words (guards, sentences, "built" notes) come from `docProse.ts`, keyed by the
 * module's names so neither can drift from the other.
 */
import { REFUSALS_OF_SOURCE } from '@commise/features-recipes/public-refusal';
import { recipeStateMessages } from '@commise/features-recipes/recipe-state-messages';
import {
    Audience,
    CheckDecisionKind,
    CheckOutcome,
    CheckState,
    CREATIONS,
    EvidenceCapture,
    Hold,
    LABELLED_NAMES,
    labelKeysOf,
    LIFECYCLE_AUDIENCE_STATES,
    Lifecycle,
    Origin,
    REFUSAL,
    RETIRED_NAMES,
    RewrittenFact,
    SourceConfirmation,
    StepsCredit,
    TRANSITIONS,
    type LabelledNameKey,
    type RetiredGroup,
    type TransitionRow,
} from '@kitchensink/recipe-core/recipe-state';
import { PLANNED } from '@kitchensink/recipe-core/recipe-state/planned';

import {
    ADAPTED_SHAPE_NOTES,
    CHECK_DIAGRAM,
    CONFIRMATION_ROWS,
    CREATION_ROWS,
    HOLD_EDGE_ROWS,
    HOLD_ROWS,
    LIFECYCLE_ROWS,
    ORIGIN_ROWS,
    REFUSAL_ROWS,
    STORED_VALUE_ROWS,
    type EdgeDocRow,
    type ValueObjectName,
} from './docProse.js';

/** The origin diagram's rows: each draws its first move. The document's table lists every move. */
const ORIGIN_DIAGRAM_ROWS: readonly string[] = [
    'ANSWER_OWN',
    'ANSWER_WEB_PAGE',
    'ANSWER_BOOK',
    'ANSWER_PAID_SITE',
    'ANSWER_PERSON',
    'CURATOR_DECLARE',
    'DOWNGRADE_BOOK',
    'DOWNGRADE_PAID_SITE',
];

/**
 * A markdown table with no padding: prettier aligns it.
 *
 * @param header - The column names.
 * @param rows - The rows, each with one cell per column and no `|`.
 * @returns The table text. Pure.
 */
export function markdownTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
    const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '-').join(' | ')} |`];

    for (const cells of rows) {
        if (cells.length !== header.length) {
            throw new Error(
                `A row has ${String(cells.length)} cells and the table has ${String(header.length)} columns: ${cells[0]}`,
            );
        }

        if (cells.some((cell) => cell.includes('|'))) {
            throw new Error(`A cell holds a pipe, which would split its column: ${cells[0]}`);
        }

        lines.push(`| ${cells.join(' | ')} |`);
    }

    return lines.join('\n');
}

const code = (text: string): string => `\`${text}\``;

const eventOf = (row: TransitionRow): string => row.docEvent ?? row.event;

const mermaid = (body: string): string => `\`\`\`mermaid\n${body}\n\`\`\``;

/**
 * The lifecycle by audience diagram (5.1): every edge in table order, with neighbouring edges between the same two
 * states written as one line.
 *
 * @param rows - The TRANSITIONS rows of the lifecycle axis, in order.
 * @returns The diagram text, without its fence. Pure.
 */
export function lifecycleDiagram(rows: readonly TransitionRow[]): string {
    const states = Object.entries(LIFECYCLE_AUDIENCE_STATES).map(([id, state]) => {
        const name = state.audience === null ? state.lifecycle : `${state.lifecycle}, ${state.audience}`;

        return `    state "${name}" as ${id}`;
    });
    const edges: { from: string; to: string; events: string[] }[] = [];

    for (const row of rows) {
        for (const move of row.moves) {
            const last = edges.at(-1);

            if (last !== undefined && last.from === move.from && last.to === move.to) {
                last.events.push(eventOf(row));
            } else {
                edges.push({ from: move.from, to: move.to, events: [eventOf(row)] });
            }
        }
    }

    return [
        'stateDiagram-v2',
        ...states,
        ...edges.map((edge) => `    ${edge.from} --> ${edge.to}: ${edge.events.join(' / ')}`),
    ].join('\n');
}

/**
 * The origin diagram (5.2): the first move of each listed row.
 *
 * @param rows - The TRANSITIONS rows of the origin axis.
 * @param listed - The ids of the rows to draw, in order.
 * @returns The diagram text, without its fence. Pure.
 */
export function originDiagram(rows: readonly TransitionRow[], listed: readonly string[]): string {
    const lines = listed.map((id) => {
        const row = rows.find((candidate) => candidate.id === id);
        const move = row?.moves[0];

        if (row === undefined || move === undefined) {
            throw new Error(`The origin diagram lists ${id}, and the module has no such row`);
        }

        return `    ${move.from} --> ${move.to}: ${eventOf(row)}`;
    });

    return ['stateDiagram-v2', ...lines].join('\n');
}

/**
 * Table 4.8's headings of `VIEW_ADAPTED_BY_COOK`: one row per heading shape with its owner and reader words, then the
 * owner-only earned sentence. Written from the registry's shapes and the messages, so the table cannot say otherwise.
 *
 * @param shapes - The shapes of the name that this table covers: `.heading*.owner`, `.heading*.reader` and `.earnedSentence`.
 * @param textOf - The English string of a shape (the name's key without its prefix).
 * @returns The table text. Throws for any other shape, or a heading missing a form. Pure.
 */
export function adaptedTable(shapes: readonly string[], textOf: (shape: string) => string): string {
    const rows: string[][] = [];

    for (const shape of shapes) {
        if (shape === '.earnedSentence') {
            continue;
        }

        if (!shape.startsWith('.heading') || !(shape.endsWith('.owner') || shape.endsWith('.reader'))) {
            throw new Error(`The adapted table has no row shape for ${shape}`);
        }

        if (shape.endsWith('.reader')) {
            continue;
        }

        const base = shape.slice(0, -'.owner'.length);

        if (!shapes.includes(`${base}.reader`)) {
            throw new Error(`The heading ${base} has an owner form and no reader form`);
        }

        rows.push([`\`${base}\`${ADAPTED_SHAPE_NOTES.get(base) ?? ''}`, textOf(shape), textOf(`${base}.reader`)]);
    }

    if (shapes.includes('.earnedSentence')) {
        rows.push(['`.earnedSentence`', textOf('.earnedSentence'), 'none (owner only)']);
    }

    return markdownTable(['Name', 'Owner (en)', 'Reader (en)'], rows);
}

/**
 * The `en` cell of a refusal row. A `{line}` in the row's words stands for the refusal's sentence in the messages file, so
 * the document quotes the string and never keeps a second copy of it.
 *
 * @param row - The refusal's row.
 * @returns The cell text. Throws when a row has `{line}` and the messages have no sentence for the name. Pure.
 */
export function enCellOf(row: { readonly name: string; readonly en: string }): string {
    if (!row.en.includes('{line}')) {
        return row.en;
    }

    const line = new Map<string, string>(Object.entries(recipeStateMessages.en.refusals)).get(row.name);

    if (line === undefined) {
        throw new Error(`The refusal row ${row.name} quotes a sentence, and the messages have none`);
    }

    return row.en.replace('{line}', line);
}

/**
 * Fill each `{label:KEY}` in a cell with the label's English string from the messages file, so the document quotes the
 * string and never keeps a second copy of it.
 *
 * @param text - The cell text.
 * @returns The text with each placeholder replaced. Throws when a key is not in the messages. Pure.
 */
export function labelsIn(text: string): string {
    return text.replace(/\{label:([^}]+)\}/gu, (_match, key: string) => labelOf(key));
}

const LABELS = new Map<string, string>(Object.entries(recipeStateMessages.en.labels));

/**
 * @param key - A label key.
 * @returns The key's English string from the messages file. Throws when the messages have no such key. Pure.
 */
function labelOf(key: string): string {
    const label = LABELS.get(key);

    if (label === undefined) {
        throw new Error(`The document quotes the label ${key}, and the messages have no such key`);
    }

    return label;
}

const VALUE_OBJECTS: Readonly<Record<ValueObjectName, Readonly<Record<string, string>>>> = {
    Lifecycle,
    Audience,
    Origin,
    EvidenceCapture,
    RewrittenFact,
};

const groupOf = (row: TransitionRow): string => row.group ?? row.id;

function edgeCells(axisRows: readonly TransitionRow[], doc: EdgeDocRow): { event: string; actor: string } {
    const rows = axisRows.filter((row) => groupOf(row) === doc.group);
    const first = rows.at(0);

    if (first === undefined) {
        throw new Error(`The document row ${doc.group} covers no TRANSITIONS row`);
    }

    return { event: doc.event ?? code(eventOf(first)), actor: first.actors.join(', ') };
}

function edgeTable(axis: string, docRows: readonly EdgeDocRow[], withGuard: boolean): string {
    const axisRows = TRANSITIONS.filter((row) => row.axis === axis);
    const rows = docRows.map((doc) => {
        const { event, actor } = edgeCells(axisRows, doc);

        return withGuard ? [doc.from, event, actor, doc.guard ?? '', doc.to] : [doc.from, event, actor, doc.to];
    });

    return markdownTable(
        withGuard ? ['From', 'Event', 'Actor', 'Guard', 'To'] : ['From', 'Event', 'Actor', 'To'],
        rows,
    );
}

function valuesCell(row: (typeof STORED_VALUE_ROWS)[number]): string {
    if ('prose' in row) {
        return row.prose;
    }

    const entries = Object.entries(VALUE_OBJECTS[row.object]).map(([name, value]) => `${code(name)}='${value}'`);

    return `${entries.join(', ')}${row.suffix}`;
}

function retiredTable(group: RetiredGroup): string {
    return markdownTable(
        ['Old', 'New', 'Note'],
        RETIRED_NAMES.filter((entry) => entry.group === group).map((entry) => [
            entry.old,
            entry.replacement,
            entry.note,
        ]),
    );
}

/**
 * Every generated block of the document, by the id on its markers.
 *
 * @returns Block id to block text, unformatted. Pure.
 */
export function renderBlocks(): Record<string, string> {
    const lifecycle = TRANSITIONS.filter((row) => row.axis === 'lifecycleAudience');
    const origin = TRANSITIONS.filter((row) => row.axis === 'origin');

    return {
        '4.2-1': markdownTable(
            ['Type', 'Stored in', 'Values', 'Built'],
            STORED_VALUE_ROWS.map((row) => [row.type, row.storedIn, valuesCell(row), row.built]),
        ),
        '4.5-1': markdownTable(
            ['Internal name', 'Computed by', 'Wire today', 'en (whole sentence)', 'Built'],
            REFUSAL_ROWS.map((row) => [code(row.name), row.computedBy, row.wire, enCellOf(row), row.built]),
        ),
        '4.6-1': markdownTable(
            ['Internal name', 'Stored', 'Enforcement', 'Set by', 'Cleared by', 'Owner label', 'Built'],
            HOLD_ROWS.map((row) => [
                code(row.name),
                row.stored,
                row.enforcement,
                row.setBy,
                row.clearedBy,
                labelsIn(row.ownerLabel),
                row.built,
            ]),
        ),
        '4.8-1': adaptedTable(
            LABELLED_NAMES.VIEW_ADAPTED_BY_COOK.shapes.filter(
                (shape) => shape.startsWith('.heading') || shape === '.earnedSentence',
            ),
            (shape) => labelOf(`VIEW_ADAPTED_BY_COOK${shape}`),
        ),
        '5.1-1': mermaid(lifecycleDiagram(lifecycle)),
        '5.1-2': edgeTable('lifecycleAudience', LIFECYCLE_ROWS, true),
        '5.2-1': mermaid(originDiagram(origin, ORIGIN_DIAGRAM_ROWS)),
        '5.2-2': edgeTable('origin', ORIGIN_ROWS, true),
        '5.3-1': edgeTable('sourceConfirmation', CONFIRMATION_ROWS, false),
        '5.4-1': markdownTable(
            ['Hold', 'From', 'Event', 'Actor', 'Guard', 'To', 'Built'],
            HOLD_EDGE_ROWS.map((row) => [row.hold, row.from, row.event, row.actor, row.guard, row.to, row.built]),
        ),
        '5.5-1': CHECK_DIAGRAM,
        '5.7-1': markdownTable(
            [
                'Creation',
                'Actor',
                'Lifecycle, audience',
                'Origin',
                'Confirmation',
                'Holds',
                'Evidence, facts',
                'Clone link',
                'Built',
            ],
            CREATION_ROWS.map((row) => [
                row.creation,
                row.actor,
                row.lifecycleAudience,
                row.origin,
                row.confirmation,
                row.holds,
                row.evidence,
                row.cloneLink,
                row.built,
            ]),
        ),
        '5.8-1': markdownTable(
            ['Axis', 'From', 'Event', 'Actor', 'Guard', 'To', 'Pending'],
            PLANNED.map((row) => [row.axisLabel, row.from, row.event, row.actor, row.guard, row.to, row.pending]),
        ),
        '6-1': retiredTable('audience'),
        '6-2': retiredTable('originAndCopies'),
        '6-3': retiredTable('checkAndRefusals'),
    };
}

const BEGIN_MARKER = /^<!-- recipeState:begin (\S+) -->$/u;

/**
 * Put the generated blocks into the document between their markers, leaving every other byte alone. The markers are
 * found line by line, so a long document costs time in proportion to its length.
 *
 * @param markdown - The document.
 * @param blocks - Block id to block text.
 * @returns The document with each block replaced. Throws when a block has no markers, a marker pair has no block, or a
 * begin marker has no end marker. Pure.
 */
export function applyBlocks(markdown: string, blocks: Readonly<Record<string, string>>): string {
    const byId = new Map(Object.entries(blocks));
    const seen = new Set<string>();
    const out: string[] = [];
    let endMarker: string | undefined;

    for (const line of markdown.split('\n')) {
        if (endMarker !== undefined) {
            if (line === endMarker) {
                out.push(line);
                endMarker = undefined;
            }

            continue;
        }

        out.push(line);

        const id = BEGIN_MARKER.exec(line)?.[1];

        if (id === undefined) {
            continue;
        }

        const block = byId.get(id);

        if (block === undefined) {
            throw new Error(`The document has markers for ${id}, and the generator has no block of that id`);
        }

        seen.add(id);
        out.push('', block, '');
        endMarker = `<!-- recipeState:end ${id} -->`;
    }

    if (endMarker !== undefined) {
        throw new Error(`The document has a begin marker and no end marker: ${endMarker}`);
    }

    for (const id of byId.keys()) {
        if (!seen.has(id)) {
            throw new Error(`The generator has a block ${id}, and the document has no markers for it`);
        }
    }

    return out.join('\n');
}

/** The refusal `reason` the model JSON carries: the client's own reason for a name it shows today, else the camel-cased name. */
function reasonOf(name: string): string {
    const known = REFUSALS_OF_SOURCE.find(([candidate]) => candidate === name);

    if (known !== undefined) {
        return known[1];
    }

    return name
        .replace(/^REFUSAL_/, '')
        .toLowerCase()
        .replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

const AXES = {
    lifecycle: Lifecycle,
    audience: Audience,
    origin: Origin,
    sourceConfirmation: SourceConfirmation,
    evidence: EvidenceCapture,
    holds: Hold,
    checkState: CheckState,
    checkOutcome: CheckOutcome,
    checkDecisionKind: CheckDecisionKind,
    stepsCredit: StepsCredit,
    rewrittenFact: RewrittenFact,
} as const;

/**
 * The model as data, for the guards that read it. Every key is written from the module and the generator's prose.
 *
 * @returns The object `recipeStateModel.json` holds. Pure.
 */
export function renderModel(): Record<string, unknown> {
    return {
        note: 'Generated from recipe-core by packages/tools/recipeStateDoc. Do not edit by hand: change the module or docProse.ts and run npm run recipeState:generate.',
        axes: Object.entries(AXES).map(([name, values]) => ({ name, values: Object.keys(values) })),
        storedValues: Object.fromEntries(
            Object.values(AXES).flatMap((values) => Object.entries(values).filter(([name, value]) => name !== value)),
        ),
        labels: Object.entries(LABELLED_NAMES).map(([name, { viewer }]) => {
            // `Object.entries` widens the registry's names to `string`; they are its own keys.
            const keys = labelKeysOf(name as LabelledNameKey);

            return { name, viewer, keys, en: Object.fromEntries(keys.map((key) => [key, labelOf(key)])) };
        }),
        refusals: REFUSAL_ROWS.map((row) => ({
            reason: reasonOf(row.name),
            name: row.name,
            computedBy: row.computedBy,
            wire: row.wire,
            built: row.built,
            known: row.name in REFUSAL,
        })),
        holds: HOLD_ROWS,
        transitions: TRANSITIONS.map((row) => ({
            id: row.id,
            axis: row.axis,
            event: row.event,
            actors: row.actors,
            guard: row.guard,
            moves: row.moves,
        })),
        planned: PLANNED,
        creations: CREATIONS,
        retired: RETIRED_NAMES,
    };
}
