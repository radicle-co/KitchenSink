/**
 * @module @kitchensink/docgen-components/specTables — the token tables in the build spec
 * (`docs/design/uiOverhaul/buildSpec.md` §1.4 colour roles and §1.5 type roles), rendered from `@commise/ui`.
 *
 * The spec is a hand-written document, so this module owns only the text between a pair of markers and keeps every
 * other byte. The values come from the same objects the app paints with, so the spec cannot disagree with the
 * product; the rules beside each table (what a role is for, how it wraps) stay hand-written in the spec, because no
 * token states them.
 *
 * @sideEffect `buildSpecDocument` reads the spec and the repository's Prettier configuration.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { palette, role, roleDark } from '@commise/ui/colors';
import { fontFamily, fontWeight } from '@commise/ui/scale';
import { typeRole, type TypeRoleSpec } from '@commise/ui/tokens/typography';
import { format, resolveConfig } from 'prettier';

import { DocgenError } from './errors.js';

/** The build spec, repo-relative. */
export const BUILD_SPEC_PATH = 'docs/design/uiOverhaul/buildSpec.md';

/** The command that rewrites a generated region, named in its marker so a reader knows not to edit by hand. */
export const REGENERATE = 'npm run docs:generate --workspace=packages/tools/docgen-components';

/** The line that opens a generated region. */
export function startMarker(name: string): string {
    return `<!-- BEGIN generated:${name}. Do not edit by hand: run \`${REGENERATE}\`. -->`;
}

/** The line that closes a generated region. */
export function endMarker(name: string): string {
    return `<!-- END generated:${name} -->`;
}

/** A markdown table, unpadded: the spec is formatted by Prettier afterwards, which aligns the columns. */
function table(header: readonly string[], body: readonly (readonly string[])[]): string {
    const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`.replace(/ {2}\|/g, ' |');

    return [line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
}

/** The first family of a CSS font stack, unquoted: `"Manrope", Inter, …` is Manrope. */
function familyName(stack: string): string {
    return (stack.split(',')[0] ?? stack).trim().replace(/^"|"$/g, '');
}

/** A role's size cell: one number, the size per container class when it varies, or the size of its line. */
function sizeCell(size: TypeRoleSpec['size']): string {
    if (size === 'inherit') {
        return 'size of its line';
    }

    if (typeof size === 'number') {
        return `${size}`;
    }

    return size.narrow === size.regular && size.regular === size.wide
        ? `${size.regular}`
        : `${size.narrow} narrow, ${size.regular} regular, ${size.wide} wide`;
}

/**
 * The §1.5 type-role table: face family, size and leading in px, the weight it paints, and its digits.
 *
 * @param roles - The type roles, in the order the design system declares them.
 * @param faces - The CSS font stack of each face.
 * @param weights - The number each weight step paints.
 * @returns The table, unpadded.
 */
export function typeRoleTable(
    roles: Readonly<Record<string, TypeRoleSpec>>,
    faces: Readonly<Record<TypeRoleSpec['face'], string>>,
    weights: Readonly<Record<TypeRoleSpec['weight'], number>>,
): string {
    return table(
        ['Role', 'Face', 'Size (px)', 'Weight', 'Leading (px)', 'Digits'],
        Object.entries(roles).map(([name, spec]) => [
            `\`${name}\``,
            familyName(faces[spec.face]),
            sizeCell(spec.size),
            `${weights[spec.weight]}`,
            spec.lineHeight === 'inherit' ? 'size of its line' : `${spec.lineHeight}`,
            spec.figure === true ? 'tabular, lining' : '',
        ]),
    );
}

/**
 * The §1.4 colour-role table: each role's light and dark value. A light value is labelled with its palette name only
 * when exactly one palette name has that value; when two share it, either label would be a guess. No contrast column:
 * `@commise/ui`'s `redesignContrast.test.ts` measures every pair.
 *
 * @param light - Each role's light value.
 * @param dark - Each role's dark value, keyed like `light`.
 * @param paletteValues - The palette, to name a light value by.
 * @returns The table, unpadded.
 * @throws DocgenError when a role has no dark value.
 */
export function colorRoleTable(
    light: Readonly<Record<string, string>>,
    dark: Readonly<Record<string, string>>,
    paletteValues: Readonly<Record<string, string>>,
): string {
    const namesByValue = new Map<string, string[]>();

    for (const [name, value] of Object.entries(paletteValues)) {
        namesByValue.set(value, [...(namesByValue.get(value) ?? []), name]);
    }

    const named = (value: string): string => {
        const names = namesByValue.get(value) ?? [];

        return names.length === 1 ? `\`${value}\` (\`${names[0]}\`)` : `\`${value}\``;
    };

    return table(
        ['Role', 'Light', 'Dark'],
        Object.entries(light).map(([name, value]) => {
            const darkValue = dark[name];

            if (darkValue === undefined) {
                throw new DocgenError(`colour role "${name}" has no dark value.`);
            }

            return [`\`${name}\``, named(value), `\`${darkValue}\``];
        }),
    );
}

/** Every index of `needle` in `text`. */
function indicesOf(text: string, needle: string): readonly number[] {
    const found: number[] = [];

    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
        found.push(at);
    }

    return found;
}

/**
 * Replace the text between a region's markers, keeping every byte outside them.
 *
 * @param document - The whole document.
 * @param name - The region's name.
 * @param body - The new text of the region.
 * @returns The document with the region replaced.
 * @throws DocgenError when the region's markers are missing, repeated, or out of order. Returning the document
 *   unchanged instead would let a deleted marker turn the staleness guard into a check that always passes.
 */
export function spliceRegion(document: string, name: string, body: string): string {
    const starts = indicesOf(document, startMarker(name));
    const ends = indicesOf(document, endMarker(name));
    const [start] = starts;
    const [end] = ends;

    if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || end < start) {
        throw new DocgenError(
            `${BUILD_SPEC_PATH}: expected one "${startMarker(name)}" followed by one "${endMarker(name)}", found ` +
                `${starts.length} start and ${ends.length} end markers.`,
        );
    }

    return `${document.slice(0, start + startMarker(name).length)}\n\n${body}\n\n${document.slice(end)}`;
}

/**
 * The build spec as it must be committed: both regions rendered from the real tokens, then Prettier-formatted with the
 * repository's own configuration, so the result passes `format:check` and the staleness guard at once.
 *
 * @param repoRoot - Absolute repository root.
 * @returns The document text.
 * @sideEffect Reads the spec and the Prettier configuration.
 */
export async function buildSpecDocument(repoRoot: string): Promise<string> {
    const path = join(repoRoot, BUILD_SPEC_PATH);
    const current = await readFile(path, 'utf8');
    const spliced = spliceRegion(
        spliceRegion(current, 'colorRoles', colorRoleTable(role, roleDark, palette)),
        'typeRoles',
        typeRoleTable(typeRole, fontFamily, fontWeight),
    );

    return format(spliced, { ...(await resolveConfig(path)), filepath: path });
}
