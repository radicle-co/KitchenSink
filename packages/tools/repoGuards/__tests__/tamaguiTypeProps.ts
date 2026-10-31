/**
 * G4 (ADR-0080): native text is set by type role, and a `styled(…)` line height is a `px` string. See
 * `tamaguiTypeProps.test.ts` for why.
 *
 * @pattern Specification — one predicate over a parsed module
 */
import ts from 'typescript';

import { lineOf, parseModule } from './appSources.js';
import {
    isTamaguiStyledCall,
    tamaguiElementNames,
    tamaguiOpeningElements,
    tamaguiStyledNames,
    type StyledExportsOf,
} from './tamaguiElements.js';
import { styledConfig } from './tamaguiStyleObjects.js';

const TYPE_PARTS = new Set(['fontSize', 'lineHeight', 'fontFamily', 'fontWeight', 'letterSpacing']);

const OLD_TYPE_STYLES = /^nativeTokens\.type\b/u;

const PX = /^\d+(?:\.\d+)?px$/u;

function isPxLineHeight(value: ts.Expression): boolean {
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        return PX.test(value.text);
    }

    return ts.isTemplateExpression(value) && (value.templateSpans.at(-1)?.literal.text ?? '').endsWith('px');
}

/**
 * Every type part set on a Tamagui element, every spread of the old type styles onto one, and every `styled(…)` line
 * height that is not a `px` string, in one module. Pure, given `styledExportsOf`.
 *
 * @param source - The module's text.
 * @param fileName - Its path.
 * @param styledExportsOf - Which names a design-system subpath exports as Tamagui `styled(…)` components.
 * @returns One `file:line text` entry per finding.
 */
export function typePropFindings(
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
            if (ts.isJsxAttribute(attribute) && TYPE_PARTS.has(attribute.name.getText(file))) {
                report(attribute);
            }

            if (ts.isJsxSpreadAttribute(attribute) && OLD_TYPE_STYLES.test(attribute.expression.getText(file))) {
                report(attribute);
            }
        }
    }

    const styledNames = tamaguiStyledNames(file);

    const visit = (node: ts.Node): void => {
        if (isTamaguiStyledCall(node, styledNames)) {
            const { properties, unreadable } = styledConfig(node);

            // Fail closed: a part the walk cannot read is reported, never passed.
            unreadable.forEach(report);

            for (const { key, value, node: property } of properties) {
                if (key === 'lineHeight' && !isPxLineHeight(value)) {
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
