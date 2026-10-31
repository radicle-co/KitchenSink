/**
 * G6 (ADR-0080): no Tamagui element owns a press. See `tamaguiPressOwnership.test.ts` for why. A press owner is a press
 * handler prop, or a press style: a `press:` modifier (or one Tamagui reads as press) inside a value, or a `press` key
 * of the object form.
 *
 * @pattern Specification — one predicate over a parsed module
 */
import { canonicalClauseModifier } from '@tamagui/style-grammar/runtime';
import ts from 'typescript';

import { parseModule } from './appSources.js';
import {
    isTamaguiStyledCall,
    tamaguiElementNames,
    tamaguiOpeningElements,
    tamaguiStyledNames,
    type StyledExportsOf,
} from './tamaguiElements.js';
import { styledStyleProperties } from './tamaguiStyleObjects.js';

const PRESS_HANDLERS = new Set(['onPress', 'onPressIn', 'onPressOut', 'onLongPress']);

function isPressModifier(modifier: string): boolean {
    const canonical = canonicalClauseModifier(modifier);

    return canonical === 'press' || /^group-press(?:\/|$)/u.test(canonical);
}

/**
 * Whether a flat value names a press state. Tamagui splits a value on whitespace and reads the text before a token's
 * last `:` as its modifiers (`@tamagui/web` `mergeVariants.ts`). Pure.
 */
function textHasPress(text: string): boolean {
    return text
        .split(/\s+/u)
        .filter((token) => token.includes(':'))
        .some((token) => token.slice(0, token.lastIndexOf(':')).split(':').some(isPressModifier));
}

function valueHasPress(expression: ts.Expression): boolean {
    let found = false;

    const visit = (node: ts.Node): void => {
        if (
            (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) &&
            textHasPress(node.text)
        ) {
            found = true;
        }

        if (
            ts.isPropertyAssignment(node) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            isPressModifier(node.name.text)
        ) {
            found = true;
        }

        ts.forEachChild(node, visit);
    };

    visit(expression);

    return found;
}

function lineOf(file: ts.SourceFile, node: ts.Node): number {
    return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
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
    const file = parseModule(fileName, source);
    const findings: string[] = [];

    const report = (node: ts.Node): void => {
        findings.push(`${fileName}:${lineOf(file, node)} ${node.getText(file)}`);
    };

    for (const element of tamaguiOpeningElements(file, tamaguiElementNames(file, styledExportsOf))) {
        for (const attribute of element.attributes.properties) {
            if (!ts.isJsxAttribute(attribute)) {
                continue;
            }

            const name = attribute.name.getText(file);
            const initializer = attribute.initializer;
            const value =
                initializer === undefined
                    ? undefined
                    : ts.isJsxExpression(initializer)
                      ? initializer.expression
                      : initializer;

            if (PRESS_HANDLERS.has(name) || (value !== undefined && ts.isExpression(value) && valueHasPress(value))) {
                report(attribute);
            }
        }
    }

    const styledNames = tamaguiStyledNames(file);

    const visit = (node: ts.Node): void => {
        if (isTamaguiStyledCall(node, styledNames)) {
            // A nested object's own properties are walked as entries of their own, so an object value is judged only
            // by its direct keys (the object form's `press`), and a string inside it is reported once, where it is.
            for (const { key, value, node: property } of styledStyleProperties(node)) {
                const owns = ts.isObjectLiteralExpression(value)
                    ? value.properties.some(
                          (inner) =>
                              ts.isPropertyAssignment(inner) &&
                              (ts.isIdentifier(inner.name) || ts.isStringLiteral(inner.name)) &&
                              isPressModifier(inner.name.text),
                      )
                    : valueHasPress(value);

                if (PRESS_HANDLERS.has(key) || owns) {
                    report(property);
                }
            }

            return;
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return findings;
}
