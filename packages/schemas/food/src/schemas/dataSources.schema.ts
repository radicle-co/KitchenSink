/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the food (ingredient) service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/food-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/food-service/src/foods/dataSources.schema.ts

/**
 * WIRE CONTRACT for `GET /api/v1/foods/sources` — the data the Data sources page shows (plan R55, design §S16).
 * Authored here and copied into `@kitchensink/schema-food` (`docs/CODING_STANDARDS.md` §15.2).
 *
 * It lists only the sources a stored nutrition value cites, never a registered source the catalog does not use
 * (owner, 2026-10-01). The service decides that, so no client filters. Each entry carries every word the page shows,
 * because the page never maps an id to a name, a licence or a language itself: that would be a second register, kept
 * by hand (§S16).
 *
 * ⛔ The response is CALLER-INDEPENDENT. It reads only catalog citations, and an authored food's numbers cite nothing
 * (ADR-0029), so no caller's own data can enter it. An edge cache keyed on the URL alone would stay correct, and
 * anything added here must keep that true.
 */
import { z } from 'zod';

/** One source a stored value cites, as the page shows it. */
export const dataSourceViewSchema = z.object({
    /**
     * The register's id, for a list key only. A plain string, not a closed enum: a released mobile binary must still
     * render a source that was registered after it shipped.
     */
    id: z.string().min(1),
    /** What a cook knows the source by, the card heading. Absent when the source has none; then `name` heads it. */
    shortName: z.string().min(1).optional(),
    /** The source's full name. */
    name: z.string().min(1),
    publisher: z.string().min(1),
    /** The edition the catalog's numbers come from, in the publisher's own words. */
    edition: z.string().min(1),
    /** The licence's own title, the licence link's text. */
    licenceName: z.string().min(1),
    /** A web link only: both links render as an `href`, so a `javascript:` or `data:` link would run in the page. */
    licenceUrl: z.httpUrl(),
    /** The credit the licence requires, word for word. ⛔ A client never translates, re-cases or shortens it. */
    attribution: z.string().min(1),
    /** The attribution's BCP 47 language, so a page can mark a credit not in its own language (WCAG 2.2 SC 3.1.2). */
    attributionLanguage: z.string().min(1),
    homepage: z.httpUrl(),
    /**
     * Whether some value the catalog stores from this source was converted on the way in: a per-100 mL value to
     * per 100 g by a density, or kJ to kcal (R54). CC BY 4.0 §3(a)(1)(B) requires saying so.
     */
    converted: z.boolean(),
});

export type DataSourceView = z.infer<typeof dataSourceViewSchema>;

/** Body for `GET /api/v1/foods/sources`: the cited sources, in the register's order. Empty when nothing is cited. */
export const dataSourcesResponseSchema = z.object({
    sources: z.array(dataSourceViewSchema),
});

export type DataSourcesResponse = z.infer<typeof dataSourcesResponseSchema>;
