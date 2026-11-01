/**
 * G4 (ADR-0080): native text is set by type role, and a `styled(…)` line height is a `px` string. See
 * `tamaguiTypeProps.test.ts` for why.
 *
 * @pattern Specification — one predicate over a parsed module
 */
import ts from 'typescript';

import type { StyledExportsOf } from './tamaguiElements.js';
import { styleSiteFindings } from './tamaguiStyleSites.js';

const TYPE_PARTS = new Set([
    'fontSize',
    'lineHeight',
    'fontFamily',
    'fontWeight',
    'letterSpacing',
    'fontVariant',
    'textScale',
]);

const OLD_TYPE_STYLES = /^nativeTokens\.type\b/u;
/**
 * The navigation chrome, the only modules that may lower a label's ceiling with `chromeCap` (designer ruling
 * 2026-11-01, ADR-0080 §8): the tab bar, which draws every tab label, and the view-switch control.
 */
const CHROME_MODULES =
    /(?:^|\/)packages\/apps\/commise\/(?:mobile\/src\/components\/home\/chrome\/HomeTabBar\.tsx|ui\/src\/segmentedControl\/SegmentedControl\.native\.tsx)$/u;

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
    return styleSiteFindings(source, fileName, styledExportsOf, {
        attribute: (attribute, file) =>
            ts.isJsxAttribute(attribute)
                ? TYPE_PARTS.has(attribute.name.getText(file)) ||
                  (attribute.name.getText(file) === 'chromeCap' && !CHROME_MODULES.test(file.fileName))
                : OLD_TYPE_STYLES.test(attribute.expression.getText(file)),
        // `textScale` is the design-system Text's context value (ADR-0080 §8); as a default it would hold every instance at
        // one scale, whatever the cook's setting (GATE SCQ-2).
        property: ({ key, value }) =>
            key === 'textScale' || key === 'chromeCap' || (key === 'lineHeight' && !isPxLineHeight(value)),
    });
}
