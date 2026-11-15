/**
 * The root text scale a spec applies: from a reflow project's `metadata` (`variantSurfaceReflow.spec.ts`), or a fixed
 * scale at a width no project has (a cooking-mode spec at 390 px and 200%). The theme sizes text and spacing in rem, so a
 * root font of N% grows both, as browser text zoom does.
 *
 * The parameters are the narrow shapes the functions read, so a test double needs no cast; Playwright's `TestInfo` and
 * `Page` satisfy them.
 */

/** What {@link textScaleOf} reads of a Playwright `TestInfo`. */
export interface TextScaleTestInfo {
    readonly project: { readonly metadata: Readonly<Record<string, unknown>> };
}

/** What {@link applyTextScale} calls on a Playwright `Page`. */
export interface StyleTagPage {
    readonly addStyleTag: (options: { readonly content: string }) => Promise<unknown>;
}

/** The root font scale a reflow project sets in its `metadata` (1 when absent). */
export function textScaleOf(testInfo: TextScaleTestInfo): number {
    const scale: unknown = testInfo.project.metadata['textScale'];

    return typeof scale === 'number' ? scale : 1;
}

/** Apply a text scale to the page as it stands; the style survives client-side navigation. */
export async function applyTextScale(page: StyleTagPage, scale: number): Promise<void> {
    if (scale !== 1) {
        await page.addStyleTag({ content: `html { font-size: ${String(scale * 100)}% !important; }` });
    }
}
