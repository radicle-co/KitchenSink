/**
 * Whether a Tamagui style value is made only of tokens, shared by the Tamagui colour and radius guards (ADR-0080). The
 * config makes a raw value a type error (`allowedStyleValues: 'strict'`), and a cast is how it is made to compile, so
 * the guards read the SOURCE: what a value says, not what it is typed as.
 *
 * @pattern Specification — one predicate over a value, parameterised by what a token is
 */
import ts from 'typescript';

/** What one whitespace-free token, with its state modifiers already removed, may be. */
export type TokenRule = (token: string) => boolean;

/**
 * Whether a value is, wherever it is read, only tokens `isToken` accepts: a string of them (each after any state
 * modifiers: `press:$ink` is read as `$ink`), a choice between such values, or the object form whose every value is
 * one. A cast (`as`, `satisfies`, `!`) is not looked through: it is how a raw value is made to compile, so a wrapped
 * value is refused whatever it wraps. Parentheses alone are looked through. An identifier, a call, a number and a
 * template with a substitution say nothing a token can be read from, so they are refused. Pure.
 *
 * @param expression - The value.
 * @param isToken - What a token may be.
 */
export function isTokenValue(expression: ts.Expression, isToken: TokenRule): boolean {
    if (ts.isParenthesizedExpression(expression)) {
        return isTokenValue(expression.expression, isToken);
    }

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        const tokens = expression.text.split(/\s+/u).filter((token) => token !== '');

        return tokens.length > 0 && tokens.every((token) => isToken(token.slice(token.lastIndexOf(':') + 1)));
    }

    if (ts.isConditionalExpression(expression)) {
        return isTokenValue(expression.whenTrue, isToken) && isTokenValue(expression.whenFalse, isToken);
    }

    if (ts.isObjectLiteralExpression(expression)) {
        return (
            expression.properties.length > 0 &&
            expression.properties.every(
                (property) => ts.isPropertyAssignment(property) && isTokenValue(property.initializer, isToken),
            )
        );
    }

    return false;
}

/** The value of a JSX attribute: `{expr}`, or its string literal. Pure. */
export function attributeValueOf(attribute: ts.JsxAttribute): ts.Expression | undefined {
    const { initializer } = attribute;

    if (initializer !== undefined && ts.isJsxExpression(initializer)) {
        return initializer.expression;
    }

    return initializer !== undefined && ts.isStringLiteral(initializer) ? initializer : undefined;
}
