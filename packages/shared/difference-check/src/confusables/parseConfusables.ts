/**
 * @module @kitchensink/difference-check/confusables: read Unicode's `confusables.txt` (UTS #39, version 16.0.0) into the
 * map the skeleton uses, and render that map as the committed module the runtime imports.
 *
 * The runtime never reads the `.txt`: `tsc` does not copy it into `dist` and the service image copies only `dist`, so a
 * missing file would make every check an error while the tests stayed green. The `.txt` is the authority; the module is
 * its generated copy, and a unit test holds the two equal.
 *
 * Pure.
 */

/** The map of the data file: a source string to its target string. */
export type ConfusablesMap = Readonly<Record<string, string>>;

/** One data line: `source ; target ; type # comment`, the first two fields as hexadecimal code points. */
const DATA_LINE = /^([0-9A-F]+(?: [0-9A-F]+)*) ;\t([0-9A-F]+(?: [0-9A-F]+)*) ;/;

/**
 * The string of a field of space-separated hexadecimal code points.
 *
 * @param field - For example `0072 006E`.
 * @returns The characters.
 */
function charactersOf(field: string): string {
    return String.fromCodePoint(...field.split(' ').map((hex) => Number.parseInt(hex, 16)));
}

/**
 * Parse the data file.
 *
 * @param text - The contents of `confusables.txt`.
 * @returns One entry per data line. Comments and blank lines are skipped; a leading byte order mark is ignored.
 */
export function parseConfusables(text: string): ConfusablesMap {
    const entries: Record<string, string> = {};

    for (const line of text.replace(/^\ufeff/, '').split('\n')) {
        const match = DATA_LINE.exec(line);

        if (match === null) {
            continue;
        }

        entries[charactersOf(match[1] ?? '')] = charactersOf(match[2] ?? '');
    }

    return entries;
}

/**
 * Every code point of a string as a `\u{...}` escape, so the generated file holds no invisible or look-alike character.
 *
 * @param text - Any string.
 * @returns A quoted string literal.
 */
function literalOf(text: string): string {
    const escapes = Array.from(
        text,
        (character) => `\\u{${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}}`,
    );

    return `'${escapes.join('')}'`;
}

/**
 * The source of the committed module for a map.
 *
 * @param map - From {@link parseConfusables}.
 * @returns The text of `confusablesV1.generated.ts`, entries in code point order of their source.
 */
export function renderConfusablesModule(map: ConfusablesMap): string {
    const sources = Object.keys(map).sort(
        (left, right) => (left.codePointAt(0) ?? 0) - (right.codePointAt(0) ?? 0) || left.localeCompare(right),
    );
    const lines = sources.map((source) => `    ${literalOf(source)}: ${literalOf(map[source] ?? '')},`);

    return [
        '/**',
        ' * GENERATED from `confusables.txt` (Unicode Security Mechanisms, UTS #39, version 16.0.0) by `generateConfusables.ts`.',
        ' * Do not edit: change the data file and run `npm run generate:confusables`. A unit test holds this module equal to what',
        ' * the generator renders from the file. Unicode License V3: see `UNICODE_LICENSE.txt` beside the data file.',
        ' */',
        'export const CONFUSABLES_V1: Readonly<Record<string, string>> = {',
        ...lines,
        '};',
        '',
    ].join('\n');
}
