/**
 * The native recipe form's shared `StyleSheet` holds LAYOUT ONLY (D15, `darkTheme.md` §7.3): a colour in a static sheet
 * is baked into one theme at import, so its consumers paint at render from `useTheme()` (the authored-food sheet with
 * the design system's `fieldPaint`, the nutrition panel with `ink`/`inkMuted`). Their colours are asserted in both
 * schemes by `AuthoredFoodSheet.native.test.tsx` and `NutritionPanelBody.native.test.tsx`; the colour-role guard
 * (`colourRoles.test.ts`) refuses a colour key in this sheet.
 *
 * ⚠️ This suite used to pin the wizard-era ingredient row's geometry (`listRow`, `rowGrow`, `rowNarrow`: the U9/R42
 * name-crush fix). The overhaul's slice 8 rebuilt the row as `IngredientRow.native.tsx`, which never read those keys, so
 * the suite was proving a layout nothing rendered; the keys and their assertions were deleted together.
 */
import { fieldGeometry } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { describe, expect, it } from 'vitest';

import { styles } from '../formSectionStyles.native.js';

describe('the native recipe-form StyleSheet', () => {
    it('draws a field on the design-system field geometry, and nothing else', () => {
        expect(styles.input).toEqual(fieldGeometry);
    });

    it('sets a field label in the label type role', () => {
        expect(styles.fieldLabel).toEqual(nativeTokens.type.label);
    });
});
