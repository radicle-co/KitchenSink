/**
 * every control whose only content is a glyph, read from the parsed module. `IconButton` owns the look of
 * an icon-only control (one target, one focus ring, one press fill, one dim), so each one built by hand is a copy that
 * can drift. See `iconOnlyControls.test.ts` for the shapes counted and the shapes that are not.
 *
 * A control is an interactive element: an intrinsic `button` or `a`; `Pressable` or a Touchable bound from
 * `react-native` (renamed, or reached through a namespace); a member tag named `Trigger` or `Close`; or any element
 * with an `onClick` or `onPress` attribute. It is icon-only when its one child, after whitespace and empty expressions,
 * is a glyph: the design system's `Icon`, one or two symbol characters, a const that holds a glyph, a conditional of
 * glyphs, a render function that returns one, or an element whose only child is a glyph (up to three deep, which
 * covers the `Frame` and `Circle` wrappers).
 *
 * One exemption: inside the design system (`ui/src`), an element whose `className` reads an identifier imported from
 * `IconButton` or `HeroButton` is built from their recipe, so it is not a copy. Anywhere else the same reference still
 * counts, the rule `NATIVE-STYLE-ADAPTER` follows in `nativeStyling.ts`.
 *
 * @pattern Specification — one predicate over a parsed module, shared by the ratchet and its fixture table
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import { isReactNative, localsOf, valueBindingsOf } from './moduleBindings.js';

/** One control: the line it starts on (1-based) and its opening tag. */
export interface IconOnlyControl {
    readonly line: number;
    readonly text: string;
}

const DESIGN_SYSTEM = 'packages/apps/commise/ui/src/';

const PRESSABLES = ['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback'] as const;

const HANDLER_ATTRIBUTES = new Set(['onClick', 'onPress']);

const MEMBER_CONTROLS = new Set(['Trigger', 'Close']);

/** How many wrappers may sit between a control and its glyph. */
const WRAPPER_DEPTH = 3;

/** The design system's `Icon`: its package export, or a relative import of its leaf. */
const isIconModule = (specifier: string): boolean =>
    specifier === '@commise/ui/icon' || /^\.{1,2}\/(?:.*\/)?icon\/Icon(?:\.native)?\.js$/u.test(specifier);

/** The package exports of the two primitives whose recipe an element in the design system may build from. */
const RECIPE_EXPORT = /^@commise\/ui\/(?:icon-button|hero-button)$/u;

/** Their leaves, by relative import from inside the design system. */
const RECIPE_LEAF = /^\.{1,2}\/(?:.*\/)?(?:iconButton\/IconButton|heroButton\/HeroButton)\.js$/u;

const isRecipeModule = (specifier: string): boolean => RECIPE_EXPORT.test(specifier) || RECIPE_LEAF.test(specifier);

/** One or two characters that are neither letters, digits nor space: "×", "⋯". */
const isSymbol = (text: string): boolean => /^[^\p{L}\p{N}\s]{1,2}$/u.test(text.trim());

/** The expression a block returns when `return` is its only statement. */
const soleReturn = (block: ts.Block): ts.Expression | undefined => {
    const [only] = block.statements;

    return block.statements.length === 1 && only !== undefined && ts.isReturnStatement(only)
        ? only.expression
        : undefined;
};

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/**
 * Every icon-only control in one module. Pure.
 *
 * @param source - The module's text.
 * @param fileName - Its repo-relative path.
 * @returns One entry per control, in source order.
 */
export function iconOnlyControls(source: string, fileName: string): readonly IconOnlyControl[] {
    const file = parseModule(fileName, source);
    const icons = localsOf(valueBindingsOf(file, isIconModule), 'Icon');
    const native = valueBindingsOf(file, isReactNative);
    const pressables = new Set(PRESSABLES.flatMap((name) => [...localsOf(native, name)]));
    const recipes = new Set(
        [...valueBindingsOf(file, isRecipeModule).locals.values()].flatMap((locals) => [...locals]),
    );
    const inDesignSystem = fileName.startsWith(DESIGN_SYSTEM);
    const consts = new Map<string, ts.Expression>();

    const collectConsts = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isVariableDeclarationList(node.parent) &&
            (node.parent.flags & ts.NodeFlags.Const) !== 0
        ) {
            consts.set(node.name.text, node.initializer);
        }

        ts.forEachChild(node, collectConsts);
    };

    collectConsts(file);

    const tagIsInteractive = (tag: ts.JsxTagNameExpression): boolean => {
        if (ts.isIdentifier(tag)) {
            return tag.text === 'button' || tag.text === 'a' || pressables.has(tag.text);
        }

        if (!ts.isPropertyAccessExpression(tag)) {
            return false;
        }

        const namespaced =
            ts.isIdentifier(tag.expression) &&
            native.namespaces.has(tag.expression.text) &&
            (PRESSABLES as readonly string[]).includes(tag.name.text);

        return namespaced || MEMBER_CONTROLS.has(tag.name.text);
    };

    const isInteractive = (opening: Opening): boolean =>
        tagIsInteractive(opening.tagName) ||
        opening.attributes.properties.some(
            (attribute) =>
                ts.isJsxAttribute(attribute) &&
                ts.isIdentifier(attribute.name) &&
                HANDLER_ATTRIBUTES.has(attribute.name.text),
        );

    // The children that carry content: whitespace text and `{}` or `{/* */}` are not.
    const contentOf = (children: ts.NodeArray<ts.JsxChild>): readonly ts.JsxChild[] =>
        children.filter(
            (child) =>
                !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) &&
                !(ts.isJsxExpression(child) && child.expression === undefined),
        );

    const isGlyphExpression = (expression: ts.Expression, depth: number, seen: ReadonlySet<string>): boolean => {
        if (ts.isParenthesizedExpression(expression)) {
            return isGlyphExpression(expression.expression, depth, seen);
        }

        if (ts.isStringLiteralLike(expression)) {
            return isSymbol(expression.text);
        }

        if (ts.isConditionalExpression(expression)) {
            return (
                isGlyphExpression(expression.whenTrue, depth, seen) &&
                isGlyphExpression(expression.whenFalse, depth, seen)
            );
        }

        if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
            const body = ts.isBlock(expression.body) ? soleReturn(expression.body) : expression.body;

            return body !== undefined && isGlyphExpression(body, depth, seen);
        }

        if (ts.isIdentifier(expression)) {
            const held = consts.get(expression.text);

            return (
                held !== undefined &&
                !seen.has(expression.text) &&
                isGlyphExpression(held, depth, new Set([...seen, expression.text]))
            );
        }

        return isGlyphNode(expression, depth, seen);
    };

    function isGlyphNode(node: ts.Node, depth: number, seen: ReadonlySet<string>): boolean {
        if (ts.isJsxText(node)) {
            return isSymbol(node.text);
        }

        if (ts.isJsxExpression(node)) {
            return node.expression !== undefined && isGlyphExpression(node.expression, depth, seen);
        }

        if (ts.isJsxSelfClosingElement(node)) {
            return ts.isIdentifier(node.tagName) && icons.has(node.tagName.text);
        }

        if (ts.isJsxElement(node)) {
            const only = contentOf(node.children);

            return (
                depth <= WRAPPER_DEPTH &&
                only.length === 1 &&
                only[0] !== undefined &&
                isGlyphNode(only[0], depth + 1, seen)
            );
        }

        return false;
    }

    // Built from a recipe: some identifier in the expression is one, and both branches of a conditional are, so a
    // hand-built class beside a recipe one (`disc ? HERO_DISC_CLASS : PLAIN_CLASS`) is still a copy.
    const builtFromRecipe = (node: ts.Node): boolean => {
        if (ts.isIdentifier(node)) {
            return recipes.has(node.text);
        }

        if (ts.isConditionalExpression(node)) {
            return builtFromRecipe(node.whenTrue) && builtFromRecipe(node.whenFalse);
        }

        return ts.forEachChild(node, (child) => builtFromRecipe(child) || undefined) ?? false;
    };

    const usesRecipe = (opening: Opening): boolean =>
        inDesignSystem &&
        opening.attributes.properties.some(
            (attribute) =>
                ts.isJsxAttribute(attribute) &&
                ts.isIdentifier(attribute.name) &&
                attribute.name.text === 'className' &&
                attribute.initializer !== undefined &&
                builtFromRecipe(attribute.initializer),
        );

    const found: IconOnlyControl[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node)) {
            const only = contentOf(node.children);
            const control =
                only.length === 1 &&
                only[0] !== undefined &&
                isInteractive(node.openingElement) &&
                isGlyphNode(only[0], 1, new Set()) &&
                !usesRecipe(node.openingElement);

            if (control) {
                found.push({ line: lineOf(file, node), text: node.openingElement.getText(file) });
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}
