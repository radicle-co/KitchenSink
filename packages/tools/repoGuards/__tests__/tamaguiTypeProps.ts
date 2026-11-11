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
 * 2026-11-01, ADR-0080 §8): the tab bar, which draws every tab label, the view-switch control, and the floating create button's face
 * (ruling d, 2026-11-02). Also, per designer ruling c10ecadbf (2026-11-03), a step numeral (the cook's and the editor's) and the
 * pinned ingredients bar's `for {n}` and meta lines (its title and cue take the `barTitle` role, which already ceilings at
 * 1.5x), which cap at 1.5x like chrome, and the editor header's title and save status (2026-11-03). And the editor's sticky sections bar, which
 * is chrome and caps at 1.5x so it never draws larger than the page title (designer ruling 2026-11-07, designAnswers.md
 * "2026-11-07: editor sections bar at the text cap").
 */
const CHROME_MODULES =
    /(?:^|\/)packages\/apps\/commise\/(?:mobile\/src\/components\/home\/chrome\/HomeTabBar\.tsx|ui\/src\/segmentedControl\/SegmentedControl\.native\.tsx|ui\/src\/createFab\/FabFace\.native\.tsx|ui\/src\/largeTitleHeader\/CondensedTitleBar\.native\.tsx|features\/recipes\/src\/detail\/StepRow\.native\.tsx|features\/recipes\/src\/detail\/PinnedIngredientsBar\.native\.tsx|features\/recipes\/src\/form\/RecipeInstructionsFields\.native\.tsx|features\/recipes\/src\/editor\/EditorHeader\.native\.tsx|ui\/src\/sectionIndex\/SectionIndex\.native\.tsx)$/u;

/**
 * The modules that draw initials at a size that does not scale, with `fixedPx` (designer ruling c10ecadbf, 2026-11-03):
 * 40% of the disc's diameter, so two letters fit at every size; and the recipe cover's monogram letter, 40% of the
 * cover's height, which is decoration like them.
 */
const INITIALS_MODULES =
    /(?:^|\/)packages\/apps\/commise\/(?:ui\/src\/avatar\/AvatarDisc\.native\.tsx|ui\/src\/recipeCover\/RecipeCover\.native\.tsx|features\/recipes\/src\/discovery\/DiscoveryFooter\.native\.tsx)$/u;

/** The status badge, the only module that draws a mark on a picture with `pictorial` (designer ruling 2026-11-01, M-1). */
const PICTURE_MODULES = /(?:^|\/)packages\/apps\/commise\/ui\/src\/statusBadge\/StatusBadge\.native\.tsx$/u;

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
                  (attribute.name.getText(file) === 'chromeCap' && !CHROME_MODULES.test(file.fileName)) ||
                  (attribute.name.getText(file) === 'pictorial' && !PICTURE_MODULES.test(file.fileName)) ||
                  (attribute.name.getText(file) === 'fixedPx' && !INITIALS_MODULES.test(file.fileName))
                : OLD_TYPE_STYLES.test(attribute.expression.getText(file)),
        // `textScale` is the design-system Text's context value (ADR-0080 §8); as a default it would hold every instance at
        // one scale, whatever the cook's setting (GATE SCQ-2).
        property: ({ key, value }) =>
            key === 'textScale' ||
            key === 'chromeCap' ||
            key === 'pictorial' ||
            key === 'fixedPx' ||
            (key === 'lineHeight' && !isPxLineHeight(value)),
    });
}
