/**
 * Mechanism for the recipe-service DAL-doubles guard (`mockedRecipeDalDoubles.test.ts`): which files it scans and what
 * it reads in them. The rules and their reasons live in the guard; everything here is a pure read of the TypeScript
 * parser's tree, so a comment that names a token is not a use of it.
 */
import ts from 'typescript';

import { lineOf } from './appSources.js';
import { parse, presentFiles, repoRoot, visit } from './serviceSources.js';

const SERVICE = 'packages/services/recipe-service';

/** The member the locked facts are read through, and the writers that give a mock its answer. */
const MEMBER = 'lockSlotFacts';
const ANSWER_WRITERS: ReadonlySet<string> = new Set([
    'mockResolvedValue',
    'mockResolvedValueOnce',
    'mockReturnValue',
    'mockReturnValueOnce',
    'mockImplementation',
    'mockImplementationOnce',
]);
/** The projection a double's answer must be built by. */
const PROJECTION = 'lockedFactsOf';

const parseFile = (contents: string, file: string): ts.SourceFile => parse({ file, contents });

const lineText = (file: ts.SourceFile, node: ts.Node): string => `line ${String(lineOf(file, node))}`;

/**
 * Every test file of recipe-service: a tracked or new TypeScript file under a `__tests__` folder. No name filter, so a
 * file cannot leave the scan by not naming a token.
 *
 * @param root - The repository to list; the real tree unless a test supplies a throwaway one.
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to git and stats the working tree.
 */
export function recipeServiceTestFiles(root: string = repoRoot): readonly string[] {
    return presentFiles([`${SERVICE}/**/*.ts`], root)
        .filter((file) => file.includes('/__tests__/'))
        .sort((a, b) => a.localeCompare(b));
}

/**
 * Every place a file spells the `RECIPES_DAL` token: an identifier (import, alias, namespace member, use) or a string.
 *
 * @param source - The file's text.
 * @param fileName - Its name.
 * @returns One entry per use, with its line.
 */
export function recipesDalTokenUses(source: string, fileName: string): readonly string[] {
    const file = parseFile(source, fileName);
    const uses: string[] = [];

    visit(file, (node) => {
        const spelled =
            (ts.isIdentifier(node) && node.text === 'RECIPES_DAL') ||
            ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === 'RECIPES_DAL');

        if (spelled) {
            uses.push(lineText(file, node));
        }
    });

    return uses;
}

/** Strip the wrappers that do not change which value an expression names. */
function unwrap(expression: ts.Expression): ts.Expression {
    return ts.isParenthesizedExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isTypeAssertionExpression(expression)
        ? unwrap(expression.expression)
        : expression;
}

/** True for a member name spelled `lockSlotFacts`, bare or quoted. */
function isMemberName(name: ts.PropertyName): boolean {
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === MEMBER;
}

/** True when the expression names the `lockSlotFacts` mock: a variable, a member, or `vi.mocked(...)` of either. */
function namesMember(expression: ts.Expression): boolean {
    const inner = unwrap(expression);

    if (ts.isIdentifier(inner)) {
        return inner.text === MEMBER;
    }

    if (ts.isPropertyAccessExpression(inner)) {
        return inner.name.text === MEMBER;
    }

    if (ts.isElementAccessExpression(inner)) {
        return ts.isStringLiteralLike(inner.argumentExpression) && inner.argumentExpression.text === MEMBER;
    }

    // `vi.spyOn(dal, 'lockSlotFacts')`: the spy answers for the member named by its second argument.
    if (
        ts.isCallExpression(inner) &&
        ts.isPropertyAccessExpression(inner.expression) &&
        inner.expression.name.text === 'spyOn'
    ) {
        const [, name] = inner.arguments;

        return inner.arguments.length > 1 && ts.isStringLiteralLike(name) && name.text === MEMBER;
    }

    // `vi.mocked(dal.lockSlotFacts)`: the mock helper hands the same function back, typed as a mock.
    return (
        ts.isCallExpression(inner) &&
        ts.isPropertyAccessExpression(inner.expression) &&
        inner.expression.name.text === 'mocked' &&
        inner.arguments.length === 1 &&
        namesMember(inner.arguments[0])
    );
}

/** True for a call whose argument objects are not hand-written facts: the projection, or a fake DAL's own members. */
function isTrusted(node: ts.CallExpression): boolean {
    return (
        ts.isIdentifier(node.expression) &&
        (node.expression.text === PROJECTION || /fakeRecipesDal$/iu.test(node.expression.text))
    );
}

/** Every object literal in `root` that is not inside a trusted call, as a line. */
function looseObjects(file: ts.SourceFile, root: ts.Node): readonly string[] {
    const found: string[] = [];

    const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && isTrusted(node)) {
            return;
        }

        if (ts.isObjectLiteralExpression(node)) {
            found.push(lineText(file, node));
        }

        ts.forEachChild(node, walk);
    };

    walk(root);

    return found;
}

/**
 * Every object literal inside an answer for `lockSlotFacts` that is not built by `lockedFactsOf(...)`. An answer is a
 * property assignment or a variable named `lockSlotFacts`, and the argument of a mock-writer called on it.
 *
 * @param source - The file's text.
 * @param fileName - Its name.
 * @returns One entry per hand-written object, with its line.
 */
export function inlineLockedFacts(source: string, fileName: string): readonly string[] {
    const file = parseFile(source, fileName);
    const found: string[] = [];

    visit(file, (node) => {
        if (ts.isPropertyAssignment(node) && isMemberName(node.name)) {
            found.push(...looseObjects(file, node.initializer));
        } else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && isMemberName(node.name)) {
            found.push(...(node.body ? looseObjects(file, node.body) : []));
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === MEMBER &&
            node.initializer
        ) {
            found.push(...looseObjects(file, node.initializer));
        } else if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ANSWER_WRITERS.has(node.expression.name.text) &&
            namesMember(node.expression.expression)
        ) {
            for (const argument of node.arguments) {
                found.push(...looseObjects(file, argument));
            }
        }
    });

    return [...new Set(found)];
}
