/**
 * @module RecipeCover.card — the design-system card of RecipeCover: the generated cover for two cuisines, a real
 * photo, a square cover without a cuisine, and a wide band, on both platforms.
 */
import type { ComponentProps } from 'react';

import { defineCard } from '../../../../src/cards/defineCard.js';

const photo = `data:image/svg+xml;utf8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#e6b873"/><circle cx="200" cy="150" r="90" fill="#c8553d"/><circle cx="200" cy="150" r="60" fill="#f4d58d"/></svg>',
)}`;

export default defineCard({
    group: 'Media',
    height: 430,
    platforms: 'both',
    uses: ['RecipeCover'],
    render: ({ RecipeCover }) => {
        const box = (width: number, props: ComponentProps<typeof RecipeCover>) => (
            <div style={{ width, display: 'flex', flexDirection: 'column' }}>
                <RecipeCover {...props} />
            </div>
        );

        return (
            <div className="row">
                {box(160, { recipeId: 'r-101', title: 'Lemon ricotta pancakes', cuisine: 'American', aspect: '4:3' })}
                {box(160, { recipeId: 'r-202', title: 'Weeknight pad thai', cuisine: 'Thai', aspect: '4:3' })}
                {box(160, { recipeId: 'r-303', title: 'Roast tomato soup', photoUrl: photo, aspect: '4:3' })}
                {box(96, { recipeId: 'r-404', title: 'Shakshuka', aspect: '1:1' })}
                {box(340, { recipeId: 'r-505', title: 'Focaccia', cuisine: 'Italian', aspect: 'band' })}
            </div>
        );
    },
});
