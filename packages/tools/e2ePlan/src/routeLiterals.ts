/**
 * Reads the paths a Playwright spec (or a helper it imports) navigates to, from its source.
 *
 * Uses the TypeScript compiler's parser, not a regular expression: a regex cannot tell `page.goto(route('/a'))` from
 * `page.route('**' + '/api', ...)` (network interception), a string in a comment, or a template with a nested call.
 */
import ts from 'typescript';

export interface RouteLiterals {
    /** Distinct paths, locale-free, without query or fragment. A substitution in a template reads `__dynamic__`. */
    readonly paths: readonly string[];
    /** A navigation whose path the source does not state (a variable, a property). */
    readonly dynamic: boolean;
}

/** The placeholder a template substitution becomes: a plain segment, so only `[x]` routes match it. */
const DYNAMIC_SEGMENT = '__dynamic__';

const ROUTE_HELPERS = new Set(['route', 'pseudoRoute']);

const isCallTo = (node: ts.Node, names: ReadonlySet<string>): node is ts.CallExpression =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text);

const isGoto = (node: ts.Node): node is ts.CallExpression =>
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'goto';

const containsRouteCall = (node: ts.Node): boolean => {
    let found = false;

    const visit = (child: ts.Node): void => {
        found ||= isCallTo(child, ROUTE_HELPERS);
        ts.forEachChild(child, visit);
    };

    visit(node);

    return found;
};

/** The path text an argument states: undefined when it states none (dynamic). */
function stated(argument: ts.Expression | undefined): string | undefined {
    if (argument === undefined) {
        return undefined;
    }

    if (ts.isStringLiteralLike(argument)) {
        return argument.text;
    }

    if (ts.isTemplateExpression(argument)) {
        return (
            argument.head.text + argument.templateSpans.map((span) => `${DYNAMIC_SEGMENT}${span.literal.text}`).join('')
        );
    }

    return undefined;
}

const clean = (path: string): string => path.split(/[?#]/u)[0] ?? '';

const URL_ASSERTIONS = new Set(['toHaveURL', 'waitForURL']);

/**
 * The path-shaped runs of a URL assertion's argument: a string, a template, a regular expression literal, or
 * `new RegExp(string-or-template)`. A regular expression is not a path, so only runs of `/segment` characters are
 * kept: `/recipes/[0-9a-f-]{36}/edit` yields `/recipes` and `/edit`, never a guessed whole. This is a lower bound.
 */
function assertedPaths(argument: ts.Expression | undefined): readonly string[] {
    if (argument === undefined) {
        return [];
    }

    let text: string | undefined;

    if (ts.isRegularExpressionLiteral(argument)) {
        text = argument.text.slice(1, argument.text.lastIndexOf('/'));
    } else if (
        ts.isNewExpression(argument) &&
        ts.isIdentifier(argument.expression) &&
        argument.expression.text === 'RegExp'
    ) {
        text = stated(argument.arguments?.[0]);
    } else {
        text = stated(argument);
    }

    return [...(text ?? '').replace(/\\\//gu, '/').matchAll(/(?:\/[A-Za-z0-9_.~-]+)+/gu)].map((run) => run[0]);
}

/**
 * Collects the navigations in a source file.
 *
 * @param sourceText - The file's text.
 * @param fileName - The file's name, which picks the grammar (`.tsx` or `.ts`).
 * @returns The paths it states and whether any navigation was not statable.
 */
export function routeLiterals(sourceText: string, fileName: string): RouteLiterals {
    const file = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
    const paths = new Set<string>();
    let dynamic = false;

    const note = (argument: ts.Expression | undefined): void => {
        const text = stated(argument);

        if (text === undefined) {
            dynamic = true;
        } else if (text.startsWith('/')) {
            paths.add(clean(text));
        }
    };

    const visit = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            URL_ASSERTIONS.has(node.expression.name.text)
        ) {
            assertedPaths(node.arguments[0]).forEach((path) => paths.add(path));
        } else if (isCallTo(node, ROUTE_HELPERS)) {
            note(node.arguments[0]);
        } else if (isGoto(node)) {
            const target = node.arguments[0];

            // `goto(route(...))` and `goto(`${route(...)}?q`)` are read through the route() call itself.
            if (target !== undefined && !containsRouteCall(target)) {
                const text = stated(target);

                if (text === undefined) {
                    dynamic = true;
                } else if (text.startsWith('/')) {
                    paths.add(clean(text));
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return { paths: [...paths], dynamic };
}
