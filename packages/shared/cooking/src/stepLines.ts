import { DefaultAbbrMarkerOptions, split } from 'sentence-splitter';

/**
 * Cooking abbreviations that end in a full stop but do not end a sentence. They
 * extend `sentence-splitter`'s own English list, through its own option. The library holds an abbreviation
 * only when the next word is not capitalised, so "Fold the flour in. Bake…" still splits. Each entry has a case in
 * `stepLines.test.ts` that the bare library cuts wrongly.
 */
export const STEP_LINE_ABBREVIATIONS: readonly string[] = [
    'tbsp.',
    'Tbsp.',
    'tsp.',
    'oz.',
    'approx.',
    'Fig.',
    'in.',
    'c.',
    'lb.',
    'lbs.',
    'pt.',
    'qt.',
    'doz.',
    'T.',
    't.',
];

const SPLIT_OPTIONS = {
    AbbrMarker: {
        language: {
            ...DefaultAbbrMarkerOptions.language,
            ABBREVIATIONS: [...DefaultAbbrMarkerOptions.language.ABBREVIATIONS, ...STEP_LINE_ABBREVIATIONS],
        },
    },
};

/**
 * Splits one recipe step into the lines the cook ticks, at sentence ends only. A semicolon or a colon is not a
 * cut, and an abbreviation, a decimal or a parenthesis never ends a line.
 *
 * The library leaves punctuation that stands outside any sentence ("Mix.  ?? Bake.") as a node of its own. That text
 * is never dropped: it joins the line before it, or the line after it when it comes first.
 *
 * @pattern Adapter over `sentence-splitter` — its sentence node tree becomes the domain's list of lines.
 * @param text - The step's instruction text.
 * @returns The lines, trimmed and in order. Each is a slice of `text`, and only whitespace lies between them. An
 * empty or whitespace-only step has no lines.
 */
export function splitStepLines(text: string): readonly string[] {
    const ranges: [number, number][] = [];
    let pendingStart: number | null = null;

    for (const node of split(text, SPLIT_OPTIONS)) {
        const [start, end] = node.range;
        const previous = ranges.at(-1);

        if (node.type === 'WhiteSpace') {
            continue;
        }

        if (node.type === 'Sentence') {
            ranges.push([pendingStart ?? start, end]);
            pendingStart = null;
        } else if (previous !== undefined) {
            previous[1] = end;
        } else {
            pendingStart ??= start;
        }
    }

    // Only stray punctuation, no sentence. Everything before `pendingStart` is whitespace, so this line is the whole
    // trimmed text (Stryker's `[]` mutant here is equivalent for that reason).
    if (pendingStart !== null) {
        ranges.push([pendingStart, text.length]);
    }

    return ranges.map(([start, end]) => text.slice(start, end).trim());
}
