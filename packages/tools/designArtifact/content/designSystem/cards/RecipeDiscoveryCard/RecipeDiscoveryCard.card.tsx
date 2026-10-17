/**
 * @module RecipeDiscoveryCard.card — the design-system card of RecipeDiscoveryCard: the grid and compact variants
 * across the save-a-copy states (idle, saved with an imported source, saving, failed), on both platforms.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const noop = (): void => undefined;

const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#e6b873"/><circle cx="200" cy="150" r="90" fill="#c8553d"/><circle cx="200" cy="150" r="60" fill="#f4d58d"/></svg>',
)}`;

const BASE = {
    totalTimeMinutes: 35,
    servings: 4,
    ratingCount: 0,
    usesPremiumCapability: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    tags: [],
    currentVersion: 1,
    visibility: 'public',
    status: 'published',
} as const;

const PANCAKES = {
    ...BASE,
    id: 'r-101',
    title: 'Lemon ricotta pancakes',
    difficulty: 'easy',
    averageRating: 4.6,
    ratingCount: 128,
    cuisine: 'American',
    coverPhotoUrl: PHOTO,
} as const;

const SOUP = {
    ...BASE,
    id: 'r-202',
    title: 'Roast tomato soup with basil oil',
    totalTimeMinutes: 50,
    servings: 6,
    difficulty: 'medium',
    averageRating: 4.2,
    ratingCount: 31,
    cuisine: 'Italian',
} as const;

const BREAD = {
    ...BASE,
    id: 'r-303',
    title: 'Overnight focaccia',
    totalTimeMinutes: 720,
    servings: 8,
    difficulty: 'hard',
    cuisine: 'Italian',
} as const;

const RAIL = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gridTemplateRows: 'repeat(6,auto)' } as const;
const CAPTION = { margin: '0 0 4px', font: '12px Inter,sans-serif', color: 'var(--ink-muted)' } as const;

export default defineCard({
    group: 'Recipes',
    height: 1250,
    platforms: 'both',
    uses: ['RecipeDiscoveryCard'],
    render: ({ RecipeDiscoveryCard }, { platform }) => {
        const web = platform === 'web';
        const gridWidth = web ? 260 : 173;
        const compactWidth = web ? 260 : '100%';

        return (
            <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ width: gridWidth }}>
                    <p style={CAPTION}>Grid, idle</p>
                    <div style={web ? RAIL : undefined}>
                        <RecipeDiscoveryCard
                            headingLevel={2}
                            onSelect={noop}
                            onSave={noop}
                            variant="grid"
                            recipe={PANCAKES}
                            authorUsername="marta_cooks"
                            saveCopy={{ kind: 'idle' }}
                        />
                    </div>
                </div>
                <div style={{ width: gridWidth }}>
                    <p style={CAPTION}>Grid, copy saved, imported source</p>
                    <div style={web ? RAIL : undefined}>
                        <RecipeDiscoveryCard
                            headingLevel={2}
                            onSelect={noop}
                            onSave={noop}
                            variant="grid"
                            recipe={SOUP}
                            sourceAttribution="Mrs. Beeton, 1861"
                            saveCopy={{ kind: 'saved', copyId: 'c-1' }}
                        />
                    </div>
                </div>
                <div style={{ width: compactWidth }}>
                    <p style={CAPTION}>Compact, saving</p>
                    <div>
                        <RecipeDiscoveryCard
                            headingLevel={2}
                            onSelect={noop}
                            onSave={noop}
                            variant="compact"
                            recipe={BREAD}
                            authorDisplayName="Dev Patel"
                            saveCopy={{ kind: 'saving' }}
                        />
                    </div>
                </div>
                <div style={{ width: compactWidth }}>
                    <p style={CAPTION}>Compact, save failed</p>
                    <div>
                        <RecipeDiscoveryCard
                            headingLevel={2}
                            onSelect={noop}
                            onSave={noop}
                            variant="compact"
                            recipe={PANCAKES}
                            authorUsername="marta_cooks"
                            saveCopy={{ kind: 'failed' }}
                        />
                    </div>
                </div>
            </div>
        );
    },
});
