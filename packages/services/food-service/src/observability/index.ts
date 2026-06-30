/**
 * Named barrel for the worker observability domain (T-181 EMF metrics). Named-only (no `export *`) per
 * the project's barrel convention.
 */
export { buildEmf, emitMetric, FoodMetrics, FOOD_METRIC, FOOD_METRIC_NAMESPACE } from './emf-metrics.js';
export type { EmfInput, EmfPayload, EmfMetricDirective, MetricDatum, MetricUnit } from './emf-metrics.js';
