/**
 * @module RecipeHero.card — the design-system card of the RecipeHero: a recipe with two photos and one with none (the
 * cover falls back), each with the Back and More overlay controls (a HeroButton and an ActionMenu disc).
 */
import { defineCard } from '../../../../src/cards/defineCard.js';
import type { CardUi, NativeCardUi } from '../../../../src/cards/cardComponents.js';

const noop = (): void => undefined;

function artwork(background: string, outer: string, inner: string): string {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="${background}"/>` +
        `<circle cx="400" cy="300" r="190" fill="${outer}"/><circle cx="400" cy="300" r="120" fill="${inner}"/></svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const photos = [
    ['p1', '#e6b873', '#c8553d', '#f4d58d'],
    ['p2', '#d9c7a3', '#6b8e4e', '#f2ead3'],
].map(([id, background, outer, inner], index) => ({
    id,
    recipeId: 'r-101',
    key: `k${String(index)}`,
    url: artwork(background ?? '', outer ?? '', inner ?? ''),
    contentType: 'image/svg+xml',
    order: index + 1,
    createdAt: '2026-10-01T12:00:00.000Z',
}));

function overlay(
    { HeroButton, ActionMenu }: CardUi<'HeroButton' | 'ActionMenu'> | NativeCardUi<'HeroButton' | 'ActionMenu'>,
    title: string,
) {
    return [
        <HeroButton key="b" icon="chevronLeft" label="Back" onPress={noop} />,
        <ActionMenu
            key="m"
            appearance="disc"
            triggerLabel={`More actions for ${title}`}
            title="More actions"
            closeLabel="Close more actions"
            items={[{ id: 'clearChecks', label: 'Clear checks', icon: 'rotateCcw', onSelect: noop }]}
        />,
    ];
}

export default defineCard({
    group: 'Recipes',
    height: 470,
    platforms: 'both',
    uses: ['RecipeHero', 'HeroButton', 'ActionMenu'],
    staging: { phoneViewport: true },
    render: ({ RecipeHero, HeroButton, ActionMenu }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
            <RecipeHero
                title="Lemon ricotta pancakes"
                photos={photos}
                overlay={overlay({ HeroButton, ActionMenu }, 'Lemon ricotta pancakes')}
            />
            <RecipeHero
                title="Weeknight pad thai"
                photos={[]}
                overlay={overlay({ HeroButton, ActionMenu }, 'Weeknight pad thai')}
            />
        </div>
    ),
    // The native HeroButton takes `ref` as a plain prop, so its component type differs from the web one.
    renderNative: ({
        RecipeHero,
        HeroButton,
        ActionMenu,
    }: NativeCardUi<'RecipeHero' | 'HeroButton' | 'ActionMenu'>) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
            <RecipeHero
                title="Lemon ricotta pancakes"
                photos={photos}
                overlay={overlay({ HeroButton, ActionMenu }, 'Lemon ricotta pancakes')}
            />
            <RecipeHero
                title="Weeknight pad thai"
                photos={[]}
                overlay={overlay({ HeroButton, ActionMenu }, 'Weeknight pad thai')}
            />
        </div>
    ),
});
