/**
 * @module @commise/features-core — Home widget surface contract (Commise product; NOT the platform recipe-core).
 *
 * The Home-screen widget surface is a Commise **product** concern and lives in
 * `@commise/features-core` (`packages/apps/commise/features/core`), NOT in the
 * platform `@kitchensink/recipe-core` package. Keeping it here prevents the
 * recipe-domain DTOs from leaking a product/UI composition concern. Pure TS
 * types + zod only — no runtime dependencies.
 */

// @ts-expect-error -- Design artifact imports zod as a package dependency of @commise/features-core.
import { z } from 'zod';

/**
 * Stable identifier for a Home-screen widget (US-0 / FR-046). Each feature owns
 * its own widget id; the id is the anti-drift keystone shared by the three
 * layers of the Home surface — discovery (explicit startup registration),
 * composition ({@link CurateHomeWidgets}), and render (`React.lazy(load)` +
 * `Suspense` + a per-widget `ErrorBoundary`). In v1 the recipe widget is the
 * **only** live widget; gated widgets (backed by 005–009) are **ABSENT** — not
 * present-with-empty-state — and are added, each with its own loader, when its
 * feature package ships, at which point they auto-appear. Consumers MUST skip
 * unknown ids so an older client tolerates a newer server (graceful version
 * skew). See `research/home-widget-architecture.md` (DECISION section).
 */
export type HomeWidgetId = string;

/**
 * Runtime validator for {@link HomeWidgetId}.
 */
export const homeWidgetIdSchema = z.string().min(1);

/**
 * Lazy loader for a widget's platform component module — the "loader seam". It
 * resolves the dynamic import of a feature package's `./widget/web` or
 * `./widget/mobile` entry (never a component directly), so the render layer can
 * wrap it in `React.lazy` + `Suspense` + an `ErrorBoundary`, and so a widget can
 * later become a Module Federation remote one line at a time. Descriptors are
 * only registered for feature packages that exist; v1 registers just the recipe
 * widget's loader.
 */
export type HomeWidgetLoader = () => Promise<{ default: unknown }>;

/**
 * Descriptor a feature contributes for its Home widget via explicit startup
 * registration (the discovery layer). Colocated with the feature, so adding a
 * feature package makes its widget eligible without editing a central registry.
 */
export interface HomeWidgetDescriptor {
    id: HomeWidgetId;
    /** The loader seam; see {@link HomeWidgetLoader}. */
    load: HomeWidgetLoader;
    /**
     * Default ordering weight used when the viewer has no personalization
     * override for this widget; higher weights sort earlier.
     */
    defaultWeight: number;
    /**
     * Capability flag gating the widget on whether its backing service is live.
     * When the capability is absent from the viewer's live capabilities, the
     * widget is omitted **entirely** (ABSENT, not rendered as an empty tile).
     * This is what lets Home ship in v1 with only the recipe widget live while
     * gated widgets light up automatically as their services deploy.
     */
    capability?: string;
    /** Minimum subscription tier required for the widget to be eligible. */
    minTier?: string;
}

/**
 * Runtime validator for {@link HomeWidgetDescriptor}. The `load` seam is a
 * function, so it is validated structurally (`z.function` is not serializable);
 * the data fields carry the meaningful constraints.
 */
export const homeWidgetDescriptorSchema = z.object({
    id: homeWidgetIdSchema,
    load: z.custom<HomeWidgetLoader>((value: unknown) => typeof value === 'function', {
        message: 'load must be a HomeWidgetLoader function',
    }),
    defaultWeight: z.number().finite(),
    capability: z.string().min(1).optional(),
    minTier: z.string().min(1).optional(),
});

/**
 * Per-viewer curation context for {@link CurateHomeWidgets}: which capabilities
 * (backing services) are live, the viewer's subscription tier, and their
 * persisted personalization layout. The layout (`order` + `hidden`) is loaded
 * from and saved via `PATCH /v1/profiles/me`, which is **owned by the
 * identity service (002)** and merely **consumed** here — 001 does not own that
 * endpoint or a `home_layouts` store — the layout lives in the identity profile preferences (`profiles.preferences.homeLayout`).
 */
export interface HomeWidgetCurationContext {
    liveCapabilities: string[];
    tier?: string;
    order?: HomeWidgetId[];
    hidden?: HomeWidgetId[];
}

/**
 * Runtime validator for {@link HomeWidgetCurationContext}.
 */
export const homeWidgetCurationContextSchema = z.object({
    liveCapabilities: z.array(z.string().min(1)),
    tier: z.string().min(1).optional(),
    order: z.array(homeWidgetIdSchema).optional(),
    hidden: z.array(homeWidgetIdSchema).optional(),
});

/**
 * Pure composition step (L2): given the registered descriptors and a viewer
 * context, return the ordered, capability- and tier-gated list of widgets to
 * render. A descriptor is dropped when its `capability` is not in
 * `liveCapabilities`, its `minTier` exceeds the viewer's tier, or its id is in
 * `hidden`; the survivors are ordered by the viewer's `order` and then by
 * `defaultWeight`. No side effects.
 */
export type CurateHomeWidgets = (
    widgets: readonly HomeWidgetDescriptor[],
    ctx: HomeWidgetCurationContext,
) => HomeWidgetDescriptor[];
