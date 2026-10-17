/**
 * Every React Native `View` an app source file renders with a NAME or a ROLE, and nothing that keeps its native node —
 * read with the TypeScript parser. The detector behind `nativeLabelledViews.test.ts`.
 *
 * React Native 0.86 flattens a View that only lays out its children out of Android's native tree
 * (`ReactCommon/react/renderer/components/view/ViewShadowNode.cpp`, `formsStackingContext`). Neither a label nor a role
 * is among the props that keep it, so the name goes with it. A View kept only for a background or a border is mounted
 * with its children hoisted out of it (`mounting/internal/sliceChildShadowNodeViewPairs.cpp`), so a group's members are
 * no longer inside it. `collapsable={false}`, a native id (`id`, `nativeID`), `accessible` and the modal flags
 * (`aria-modal`, `accessibilityViewIsModal`) keep the node with its children. A flag keeps it only when it is bare or
 * literally `true`, because an expression can be `false`. Whether a style happens to form a view is not read, because a
 * style can change without the label noticing.
 *
 * `Animated.View` is a View. A name or role passed through a spread counts when the spread is an object literal, read
 * through a conditional or a logical operator. ⚠️ An opaque spread (`{...props}`, `{...panHandlers}`) is read as naming
 * nothing, because its keys are not in the source, so a name forwarded through one is not seen. A spread never keeps a
 * node.
 *
 * A second check, {@link namedTwiceViews}, finds a View whose name is the expression a `Text` inside it says, at any
 * depth (`docs/design/nativeContainerNames.md` N3). It compares syntax, so a name said in other words is not seen.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

/** The props that give a View an accessible name or role. */
const NAMING_PROPS = new Set(['accessibilityLabel', 'aria-label', 'aria-labelledby', 'accessibilityRole', 'role']);

/** The props that give a View an accessible name in words (not a role, not a reference to another node). */
const LABEL_PROPS = new Set(['accessibilityLabel', 'aria-label']);

/** The props that keep a View's native node, children included, whatever their value. */
const KEEPING_PROPS = new Set(['id', 'nativeID']);

/**
 * The local names a file gives React Native's `View`, `Animated` and `Text` values, and its namespace imports of
 * `react-native`.
 */
interface ViewBindings {
    readonly names: Set<string>;
    readonly animated: Set<string>;
    readonly texts: Set<string>;
    readonly namespaces: Set<string>;
}

/** The {@link ViewBindings} of one file. */
function viewBindingsOf(file: ts.SourceFile): ViewBindings {
    const names = new Set<string>();
    const animated = new Set<string>();
    const texts = new Set<string>();
    const namespaces = new Set<string>();

    for (const statement of file.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== 'react-native' ||
            statement.importClause === undefined ||
            statement.importClause.isTypeOnly
        ) {
            continue;
        }

        const bindings = statement.importClause.namedBindings;

        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
            continue;
        }

        for (const element of bindings?.elements ?? []) {
            const imported = (element.propertyName ?? element.name).text;

            if (!element.isTypeOnly && imported === 'View') {
                names.add(element.name.text);
            }

            if (!element.isTypeOnly && imported === 'Animated') {
                animated.add(element.name.text);
            }

            if (!element.isTypeOnly && imported === 'Text') {
                texts.add(element.name.text);
            }
        }
    }

    return { names, animated, texts, namespaces };
}

/** Whether a JSX tag names React Native's `View` or `Animated.View`, directly or through a namespace import. */
function isViewTag(tag: ts.JsxTagNameExpression, { names, animated, namespaces }: ViewBindings): boolean {
    if (ts.isIdentifier(tag)) {
        return names.has(tag.text);
    }

    if (!ts.isPropertyAccessExpression(tag) || tag.name.text !== 'View') {
        return false;
    }

    const owner = tag.expression;

    if (ts.isIdentifier(owner)) {
        return namespaces.has(owner.text) || animated.has(owner.text);
    }

    return (
        ts.isPropertyAccessExpression(owner) &&
        ts.isIdentifier(owner.expression) &&
        namespaces.has(owner.expression.text) &&
        owner.name.text === 'Animated'
    );
}

/** Whether a JSX tag names React Native's `Text`, directly or through a namespace import. */
function isTextTag(tag: ts.JsxTagNameExpression, { texts, namespaces }: ViewBindings): boolean {
    if (ts.isIdentifier(tag)) {
        return texts.has(tag.text);
    }

    return (
        ts.isPropertyAccessExpression(tag) &&
        tag.name.text === 'Text' &&
        ts.isIdentifier(tag.expression) &&
        namespaces.has(tag.expression.text)
    );
}

/**
 * Whether a spread may give the View a name or a role: an object literal with a naming key, read through a
 * conditional, a logical operator, parentheses or a type assertion. Anything else names nothing.
 */
function spreadMayName(expression: ts.Expression): boolean {
    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isNonNullExpression(expression)
    ) {
        return spreadMayName(expression.expression);
    }

    if (ts.isConditionalExpression(expression)) {
        return spreadMayName(expression.whenTrue) || spreadMayName(expression.whenFalse);
    }

    if (ts.isBinaryExpression(expression)) {
        return spreadMayName(expression.left) || spreadMayName(expression.right);
    }

    if (!ts.isObjectLiteralExpression(expression)) {
        return false;
    }

    return expression.properties.some((property) => {
        if (ts.isSpreadAssignment(property)) {
            return spreadMayName(property.expression);
        }

        const key = property.name;

        return key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key)) && NAMING_PROPS.has(key.text);
    });
}

/** Whether an attribute's value is the literal `keyword`, written `{true}` or `{false}`. */
function isLiteral(
    attribute: ts.JsxAttribute,
    keyword: ts.SyntaxKind.TrueKeyword | ts.SyntaxKind.FalseKeyword,
): boolean {
    const value = attribute.initializer;

    return value !== undefined && ts.isJsxExpression(value) && value.expression?.kind === keyword;
}

/** Whether an attribute is a flag that is bare or literally `true`. */
function isSetFlag(attribute: ts.JsxAttribute): boolean {
    return attribute.initializer === undefined || isLiteral(attribute, ts.SyntaxKind.TrueKeyword);
}

/**
 * Whether one attribute makes the View ONE accessibility element, its children read as part of its name: `accessible`,
 * bare or literally `true`.
 */
function makesOneElement(attribute: ts.JsxAttribute): boolean {
    return attribute.name.getText() === 'accessible' && isSetFlag(attribute);
}

/**
 * Whether one attribute keeps the node: a native id, `accessible` or a modal flag that is bare or literally `true`, or
 * `collapsable={false}`.
 */
function keepsNode(attribute: ts.JsxAttribute): boolean {
    const name = attribute.name.getText();

    if (KEEPING_PROPS.has(name) || makesOneElement(attribute)) {
        return true;
    }

    if (name === 'aria-modal' || name === 'accessibilityViewIsModal') {
        return isSetFlag(attribute);
    }

    return name === 'collapsable' && isLiteral(attribute, ts.SyntaxKind.FalseKeyword);
}

/** One offender, as `line: <the opening tag's first line>`. */
function offenderAt(file: ts.SourceFile, node: ts.Node): string {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));

    return `${String(line + 1)}: ${node.getText(file).split('\n')[0] ?? ''}`;
}

/**
 * What a piece of syntax says, as a key two places can be compared by: a literal's text, or an expression's source
 * with its whitespace removed.
 */
function saidBy(expression: ts.Expression, file: ts.SourceFile): string {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return `text:${expression.text}`;
    }

    return `expression:${expression.getText(file).replace(/\s+/g, '')}`;
}

/**
 * The names a spread may give a View in words: the label keys of an object literal, read through a conditional, a
 * logical operator, parentheses or a type assertion, as {@link spreadMayName} reads them.
 */
function spreadLabels(expression: ts.Expression, file: ts.SourceFile): readonly string[] {
    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isNonNullExpression(expression)
    ) {
        return spreadLabels(expression.expression, file);
    }

    if (ts.isConditionalExpression(expression)) {
        return [...spreadLabels(expression.whenTrue, file), ...spreadLabels(expression.whenFalse, file)];
    }

    if (ts.isBinaryExpression(expression)) {
        return [...spreadLabels(expression.left, file), ...spreadLabels(expression.right, file)];
    }

    if (!ts.isObjectLiteralExpression(expression)) {
        return [];
    }

    return expression.properties.flatMap((property) => {
        if (ts.isSpreadAssignment(property)) {
            return spreadLabels(property.expression, file);
        }

        const key = property.name;

        return ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(key) || ts.isStringLiteral(key)) &&
            LABEL_PROPS.has(key.text)
            ? [saidBy(property.initializer, file)]
            : [];
    });
}

/** The names an opening tag gives its element in words, each as a {@link saidBy} key. */
function labelsOf(node: ts.JsxOpeningLikeElement, file: ts.SourceFile): readonly string[] {
    return node.attributes.properties.flatMap((property) => {
        if (ts.isJsxSpreadAttribute(property)) {
            return spreadLabels(property.expression, file);
        }

        const value = property.initializer;

        if (!LABEL_PROPS.has(property.name.getText(file)) || value === undefined) {
            return [];
        }

        if (ts.isStringLiteral(value)) {
            return [saidBy(value, file)];
        }

        return ts.isJsxExpression(value) && value.expression !== undefined ? [saidBy(value.expression, file)] : [];
    });
}

/** What a `Text` element's children say, each as a {@link saidBy} key. */
function textsSaidBy(element: ts.JsxElement, file: ts.SourceFile): readonly string[] {
    return element.children.flatMap((child) => {
        if (ts.isJsxText(child)) {
            const text = child.text.trim();

            return text === '' ? [] : [`text:${text}`];
        }

        return ts.isJsxExpression(child) && child.expression !== undefined ? [saidBy(child.expression, file)] : [];
    });
}

/**
 * Every `View` in a source file whose name a React Native `Text` anywhere inside it says again, by the same
 * expression or the same literal, as `line: <opening tag>` (`docs/design/nativeContainerNames.md` N3). A View that is
 * ONE element (`accessible`) is not one: its text is read as part of it, so the name is said once. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @returns One entry per offending element.
 */
export function namedTwiceViews(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const bindings = viewBindingsOf(file);
    const offenders: string[] = [];

    const saidInside = (root: ts.Node): Set<string> => {
        const said = new Set<string>();

        const visit = (node: ts.Node): void => {
            if (ts.isJsxElement(node) && isTextTag(node.openingElement.tagName, bindings)) {
                textsSaidBy(node, file).forEach((key) => said.add(key));
            }

            ts.forEachChild(node, visit);
        };

        root.forEachChild(visit);

        return said;
    };

    const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) && isViewTag(node.openingElement.tagName, bindings)) {
            const labels = labelsOf(node.openingElement, file);
            const oneElement = node.openingElement.attributes.properties.some(
                (property) => ts.isJsxAttribute(property) && makesOneElement(property),
            );

            if (labels.length > 0 && !oneElement) {
                const said = saidInside(node);

                if (labels.some((label) => said.has(label))) {
                    offenders.push(offenderAt(file, node.openingElement));
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offenders;
}

/**
 * Every named or roled `View` in a source file that nothing keeps, as `line: <opening tag>`. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, which decides whether it is parsed as TSX.
 * @returns One entry per offending element.
 */
export function unkeptNamedViews(source: string, fileName: string): readonly string[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const bindings = viewBindingsOf(file);
    const offenders: string[] = [];

    if (bindings.names.size === 0 && bindings.animated.size === 0 && bindings.namespaces.size === 0) {
        return offenders;
    }

    const visit = (node: ts.Node): void => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isViewTag(node.tagName, bindings)) {
            const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
            const named =
                attributes.some((attribute) => NAMING_PROPS.has(attribute.name.getText())) ||
                node.attributes.properties.some(
                    (property) => ts.isJsxSpreadAttribute(property) && spreadMayName(property.expression),
                );

            if (named && !attributes.some(keepsNode)) {
                offenders.push(offenderAt(file, node));
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return offenders;
}
