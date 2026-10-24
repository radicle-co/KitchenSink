/**
 * @module @commise/features-recipes — one per-serving nutrition figure on the web recipe page (build spec §6.1): the
 * value in `figureStat` over its `caption` label, as a `dt`/`dd` pair in the section's list. Presentational.
 */
import type { FC } from 'react';

/** Props for {@link NutritionFigure}. */
export interface NutritionFigureProps {
    /** The figure's name ("Protein"). */
    readonly label: string;
    /** The figure, per serving ("32 g"). */
    readonly value: string;
}

/** The web nutrition figure. */
export const NutritionFigure: FC<NutritionFigureProps> = ({ label, value }) => (
    <div className="flex flex-col-reverse gap-1">
        <dt className="text-caption text-ink-muted">{label}</dt>
        <dd className="text-figure-stat text-ink">{value}</dd>
    </div>
);
