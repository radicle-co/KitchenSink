/**
 * @module @kitchensink/docgen-components/docblock — reads a file's leading docblock and splits it into prose
 * and tags. Pure apart from the source text it is handed.
 *
 * `react-docgen-typescript` reports the JSDoc attached to a component DECLARATION and nothing else. In this
 * repository the substantive documentation — what the unit is, which pattern it implements, why the two
 * platform leaves differ — lives in the module-level `@module` block at the top of the file, which that
 * library never sees. This module recovers it.
 *
 * ## Why the split is done here rather than by TypeScript or by `comment-parser`
 *
 * ⛔ `ts.getJSDocTags` was tried FIRST and is measurably WRONG for this repository. The house convention opens
 * a file with `@module @commise/ui/button — the web design-system Button.`, and every standard JSDoc parser
 * — TypeScript's included, `comment-parser` included, because both implement the same grammar — reads the
 * SECOND `@` as a new tag. Measured on `Button.tsx`, TypeScript returns the tags `['module', 'commise']` and
 * the module's entire summary ends up as the text of a tag called `@commise`. Against 343 component leaves
 * that silently emptied 213 module docblocks.
 *
 * The repository's convention is what it is, and a generator that reads it wrongly is a generator that
 * reports "undocumented" about documented code. So the split is done here, in ~30 lines of pure line
 * handling, with the `@module` header treated as the summary line it is written as. No library implements
 * this dialect, so there is nothing to reach for.
 */
import ts from 'typescript';

import type { DocTag } from './model.js';

/** A docblock split into the prose a reader reads and the tags a rule reads. */
export interface Docblock {
    /** Description text, comment markers removed. Empty when the block carries none. */
    readonly text: string;
    /** Tags in source order. */
    readonly tags: readonly DocTag[];
}

/** The empty docblock — one value, so "absent" is never spelled two ways. */
const EMPTY: Docblock = { text: '', tags: [] };

/**
 * A line that opens a JSDoc tag.
 *
 * ⚠️ The remainder is `[\s\S]*`, not `.*`. The lines this runs over are already split on their terminators,
 * so the two accept the same text — but `.` refuses `\r` (and U+2028/9), and an anchored `$` after a refused
 * character sends the engine back through every split of the tag name's `[\w-]*` and the remainder: a tag
 * name followed by 80 000 dashes and a `\r` took 1.1 s (CodeQL `js/polynomial-redos`, alert 334), and on a
 * CRLF file the SAME failure read every tag as prose. A remainder that can match anything never backtracks.
 */
const TAG_LINE = /^@([A-Za-z][\w-]*)[ \t]?([\s\S]*)$/;

/** The `/**` opener, anchored — one pass. */
const OPENER = /^\/\*\*+/;

/** A line terminator, either convention, so a CRLF file's lines carry no `\r` into the tag matcher. */
const LINE_TERMINATOR = /\r?\n/;

/**
 * Strip the `*\/` closer and any run of stars leading into it.
 *
 * A loop rather than `\*+\/$`: that regex is not anchored at the START, so on a block whose tail is a long run
 * of stars that is NOT a closer the engine restarts at every star and scans to the end each time — 1.0 s on
 * 80 000 stars, ×4 per doubling (CodeQL `js/polynomial-redos`, alert 333). One backwards scan is linear.
 *
 * @param raw - The block with its opener already removed.
 * @returns The block without its closer, or unchanged when it does not end in one. Pure.
 */
function stripCloser(raw: string): string {
    if (!raw.endsWith('/')) {
        return raw;
    }

    let end = raw.length - 1;

    while (end > 0 && raw[end - 1] === '*') {
        end -= 1;
    }

    // A bare `/` with no star before it is not a closer — the regex this replaces required at least one.
    return end === raw.length - 1 ? raw : raw.slice(0, end);
}

/**
 * Split a raw `/** … *\/` block into prose and tags.
 *
 * The `@module` header is the ONE special case, and it is special because the convention makes it one: it
 * opens the block, its remainder is the module's own summary sentence, and that remainder legitimately begins
 * with an `@`-prefixed package name. It is recorded as a tag AND kept as the first line of the prose.
 *
 * @param raw - The verbatim comment text including its delimiters.
 * @returns The parsed block.
 */
export function parseDocblock(raw: string): Docblock {
    const lines = stripCloser(raw.replace(OPENER, ''))
        .split(LINE_TERMINATOR)
        .map((line) => line.replace(/^\s*\* ?/, ''));

    const description: string[] = [];
    const tags: { name: string; lines: string[] }[] = [];
    let openTag: { name: string; lines: string[] } | undefined;
    let started = false;

    for (const line of lines) {
        const match = TAG_LINE.exec(line);

        if (match === null) {
            (openTag?.lines ?? description).push(line);
            continue;
        }

        const [, name = '', rest = ''] = match;

        if (name === 'module' && !started) {
            tags.push({ name, lines: [rest] });
            description.push(rest);
            openTag = undefined;
            started = true;
            continue;
        }

        started = true;
        openTag = { name, lines: [rest] };
        tags.push(openTag);
    }

    return {
        text: description.join('\n').trim(),
        tags: tags.map((tag) => ({ name: tag.name, text: tag.lines.join('\n').trim() })),
    };
}

/**
 * The statements a file's module docblock can attach to.
 *
 * TWO candidates, in order, and both are load-bearing:
 *
 *  1. A `'use client'` DIRECTIVE, when the file opens with one. Both orders occur in this repository —
 *     `AccountEraseForm.tsx` writes the directive first and the docblock after it, `RecipeHomeWidget.tsx`
 *     writes the docblock first — and reading only one of them silently emptied the other's documentation.
 *  2. The first IMPORT declaration.
 *
 * The candidate must be a directive or an import. If the first real statement is the component itself, its
 * JSDoc is the COMPONENT's doc, and claiming it as the module doc too would duplicate it into two fields
 * that disagree the moment somebody adds an import. Next.js route segments are exactly that shape, and their
 * absence of a module docblock is a true finding rather than an extraction failure.
 *
 * @param source - The parsed source file.
 * @returns The candidate hosts, in the order they should be tried.
 */
function moduleDocHosts(source: ts.SourceFile): readonly ts.Statement[] {
    const hosts: ts.Statement[] = [];

    for (const statement of source.statements) {
        if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
            hosts.push(statement);
            continue;
        }

        if (ts.isImportDeclaration(statement)) {
            hosts.push(statement);
        }

        return hosts;
    }

    return hosts;
}

/**
 * The verbatim leading JSDoc block of a node — the LAST one when a node carries several, because that is the
 * block a reader sees immediately above it.
 *
 * @param source - The source file the node belongs to.
 * @param node - The node to read.
 * @returns The comment text including delimiters, or `undefined`.
 */
function leadingJsdocText(source: ts.SourceFile, node: ts.Node): string | undefined {
    const fullText = source.getFullText();
    const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];

    return ranges
        .map((range) => fullText.slice(range.pos, range.end))
        .filter((text) => text.startsWith('/**'))
        .at(-1);
}

/**
 * Read the docblock immediately above a node.
 *
 * @param source - The source file the node belongs to.
 * @param node - The declaration to read.
 * @returns The parsed block, empty when the node carries none.
 */
export function readLeadingDocblock(source: ts.SourceFile, node: ts.Node): Docblock {
    const raw = leadingJsdocText(source, node);

    return raw === undefined ? EMPTY : parseDocblock(raw);
}

/**
 * Read a file's module-level docblock.
 *
 * @param source - The parsed source file.
 * @returns The docblock, or the empty docblock when the file has none.
 */
export function readModuleDocblock(source: ts.SourceFile): Docblock {
    for (const host of moduleDocHosts(source)) {
        const docblock = readLeadingDocblock(source, host);

        if (docblock.text !== '' || docblock.tags.length > 0) {
            return docblock;
        }
    }

    return EMPTY;
}

/**
 * The docblock text above every top-level `export const` / `export function` in a module.
 *
 * The design system's substantive prose sits on the EXPORT, not on the file — `colors.ts` puts the two
 * measured WCAG rules the palette obeys directly above `export const palette`. A style guide that quoted the
 * module header instead would quote an import statement's comment and lose the whole explanation.
 *
 * @param source - The parsed source file.
 * @returns Export name to docblock text, for exports that carry one.
 */
export function readDeclarationDocs(source: ts.SourceFile): ReadonlyMap<string, string> {
    const docs = new Map<string, string>();

    for (const statement of source.statements) {
        const { text } = readLeadingDocblock(source, statement);

        if (text === '') {
            continue;
        }

        if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
            docs.set(statement.name.text, text);
        } else if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    docs.set(declaration.name.text, text);
                }
            }
        }
    }

    return docs;
}
