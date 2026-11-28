/**
 * The detector behind `recipeReadRulePredicate.test.ts` (ADR-0105): every place a recipe-service or recipe-workers source file
 * COMPARES a recipe's visibility, or fills the read rule's hold with a literal. Pure over source text.
 *
 * It reads the AST without a type checker (the mechanism of `serviceSecurityInvariants.test.ts`), so it cannot tell a recipe's
 * `.visibility` from a collection's: every comparison of a `visibility` name fires, and the guard allowlists files and holds the
 * count of each allowlisted SITE exactly. A site is `<file>#<enclosing function>`.
 *
 * What fires: `===`, `!==`, `==`, `!=` between a visibility name and `'public'`, `'private'`, `X.PUBLIC`, `X.PRIVATE` or a
 * constant named for them; a `switch` over a visibility name; Drizzle `eq`, `ne`, `inArray` and `notInArray` whose first
 * argument is a visibility name; a template literal (or a SQL-looking string) with `visibility` followed by `=`, `<>`, `!=`,
 * `IN`, `NOT IN`, `= ANY` or `IS [NOT] DISTINCT FROM`; a `${x.visibility}` interpolation; and a boolean literal given to
 * `heldFromReaders`.
 *
 * Limit, stated: a visibility copied to another name first (`const v = row.visibility; v === 'public'`) is not seen, and a read
 * with no visibility predicate at all cannot be seen by any text rule. The truth-table e2e per path covers those.
 */
import ts from 'typescript';

import { moduleSpecifiers, visit } from './serviceSources.js';

/** Parsed WITH parent pointers: a site's enclosing function is found by walking up. */
function parseWithParents(file: string, contents: string): ts.SourceFile {
    return ts.createSourceFile(file, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** One finding: the site it is in, and what kind of comparison. */
export interface VisibilitySite {
    readonly site: string;
    readonly form: string;
}

const DRIZZLE_COMPARISONS = new Set(['eq', 'ne', 'inArray', 'notInArray']);
const VISIBILITY_VALUE = /^(?:public|private)$/iu;
const CONSTANT_NAMED_FOR_VALUE = /(?:^|_)(?:PUBLIC|PRIVATE)$|^(?:PUBLIC|PRIVATE)(?:_|$)/u;
const SQL_COMPARISON = /\bvisibility\b\s*(?:<>|!=|=|\bnot\s+in\b|\bin\s*\(|\bis\s+(?:not\s+)?distinct\s+from\b)/iu;
const SQL_WORD = /\b(?:select|update|delete|where|from|set)\b/iu;

/** Whether a node names a visibility: `x.visibility`, `x['visibility']` or a bare `visibility`. */
function isVisibilityName(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) {
        return node.text === 'visibility';
    }

    if (ts.isPropertyAccessExpression(node)) {
        return node.name.text === 'visibility';
    }

    return ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text === 'visibility'
        : false;
}

/** Whether a node is a value a visibility is compared with. */
function isVisibilityValue(node: ts.Node): boolean {
    if (ts.isStringLiteralLike(node)) {
        return VISIBILITY_VALUE.test(node.text);
    }

    if (ts.isPropertyAccessExpression(node)) {
        return CONSTANT_NAMED_FOR_VALUE.test(node.name.text);
    }

    return ts.isIdentifier(node) && CONSTANT_NAMED_FOR_VALUE.test(node.text);
}

/** The name of the function, method or class member a node sits in, `<top>` at module level. Pure. */
function enclosingName(node: ts.Node): string {
    const parts: string[] = [];

    for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
        if (
            (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isClassDeclaration(current)) &&
            current.name !== undefined
        ) {
            parts.unshift(current.name.getText());
        } else if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
            const init = current.initializer;

            if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
                parts.unshift(current.name.text);
            }
        } else if (ts.isPropertyAssignment(current) && ts.isIdentifier(current.name)) {
            const init = current.initializer;

            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
                parts.unshift(current.name.text);
            }
        }
    }

    return parts.length === 0 ? '<top>' : parts.join('.');
}

/** The text a template literal part or a string contributes to SQL. */
function sqlTextOf(node: ts.Node): string | undefined {
    if (
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
    ) {
        return node.text;
    }

    return ts.isStringLiteral(node) && SQL_WORD.test(node.text) ? node.text : undefined;
}

/**
 * Every visibility comparison and every literal `heldFromReaders` in one file.
 *
 * @param file - Repo-relative path, used for the site key.
 * @param contents - The file's source text.
 * @returns The findings, in source order. Pure.
 */
export function visibilitySitesOf(file: string, contents: string): readonly VisibilitySite[] {
    const sites: VisibilitySite[] = [];
    const add = (node: ts.Node, form: string): void => {
        sites.push({ site: `${file}#${enclosingName(node)}`, form });
    };

    visit(parseWithParents(file, contents), (node) => {
        if (ts.isBinaryExpression(node)) {
            const op = node.operatorToken.kind;
            const isEquality =
                op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
                op === ts.SyntaxKind.EqualsEqualsToken ||
                op === ts.SyntaxKind.ExclamationEqualsToken;

            if (
                isEquality &&
                ((isVisibilityName(node.left) && isVisibilityValue(node.right)) ||
                    (isVisibilityName(node.right) && isVisibilityValue(node.left)))
            ) {
                add(node, 'comparison');
            }
        }

        if (ts.isSwitchStatement(node) && isVisibilityName(node.expression)) {
            add(node, 'switch');
        }

        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            DRIZZLE_COMPARISONS.has(node.expression.text) &&
            node.arguments[0] !== undefined &&
            isVisibilityName(node.arguments[0])
        ) {
            add(node, `drizzle ${node.expression.text}`);
        }

        const text = sqlTextOf(node);

        if (text !== undefined && SQL_COMPARISON.test(text)) {
            add(node, 'sql text');
        }

        if (ts.isTemplateSpan(node) && isVisibilityName(node.expression)) {
            add(node, 'sql interpolation');
        }

        if (
            ts.isPropertyAssignment(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'heldFromReaders' &&
            (node.initializer.kind === ts.SyntaxKind.TrueKeyword ||
                node.initializer.kind === ts.SyntaxKind.FalseKeyword)
        ) {
            add(node, 'heldFromReaders literal');
        }
    });

    return sites;
}

/**
 * Every module specifier a file imports, exports from or requires that reaches a `__fixtures__` directory. Pure.
 *
 * @param file - Repo-relative path.
 * @param contents - The file's source text.
 */
export function fixtureImportsOf(file: string, contents: string): readonly string[] {
    return moduleSpecifiers({ file, contents }).filter((specifier) => /(?:^|\/)__fixtures__(?:\/|$)/u.test(specifier));
}
