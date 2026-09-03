/**
 * The DOCBLOCK reader. Every case here is one that was observed to go wrong against the real tree, not an
 * invented edge: the `@module @commise/…` header (which every standard JSDoc grammar mis-parses), the two
 * orders a `'use client'` file writes its docblock in, and a file whose only docblock belongs to the
 * component rather than the module.
 */
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parseDocblock, readDeclarationDocs, readModuleDocblock } from '../docblock.js';

/** Parse a source string the way the generator parses a file. */
function sourceOf(text: string): ts.SourceFile {
    return ts.createSourceFile(join('fake', 'Component.tsx'), text, ts.ScriptTarget.Latest, true);
}

describe('parseDocblock', () => {
    // THE regression. TypeScript reports the tags ['module', 'commise'] for this block and puts the whole
    // summary in a tag called `@commise`; against the real tree that emptied 213 of 343 module docblocks.
    it('keeps the summary of a `@module @scope/name` header instead of reading the scope as a second tag', () => {
        const block = parseDocblock(`/**
 * @module @commise/ui/button — the web design-system Button.
 *
 * A labelled action control.
 */`);

        expect(block.text).toBe('@commise/ui/button — the web design-system Button.\n\nA labelled action control.');
        expect(block.tags).toEqual([{ name: 'module', text: '@commise/ui/button — the web design-system Button.' }]);
    });

    it('separates ordinary tags from the prose and keeps their multi-line text', () => {
        const block = parseDocblock(`/**
 * Does a thing.
 *
 * @pattern Adapter
 * @sideEffect Reads the filesystem
 *   and writes nothing.
 */`);

        expect(block.text).toBe('Does a thing.');
        expect(block.tags).toEqual([
            { name: 'pattern', text: 'Adapter' },
            { name: 'sideEffect', text: 'Reads the filesystem\n  and writes nothing.' },
        ]);
    });

    it('returns empty prose and no tags for a block that carries neither', () => {
        expect(parseDocblock('/** */')).toEqual({ text: '', tags: [] });
    });
});

describe('readModuleDocblock', () => {
    it('reads the block above the first import', () => {
        const source = sourceOf(`/**\n * @module thing — a thing.\n */\nimport type { FC } from 'react';\n`);

        expect(readModuleDocblock(source).text).toBe('thing — a thing.');
    });

    // Both orders occur in this repository, and reading only one of them silently empties the other's docs.
    it('reads the block whether it sits BEFORE or AFTER a `use client` directive', () => {
        const before = sourceOf(`/**\n * @module a — before.\n */\n'use client';\nimport type { FC } from 'react';\n`);
        const after = sourceOf(`'use client';\n\n/**\n * @module a — after.\n */\nimport type { FC } from 'react';\n`);

        expect(before.statements.length).toBeGreaterThan(1);
        expect(readModuleDocblock(before).text).toBe('a — before.');
        expect(readModuleDocblock(after).text).toBe('a — after.');
    });

    // A route segment puts its only docblock on the component. Claiming it as the module doc too would
    // duplicate one sentence into two fields that disagree the moment somebody adds an import above it.
    it('does NOT claim a component docblock as the module docblock', () => {
        const source = sourceOf(
            `/**\n * The home route.\n */\nexport default function HomePage() {\n  return null;\n}\n`,
        );

        expect(readModuleDocblock(source)).toEqual({ text: '', tags: [] });
    });

    it('is empty for a file with no docblock at all', () => {
        expect(readModuleDocblock(sourceOf(`import type { FC } from 'react';\n`))).toEqual({ text: '', tags: [] });
    });
});

describe('readDeclarationDocs', () => {
    // The design system puts its substantive prose on the EXPORT, not on the file — the palette's two
    // measured WCAG rules sit above `export const palette`.
    it('reads the docblock above each exported const, keyed by its name', () => {
        const source = sourceOf(
            `import { x } from './x.js';\n\n/** The brand palette. */\nexport const palette = { a: 1 };\n\n/** The scale. */\nexport const space = { b: 2 };\n`,
        );
        const docs = readDeclarationDocs(source);

        expect(docs.get('palette')).toBe('The brand palette.');
        expect(docs.get('space')).toBe('The scale.');
        expect(docs.has('x')).toBe(false);
    });
});
