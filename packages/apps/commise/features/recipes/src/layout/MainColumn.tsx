'use client';

/**
 * @module @commise/features-recipes/layout — `MainColumn` (web): a content column that is its OWN `main` container.
 * The shell's `<main>` is the `main` container for the pages it pads; a page that draws its own gutter inside an
 * unpadded `<main>` (a focused task: the recipe editor) wraps its padded column in this, so the column's content box is
 * the width its content gets. Both readers then measure that one box: the `@regular/main:` and `@wide/main:`
 * variants in CSS (the nearest ancestor container NAMED `main`), and the container class a script reads
 * (`MainElementContext`, which this hands its own element to). Without it the editor read the whole `<main>`, so a
 * 620 px window (572 px of content) was `regular` there and `narrow` on the food page.
 *
 * Presentational: a `div` and a context provider; no data, no side effect beyond holding its own element.
 *
 * @pattern Provider — hands its own element to `MainElementContext`, the way the shell hands its `<main>`
 * @pattern Responsive layout by container query — the column answers to its own box, not the window's or `<main>`'s
 */
import { MainElementContext } from '@commise/ui/main-element';
import { useState, type FC, type ReactNode } from 'react';

/** Props for {@link MainColumn}. */
export interface MainColumnProps {
    /** Classes for the column: its layout and its gutter. `@container/main` is added. */
    readonly className?: string;
    readonly children: ReactNode;
}

/** A column that is the `main` container its content measures. */
export const MainColumn: FC<MainColumnProps> = ({ className = '', children }) => {
    // Held as state by a callback ref, so a provider value change re-renders its readers (the shell does the same).
    const [column, setColumn] = useState<HTMLDivElement | null>(null);

    return (
        <div ref={setColumn} className={`@container/main ${className}`.trimEnd()}>
            <MainElementContext value={column}>{children}</MainElementContext>
        </div>
    );
};
