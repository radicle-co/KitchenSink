/**
 * APP-SOURCE DISCOVERY and string-node reading for the guards over `packages/apps`.
 *
 * ## Why this is a module and not copied into each guard
 *
 * `pressWashLiterals`, `ringOffsetColour` and `typeScaleLiterals` each carried their own "list the app modules" and "visit
 * every string-like node", and `offScaleRadius` a third reading with its own directory walk (which also read `ui/test/stubs`, that the others
 * excluded). They had already drifted (one
 * excluded `/ui/src/tokens/`, one did not; one listed the index, one the tree). A guard that silently stops reading a
 * file passes vacuously forever, so the discovery and the reading are written once, here, beside `serviceSources.ts`,
 * and a guard supplies only its rule. Mechanism lives here; invariants live in the guards.
 *
 * Reading is by the TypeScript PARSER, never a regex over text: a comment that names a forbidden class is not a use, and
 * a URL in a string cannot open a comment that swallows the code after it.
 */
import ts from 'typescript';

import { presentFiles } from './serviceSources.js';

/** The directories and file shapes no app guard reads: tests, fixtures, build output, native projects. */
export const APP_SOURCE_EXCLUDED =
    /(?:^|\/)(?:__tests__|__fixtures__|tests|test|node_modules|dist|\.expo|android|ios|\.next|\.turbo|coverage)\/|\.(?:test|spec)\.tsx?$/u;

/**
 * The app modules the guards read: TypeScript under `packages/apps/**`, present in the working tree (committed or not,
 * so a file being written is already covered), minus {@link APP_SOURCE_EXCLUDED} and declaration files.
 *
 * @param pathspecs - Git pathspecs to read. Defaults to every app.
 * @param excluded - What to leave out. Defaults to {@link APP_SOURCE_EXCLUDED}.
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git and stats the working tree.
 */
export function appSourceModules(
    pathspecs: readonly string[] = ['packages/apps'],
    excluded: RegExp = APP_SOURCE_EXCLUDED,
): readonly string[] {
    return presentFiles(pathspecs)
        .filter((file) => /\.tsx?$/u.test(file) && !file.endsWith('.d.ts') && !excluded.test(file))
        .sort();
}

/** One string-like node: its text, where it is, and whether it runs into a template substitution. */
export interface StringLikeText {
    /** The 1-based line of the node. */
    readonly line: number;
    /** The node's text (a template fragment's cooked text). */
    readonly text: string;
    /** `true` for a template head or middle: its last token may be unfinished (`hover:bg-${tone}`). */
    readonly openEnded: boolean;
    /** The node, for a guard that needs its parent or its attribute. */
    readonly node: ts.Node;
}

/**
 * Parse a module.
 *
 * @param fileName - The module's name, which decides whether it is parsed as TSX.
 * @param source - Its text.
 */
export function parseModule(fileName: string, source: string): ts.SourceFile {
    return ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$/u.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
}

/**
 * Every string-like node of a module, in source order: string literals, template fragments (head, middle, tail and the
 * no-substitution form) and JSX text. A comment is none of these.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 * @returns One entry per node.
 */
export function stringLikeTexts(fileName: string, source: string): readonly StringLikeText[] {
    const file = parseModule(fileName, source);
    const found: StringLikeText[] = [];

    const visit = (node: ts.Node): void => {
        const stringLike =
            ts.isStringLiteralLike(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node) ||
            ts.isJsxText(node);

        if (stringLike) {
            found.push({
                line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
                text: node.text,
                openEnded: ts.isTemplateHead(node) || ts.isTemplateMiddle(node),
                node,
            });
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

/**
 * The class tokens of one fragment. A fragment that runs into a `${}` drops its unfinished last token (`hover:bg-` is
 * not yet a class), so a guard never judges half a name. Pure.
 *
 * @param text - The fragment.
 * @param openEnded - Whether it runs into a substitution.
 */
export function classTokensOf(text: string, openEnded: boolean): readonly string[] {
    const tokens = text.split(/\s+/u).filter((token) => token !== '');

    return openEnded && !/\s$/u.test(text) ? tokens.slice(0, -1) : tokens;
}
