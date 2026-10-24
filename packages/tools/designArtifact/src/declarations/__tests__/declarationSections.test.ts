import { describe, expect, it } from 'vitest';

import { COMMISE_ROOT, UI_SRC } from '../../config.js';
import { memorySourceFiles } from '../../sources/memorySourceFiles.js';
import { declarationSections } from '../declarationSections.js';

const CHIP = `${COMMISE_ROOT}/features/recipes/src/card/RecipeCard.tsx`;
const SIDEBAR = `${COMMISE_ROOT}/web/src/components/home/chrome/HomeSidebar.tsx`;
const NATIVE_BAR = `${COMMISE_ROOT}/mobile/src/components/home/chrome/HomeTabBar.tsx`;

describe('declarationSections', () => {
    const files = memorySourceFiles({
        [`${UI_SRC}/chip/props.ts`]: "import type { A } from './a.js';\nexport interface ChipProps { readonly a: A }\n",
        [`${UI_SRC}/button/props.ts`]: 'export type ButtonVariant = 1;\n',
        [`${UI_SRC}/modal/Modal.tsx`]: 'export const Modal = 1;\n',
        [CHIP]: 'export interface RecipeCardProps { readonly t: string }\nexport function RecipeCard() {}\n',
        [SIDEBAR]: 'export interface HomeSidebarProps { readonly c: 1 }\n',
        [NATIVE_BAR]: 'export interface HomeTabBarProps { readonly d: 2 }\n',
    });

    it('prints each @commise/ui props.ts, imports stripped, in directory order; directories without one add nothing', async () => {
        const sections = await declarationSections(files);
        const ui = sections.filter((s) => s.heading.startsWith('@commise/ui/'));

        expect(ui.map((s) => s.heading)).toEqual(['@commise/ui/button', '@commise/ui/chip']);
        expect(ui[1]?.source).toBe('export interface ChipProps { readonly a: A }');
    });

    it('prints only the exported types of a product or chrome component, headed by its path under the Commise tree', async () => {
        const sections = await declarationSections(files);

        expect(sections.find((s) => s.heading === 'features/recipes/src/card/RecipeCard')?.source).toBe(
            'export interface RecipeCardProps { readonly t: string }',
        );
        expect(sections.find((s) => s.heading === 'web/src/components/home/chrome/HomeSidebar')).toBeDefined();
        expect(sections.find((s) => s.heading === 'mobile/src/components/home/chrome/HomeTabBar')?.source).toContain(
            'HomeTabBarProps',
        );
    });

    it('skips a registered file that is not there rather than failing the whole index', async () => {
        const sections = await declarationSections(
            memorySourceFiles({ [`${UI_SRC}/chip/props.ts`]: 'export type A = 1;' }),
        );

        expect(sections.map((s) => s.heading)).toEqual(['@commise/ui/chip']);
    });
});
