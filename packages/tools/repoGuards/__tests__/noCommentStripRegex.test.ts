// @vitest-environment node
/**
 * Repo-wide guard: **no source file strips comments with a regex** — `sourceComments.ts` is the one owner of
 * "this text without its comments" (code-quality finding Q1).
 *
 * ⛔ WHY IT IS A GUARD AND NOT A CONVENTION. A guard whose PASS is "no match found" reads its subject through a
 * stripper, and the regex pair (`/\/\*[\s\S]*?\*\//` then `/\/\/.*$/m`) removes too much: everything after the
 * `//` of an `'https://…'` string, and a `/*` inside a regex literal opens a "comment" that eats real code. Twenty-two
 * guards each wrote their own copy, because nothing said there was an owner. Measured on the tree this replaced: the
 * pair erased a real test title in `recipe-workers`' `accountErasureWorker.test.ts`.
 *
 * The detector reads the TypeScript AST rather than grepping the text, so a regex that is only MENTIONED (in a
 * comment or a string, as this file's own fixtures do) is not a regex literal and is not flagged.
 *
 * @pattern Fitness Function over the source of every test and script
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles } from './serviceSources.js';

const REPO_ROOT = join(import.meta.dirname, '../../../..');

/** A regex that matches a block comment: an escaped `/*` followed by a catch-all class or a dot. */
const BLOCK_COMMENT_MATCHER = /\\\/\\\*(?:\[\\s\\S\]|\[\^\]|\.)/u;

/** A regex that matches a line comment: an escaped `//` followed by a run to the end of the line. */
const LINE_COMMENT_MATCHER = /\\\/\\\/(?:\.\*|\[\^\\n\]\*)/u;

/**
 * The files allowed to hold a comment-stripping regex, with the reason. `sourceComments.test.ts` keeps the old pair
 * as the CONTROL its fixture table proves wrong; nothing else may.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
    [
        'packages/tools/repoGuards/__tests__/sourceComments.test.ts',
        'holds the old regex pair as the control every fixture row is asserted wrong against',
    ],
]);

/**
 * Every regex literal in a source that is used to strip comments: an argument to `.replace` or `.replaceAll` whose
 * pattern matches a block comment or a line comment.
 *
 * @param path - The file's path, which selects the parser mode.
 * @param text - Its source.
 * @returns One `line: pattern` entry per offence. Pure.
 */
export function commentStrippingRegexes(path: string, text: string): readonly string[] {
    const kind = /\.tsx$/u.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    const offences: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ['replace', 'replaceAll'].includes(node.expression.name.text)
        ) {
            const pattern = node.arguments[0];

            if (
                pattern !== undefined &&
                ts.isRegularExpressionLiteral(pattern) &&
                (BLOCK_COMMENT_MATCHER.test(pattern.text) || LINE_COMMENT_MATCHER.test(pattern.text))
            ) {
                const { line } = file.getLineAndCharacterOfPosition(pattern.getStart(file));

                offences.push(`${path}:${line + 1}: ${pattern.text}`);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offences;
}

describe('the comment-stripping regex detector (fixtures over the shapes the tree held)', () => {
    it.each([
        ['the block-then-line pair', "text.replace(/\\/\\*[\\s\\S]*?\\*\\//gu, '').replace(/\\/\\/.*$/gmu, '')", 2],
        ['a line matcher with an explicit class', "text.replace(/\\/\\/[^\\n]*/gu, '')", 1],
        ['a replacer callback', "text.replace(/\\/\\*[\\s\\S]*?\\*\\//gu, (b) => ' '.repeat(b.length))", 1],
        ['replaceAll', "text.replaceAll(/\\/\\/.*/gu, '')", 1],
    ])('flags %s', (_name, source, count) => {
        expect(commentStrippingRegexes('a.ts', source)).toHaveLength(count);
    });

    it.each([
        ['a docblock marker strip', "line.replace(/^\\/\\*\\*+/u, '')"],
        ['a path glob strip', "arn.replace(/\\/\\*$/u, '')"],
        ['a regex only MENTIONED in a string', 'const s = \'text.replace(/\\\\/\\\\/.*/gu, "")\';'],
        ['a regex only mentioned in a comment', "// text.replace(/\\/\\/.*/gu, '')\nconst a = 1;"],
        ['a match, not a replace', 'text.match(/\\/\\/.*/u)'],
    ])('does not flag %s', (_name, source) => {
        expect(commentStrippingRegexes('a.ts', source)).toEqual([]);
    });
});

describe('no comment-stripping regex outside sourceComments', () => {
    const files = presentFiles(['packages', 'shared', 'scripts']).filter(
        (file) => /\.(?:[cm]?ts|tsx|mjs)$/u.test(file) && !file.endsWith('.d.ts') && !ALLOWED.has(file),
    );

    it('is not vacuous — it reads the files the guards live in', () => {
        expect(files.length).toBeGreaterThan(1_500);
        expect(files).toContain('packages/tools/repoGuards/__tests__/sourceComments.ts');
    });

    it('⛔ finds none — read comments through withoutTsComments / withoutSqlComments / withoutComments', () => {
        const offences = files.flatMap((file) =>
            commentStrippingRegexes(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
        );

        expect(offences, offences.join('\n')).toEqual([]);
    });
});
