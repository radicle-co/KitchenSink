// Shared configuration + load-shape helpers for the food-service k6 load suite.
//
// These modules are ES-module JavaScript executed by the **k6 binary** (`k6 run ...`) — they are NOT part
// of the vitest suite and must only import from k6's built-in modules (`k6`, `k6/http`, `k6/metrics`,
// `k6/data`). All target/credential configuration is read from the environment via k6's `__ENV`.
//
// Mirrors `packages/services/recipe-service/tests/load/lib/common.js`. The food k6 suite currently has one
// scenario (`service-erasure.load.js`), so this keeps only the shared base-URL + ramping load-shape; add
// payload/fixture helpers here as the food load suite grows, the same way the recipe common.js carries its
// recipe payload factory.

// Base URL of the food-service under test (Nest app / ALB host). Defaults to the local dev port.
export const BASE_URL = (__ENV['FOOD_API_BASE_URL'] || 'http://localhost:3000').replace(/\/+$/, '');

// --- Load shape ---------------------------------------------------------------------------------
// A single k6 runner cannot honestly generate a production-scale peak, so it is env-driven: CI runs a safe
// smoke value and a true validation supplies a high FOOD_LOAD_PEAK_VUS from a distributed / k6 Cloud run.
export const PEAK_VUS = Number(__ENV['FOOD_LOAD_PEAK_VUS'] || 50);
export const RAMP_UP = __ENV['FOOD_LOAD_RAMP_UP'] || '30s';
export const HOLD = __ENV['FOOD_LOAD_HOLD'] || '1m';
export const RAMP_DOWN = __ENV['FOOD_LOAD_RAMP_DOWN'] || '15s';

// A ramping-vus stage set to the given peak. Shared by every scenario so load shape stays uniform.
export function rampStages(peak) {
    return [
        { duration: RAMP_UP, target: peak },
        { duration: HOLD, target: peak },
        { duration: RAMP_DOWN, target: 0 },
    ];
}
