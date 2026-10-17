/**
 * @module NutritionFigure.card — the design-system card of NutritionFigure: four label and value pairs. The web
 * column lays them out in a two-column description list, the native column wraps them in a row.
 */
import { defineCard } from '../../../../src/cards/defineCard.js';

const FIGURES = [
    ['Calories', '420 kcal'],
    ['Protein', '32 g'],
    ['Carbs', '48 g'],
    ['Fat', '12 g'],
] as const;

export default defineCard({
    group: 'Recipes',
    height: 260,
    platforms: 'both',
    uses: ['NutritionFigure'],
    render: ({ NutritionFigure }, { platform }) =>
        platform === 'web' ? (
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, margin: 0, maxWidth: 320 }}>
                {FIGURES.map(([label, value]) => (
                    <NutritionFigure key={label} label={label} value={value} />
                ))}
            </dl>
        ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', rowGap: 16 }}>
                {FIGURES.map(([label, value]) => (
                    <NutritionFigure key={label} label={label} value={value} />
                ))}
            </div>
        ),
});
