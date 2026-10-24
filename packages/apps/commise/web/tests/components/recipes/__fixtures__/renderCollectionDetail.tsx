/**
 * Render a collection surface the way the app does: inside the one `SnackbarHost` the shell mounts, because the removal
 * and visibility Undo snackbars (and Save a copy's Edit) need it. `renderWithRecipeClient` supplies the query, client and
 * locale providers; this adds the host.
 */
import { SnackbarHost } from '@commise/ui/snackbar';
import { renderWithRecipeClient, type RenderWithRecipeClientOptions } from '@commise/test-utils';
import type { RecipeServiceClient } from '@kitchensink/recipe-service-client';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

/** The Radix menu calls APIs jsdom lacks. */
if (typeof Element !== 'undefined') {
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

/**
 * @param ui - The container under test.
 * @param client - The (fake) recipe-service client.
 * @param options - Locale and query-client overrides.
 * @returns RTL's render result.
 */
export function renderWithSnackbar(
    ui: ReactElement,
    client: RecipeServiceClient,
    options?: RenderWithRecipeClientOptions,
): RenderResult {
    return renderWithRecipeClient(<SnackbarHost>{ui}</SnackbarHost>, client, options);
}
