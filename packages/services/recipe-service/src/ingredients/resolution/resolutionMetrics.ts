/**
 * The ONE CloudWatch namespace every recipe-resolution metric is published under: mapping promotions, rung-less catalog
 * hits, and a curated mapping the paste review contradicted (ADR-0071). One constant, so a dashboard or an alarm that
 * reads the namespace cannot miss a metric a second spelling would have filed elsewhere.
 */
export const RECIPE_RESOLUTION_NAMESPACE = 'Commise/RecipeResolution';
