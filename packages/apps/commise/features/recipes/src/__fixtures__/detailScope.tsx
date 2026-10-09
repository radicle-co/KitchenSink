/**
 * @module @commise/features-recipes — a recipe page's scope for a web test, as the app mounts it: the page's scroll host
 * (`RecipeDetailContainer`'s `ScrollHost`, which the section switch jumps through) around the session's cook-marks scope.
 */
import { ScrollHost } from '@commise/ui/scroll-host';
import type { FC, ReactNode } from 'react';

import { CookMarksTestProvider } from './cookMarks.js';

/** A test's recipe page: one scroll host, one cook, one fresh cook-marks store. */
export const DetailTestScope: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <ScrollHost>
        <CookMarksTestProvider>{children}</CookMarksTestProvider>
    </ScrollHost>
);
