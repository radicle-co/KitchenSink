/**
 * @module HomeSidebar.card — the design-system card of the Home sidebar: expanded and collapsed side by side at a
 * fixed rail height, with the primary action as a button and as a round icon button.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const CHROME = {
    wordmark: 'Commise',
    logoAlt: 'Commise',
    primaryNavLabel: 'Main',
    collapseNav: 'Collapse',
    expandNav: 'Expand sidebar',
    backToTop: 'Back to top',
    destinations: { home: 'Home', recipes: 'Recipes', discover: 'Discover', 'meal-plan': 'Plan', grocery: 'Shop' },
    profileButton: 'Profile, {name}',
    profileButtonNoName: 'Profile',
    tabNavLabel: 'Tabs',
    pageTitles: {
        home: 'Home',
        recipes: 'Recipes',
        recipeNew: 'New recipe',
        recipeDetail: 'Recipe',
        recipeEdit: 'Edit recipe',
        recipeVersions: 'Version history',
        discover: 'Discover',
        collections: 'Collections',
        collectionDetail: 'Collection',
        profile: 'Profile',
        dataSources: 'Data sources',
        notFound: 'Page not found',
    },
};

const RAIL = {
    border: '1px solid var(--line-divider, var(--line))',
    borderRadius: 12,
    overflow: 'hidden',
    height: 600,
    background: 'var(--canvas)',
} as const;

export default defineCard({
    group: 'App chrome',
    height: 660,
    platforms: 'web',
    reason: 'the sidebar is a web-only chrome at 840 px and wider; native navigates with HomeTabBar.',
    uses: ['HomeSidebar', 'Button', 'Icon'],
    render: ({ HomeSidebar, Button, Icon }) => (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            {[false, true].map((collapsed) => (
                <div key={String(collapsed)} style={RAIL}>
                    <HomeSidebar
                        chrome={CHROME}
                        locale="en"
                        liveCapabilities={[]}
                        activeId="recipes"
                        profile={{ status: 'ready', name: 'Ana Ruiz' }}
                        collapsed={collapsed}
                        onToggleCollapse={noop}
                        newRecipe={
                            collapsed ? (
                                <button
                                    type="button"
                                    aria-label="New recipe"
                                    style={{
                                        width: 48,
                                        height: 48,
                                        borderRadius: 9999,
                                        border: 0,
                                        background: 'var(--action)',
                                        color: 'var(--on-action)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Icon name="plus" size={24} tone="onAction" />
                                </button>
                            ) : (
                                <Button variant="primary" icon="plus">
                                    New recipe
                                </Button>
                            )
                        }
                    />
                </div>
            ))}
        </div>
    ),
});
