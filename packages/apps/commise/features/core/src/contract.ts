/**
 * @module @commise/features-core — Home widget surface contract (Commise product; NOT the platform recipe-core).
 *
 * The Home-screen widget surface is a Commise **product** concern and lives in
 * `@commise/features-core` (`packages/apps/commise/features/core`), NOT in the
 * platform `@kitchensink/recipe-core` package. Keeping it here prevents the
 * recipe-domain DTOs from leaking a product/UI composition concern. Pure TS
 * types + zod only — no runtime dependencies.
 */

import { z } from 'zod';

/**
 * Stable identifier for a Home-screen widget (US-0 / FR-046). Each feature owns
 * its own widget id; the id is the anti-drift keystone shared by the three
 * layers of the Home surface — discovery (explicit startup registration),
 * composition ({@link CurateHomeWidgets}), and render (`React.lazy(load)` +
 * `Suspense` + a per-widget `ErrorBoundary`).
 *
 * In v1 the recipe widget is the only **live** widget. A widget whose backing
 * feature (005–009) has not shipped is **NOT absent**: it is registered as a
 * {@link PlaceholderHomeWidgetDescriptor} and rendered as a **skeleton
 * placeholder** — the real widget's shape with skeleton blocks where data would
 * be, and **never fake data** (a hard-coded "1,240 of 2,000 cal" reads as real).
 * See CR-001, which amends R6's original "gated widgets are ABSENT" rule: the
 * objection that rule answered was that `import()`ing an unbuilt package fails
 * the build, and a placeholder dissolves it by being drawn from a loader the
 * HOST owns, importing nothing from the unbuilt package.
 *
 * The id is what makes the transition self-superseding: when the real feature
 * ships it registers a live descriptor under the SAME id, and because the two
 * arms are mutually exclusive on the capability ({@link CurateHomeWidgets}),
 * exactly one is ever eligible. Consumers MUST skip unknown ids so an older
 * client tolerates a newer server (graceful version skew). See
 * `research/home-widget-architecture.md` (DECISION section).
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
 * Fields every Home widget descriptor carries, whichever arm it is.
 */
interface HomeWidgetDescriptorBase {
    /** The widget's stable id; see {@link HomeWidgetId}. */
    id: HomeWidgetId;
    /** The loader seam; see {@link HomeWidgetLoader}. */
    load: HomeWidgetLoader;
    /**
     * Default ordering weight used when the viewer has no personalization
     * override for this widget; higher weights sort earlier.
     */
    defaultWeight: number;
    /** Minimum subscription tier required for the widget to be eligible. */
    minTier?: string;
}

/**
 * A **real** widget, contributed by a feature package that exists, whose loader
 * resolves that feature's platform widget module. Eligible only when its
 * `capability` is live (a live widget with no backing service would render an
 * error, not a view).
 *
 * The discriminant is **optional** here so that a bare `{ id, load,
 * defaultWeight }` descriptor — the shape every feature already ships — remains
 * a valid live descriptor. Live is the default; a descriptor must opt IN to
 * being a placeholder.
 */
export interface LiveHomeWidgetDescriptor extends HomeWidgetDescriptorBase {
    /** Discriminant. Omitted or `'live'` both mean "a real widget". */
    kind?: 'live';
    /**
     * Capability flag gating the widget on whether its backing service is live.
     * Absent means "always eligible" (no backing service to wait on).
     */
    capability?: string;
}

/**
 * A **skeleton placeholder** standing in for a widget whose backing feature
 * (005–009) has not shipped: the real widget's layout with skeleton blocks where
 * data would be. Its loader resolves a HOST-owned skeleton component, so it
 * imports nothing from the unbuilt feature package.
 *
 * `capability` is **required** on this arm, and that is the point of the union:
 * a placeholder is *defined* by the capability it is waiting on, so a
 * placeholder that waits on nothing — one that could never be superseded, and
 * would sit on Home forever — is unrepresentable rather than merely discouraged.
 */
export interface PlaceholderHomeWidgetDescriptor extends HomeWidgetDescriptorBase {
    /** Discriminant. Required — a placeholder must opt in explicitly. */
    kind: 'placeholder';
    /**
     * The capability this placeholder is waiting on. The placeholder is eligible
     * **only while this capability is NOT live**; the moment the real feature's
     * service deploys, this placeholder gates itself out and the feature's live
     * descriptor (same id) takes over. See {@link CurateHomeWidgets}.
     */
    capability: string;
}

/**
 * Descriptor a feature contributes for its Home widget via explicit startup
 * registration (the discovery layer). Colocated with the feature, so adding a
 * feature package makes its widget eligible without editing a central registry —
 * except for {@link PlaceholderHomeWidgetDescriptor}s, which by definition
 * cannot be colocated with a package that does not exist yet and are declared in
 * `roadmapWidgets.ts` instead.
 */
export type HomeWidgetDescriptor = LiveHomeWidgetDescriptor | PlaceholderHomeWidgetDescriptor;

/**
 * Whether `descriptor` is a skeleton placeholder for an unshipped feature.
 *
 * @param descriptor - The descriptor to classify.
 * @returns True when the descriptor is the placeholder arm of the union.
 */
export function isPlaceholderHomeWidget(
    descriptor: HomeWidgetDescriptor,
): descriptor is PlaceholderHomeWidgetDescriptor {
    return descriptor.kind === 'placeholder';
}

/**
 * Whether `descriptor` is a real (live) widget. A descriptor with no `kind` is
 * live — live is the default arm.
 *
 * @param descriptor - The descriptor to classify.
 * @returns True when the descriptor is the live arm of the union.
 */
export function isLiveHomeWidget(descriptor: HomeWidgetDescriptor): descriptor is LiveHomeWidgetDescriptor {
    return !isPlaceholderHomeWidget(descriptor);
}

/** Runtime validator for the loader seam (a function; `z.function` is not serializable). */
const homeWidgetLoaderSchema = z.custom<HomeWidgetLoader>((value: unknown) => typeof value === 'function', {
    message: 'load must be a HomeWidgetLoader function',
});

/** Fields shared by both arms of {@link homeWidgetDescriptorSchema}. */
const homeWidgetDescriptorBaseShape = {
    id: homeWidgetIdSchema,
    load: homeWidgetLoaderSchema,
    defaultWeight: z.number().finite(),
    minTier: z.string().min(1).optional(),
};

/** Runtime validator for {@link LiveHomeWidgetDescriptor}. */
export const liveHomeWidgetDescriptorSchema = z.object({
    ...homeWidgetDescriptorBaseShape,
    kind: z.literal('live').optional(),
    capability: z.string().min(1).optional(),
});

/** Runtime validator for {@link PlaceholderHomeWidgetDescriptor}. */
export const placeholderHomeWidgetDescriptorSchema = z.object({
    ...homeWidgetDescriptorBaseShape,
    kind: z.literal('placeholder'),
    // Required — mirrors the type-level invariant that a placeholder waits on something.
    capability: z.string().min(1),
});

/**
 * Runtime validator for {@link HomeWidgetDescriptor}. A plain `z.union` (not
 * `z.discriminatedUnion`) because the live arm's discriminant is optional, which
 * a discriminated union cannot express; the arms are still mutually exclusive on
 * `kind`, so at most one ever matches.
 */
export const homeWidgetDescriptorSchema = z.union([
    placeholderHomeWidgetDescriptorSchema,
    liveHomeWidgetDescriptorSchema,
]);

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
 * render. No side effects.
 *
 * Gating, in order:
 *  - **hidden** — a descriptor whose id is in `hidden` is dropped (both arms).
 *  - **tier** — a descriptor whose `minTier` outranks the viewer's tier is
 *    dropped (both arms; an unrecognized tier fails closed).
 *  - **capability** — the two arms are gated **inversely**, and this is the
 *    keystone of the placeholder design:
 *      - a {@link LiveHomeWidgetDescriptor} is eligible only when its
 *        `capability` **is** live (or it declares none);
 *      - a {@link PlaceholderHomeWidgetDescriptor} is eligible only when its
 *        `capability` is **not** live.
 *    So for any one capability the arms are mutually exclusive: registering a
 *    roadmap placeholder and the real feature's widget under the same id can
 *    never yield two tiles, and the placeholder self-supersedes the moment the
 *    backing service deploys — no coordinated edit, no flag flip.
 *
 * Survivors are ordered by the viewer's `order` and then by `defaultWeight`.
 */
export type CurateHomeWidgets = (
    widgets: readonly HomeWidgetDescriptor[],
    ctx: HomeWidgetCurationContext,
) => HomeWidgetDescriptor[];
