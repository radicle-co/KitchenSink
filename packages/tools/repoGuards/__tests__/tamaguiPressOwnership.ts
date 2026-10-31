/**
 * G6 (ADR-0080): no Tamagui element owns a press. See `tamaguiPressOwnership.test.ts` for why. A press owner is a press
 * handler prop, or a press style: a `press:` modifier (or one Tamagui reads as press) inside a value, or a `press` key
 * of the object form.
 *
 * @pattern Specification — one predicate over a parsed module
 */
import { canonicalClauseModifier } from '@tamagui/style-grammar/runtime';
import ts from 'typescript';

import type { StyledExportsOf } from './tamaguiElements.js';
import type { StyleProperty } from './tamaguiStyleObjects.js';
import { valueHasModifier } from './tamaguiStateStyles.js';
import { styleSiteFindings } from './tamaguiStyleSites.js';

const PRESS_HANDLERS = new Set(['onPress', 'onPressIn', 'onPressOut', 'onLongPress']);

function isPressModifier(modifier: string): boolean {
    const canonical = canonicalClauseModifier(modifier);

    return canonical === 'press' || /^group-press(?:\/|$)/u.test(canonical);
}

function valueHasPress(expression: ts.Expression): boolean {
    return valueHasModifier(expression, isPressModifier);
}

function attributeOwnsPress(attribute: ts.JsxAttributeLike, file: ts.SourceFile): boolean {
    if (!ts.isJsxAttribute(attribute)) {
        return false;
    }

    const { initializer } = attribute;
    const value = initializer !== undefined && ts.isJsxExpression(initializer) ? initializer.expression : initializer;

    return PRESS_HANDLERS.has(attribute.name.getText(file)) || (value !== undefined && valueHasPress(value));
}

/**
 * A nested object's own properties are walked as entries of their own, so an object value is judged only by its direct
 * keys (the object form's `press`), and a string inside it is reported once, where it is.
 */
function propertyOwnsPress({ key, value }: StyleProperty): boolean {
    const owns = ts.isObjectLiteralExpression(value)
        ? value.properties.some(
              (inner) =>
                  ts.isPropertyAssignment(inner) &&
                  (ts.isIdentifier(inner.name) || ts.isStringLiteral(inner.name)) &&
                  isPressModifier(inner.name.text),
          )
        : valueHasPress(value);

    return PRESS_HANDLERS.has(key) || owns;
}

/**
 * Every press owner on a Tamagui element, or in a Tamagui `styled(…)` definition, in one module. Pure, given
 * `styledExportsOf`.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 * @returns One `file:line text` entry per owner.
 */
export function pressOwnershipFindings(
    source: string,
    fileName: string,
    styledExportsOf: StyledExportsOf,
): readonly string[] {
    return styleSiteFindings(source, fileName, styledExportsOf, {
        attribute: attributeOwnsPress,
        property: propertyOwnsPress,
    });
}
