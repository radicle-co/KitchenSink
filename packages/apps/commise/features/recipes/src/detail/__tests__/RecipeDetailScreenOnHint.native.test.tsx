/**
 * The recipe page hands the Screen on switch its hint (native). The designer keeps "Keeps the screen awake while you cook." as
 * the switch's accessibility hint only, spoken after the name and the state; react-native-web does not render an accessibility
 * hint, so this suite stands in for the toggle and reads the props the page gives it.
 */
import { renderWithTamagui } from '@commise/ui/testing/tamagui';
import { cleanup } from '@testing-library/react';
import type { ComponentProps, ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KeepAwakeToggle as ToggleAdapter } from '@commise/ui/keep-awake';

import { idleUnreachableRetry, makeRecipeDetail } from '../../__fixtures__/index.js';
import { CookMarksTestProvider } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { RecipeDetailView } from '../RecipeDetailView.native.js';

const seen = vi.hoisted(() => ({ props: undefined as ComponentProps<typeof ToggleAdapter> | undefined }));

vi.mock('@commise/ui/keep-awake', () => ({
    KeepAwakeToggle: (props: ComponentProps<typeof ToggleAdapter>) => {
        seen.props = props;

        return null;
    },
    useKeepAwake: () => undefined,
}));

afterEach(cleanup);

const view = (): ReactElement => (
    <CookMarksTestProvider>
        <RecipeDetailView unreachableRetry={idleUnreachableRetry} recipe={makeRecipeDetail()} />
    </CookMarksTestProvider>
);

describe('the recipe page hands Screen on its hint (native)', () => {
    it('gives the switch its name and the hint sentence', () => {
        renderWithTamagui(view(), 'light');

        expect(seen.props?.label).toBe(recipeMessages.en.detail.screenOn);
        expect(seen.props?.hint).toBe('Keeps the screen awake while you cook.');
    });
});
