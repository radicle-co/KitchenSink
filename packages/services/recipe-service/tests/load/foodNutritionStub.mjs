/**
 * A stand-in for the food service's `GET /api/v1/foods/nutrition?ids=…`, so the recipe service's FAN-OUT
 * can be measured without booting food and its database.
 *
 * ## Why the k6 nutrition scenario needs this at all
 *
 * The deferred batch's cost is `waves × foodLatency`, and both factors are on the far side of a service
 * boundary. Against an UNREACHABLE food origin the connection is refused in microseconds, so every wave is
 * free and the scenario reports a fan-out cost of roughly zero — a second way to measure nothing at the
 * cap. Booting the real food service would import its schema, its USDA-shaped seed data and a second
 * database into a job that is measuring the RECIPE side; this answers food's published shape with a stated,
 * configurable latency instead, which makes the measured number a function of one assumption you can read
 * off the command line.
 *
 * ⚠️ SO THE p95 IT PRODUCES IS "recipe's own cost + waves × FOOD_STUB_DELAY_MS", NOT a production figure.
 * It is the right instrument for the question ADR-0021 asks — does the wave count fit the budget — and the
 * wrong one for "how fast is this in prod", which needs a real food origin. Sweep the delay rather than
 * trusting one value: the slope IS the fan-out cost, and the intercept is everything else.
 *
 * ## What it deliberately does NOT do
 *
 * - **No auth.** Recipe forwards the caller's bearer (`CallerToken`); verifying it here would reimplement
 *   Clerk to no end. The stub therefore proves nothing about authorization, and nothing here should be
 *   read as if it did.
 * - **No cache.** Every request pays the delay, because the thing under test is how many round trips one
 *   batch costs — a stub that answered the second wave instantly would hide exactly that.
 *
 * ## What it DOES assert
 *
 * The 100-id cap, with a `400` — food's real behaviour (`MAX_NUTRITION_IDS`, `@kitchensink/schema-food`).
 * If the recipe gateway ever stops chunking, the batch fails loudly here instead of getting quietly faster.
 *
 * `GET /__stats` reports `{ requests, ids, maxIdsInOneRequest, overCapRequests }` since the last
 * `POST /__stats/reset` — the evidence that the fan-out actually happened, in chunk counts rather than
 * inference. A 500-recipe zero-overlap batch must show 50 requests of 100 ids each.
 *
 * Usage:
 *   FOOD_STUB_PORT=3002 FOOD_STUB_DELAY_MS=25 node tests/load/foodNutritionStub.mjs
 *
 * @sideEffect Binds a TCP port and serves HTTP until killed.
 */
import { createServer } from 'node:http';

/** Food's published per-request id cap (`MAX_NUTRITION_IDS`). Mirrored, and enforced, on purpose. */
const MAX_NUTRITION_IDS = 100;

const PORT = Number(process.env['FOOD_STUB_PORT'] ?? 3002);
const HOST = process.env['FOOD_STUB_HOST'] ?? '127.0.0.1';

/**
 * Latency this stub adds to every nutrition response, standing in for food's own service time.
 *
 * The default is the ORDER of a warm same-region batch read, not a measurement of one: food budgets a
 * single golden-record read at 50ms p95 (SC-001) and answers `?ids=` from a three-query view. Whatever it
 * is set to, the run's number must be reported WITH it — the p95 is a function of this value.
 */
const DELAY_MS = Number(process.env['FOOD_STUB_DELAY_MS'] ?? 25);

const stats = { requests: 0, ids: 0, maxIdsInOneRequest: 0, overCapRequests: 0 };

/**
 * One food's per-100g nutrition, derived from its id so the response is deterministic and every id yields
 * a positive calorie figure — a `0` would be indistinguishable from "food had nothing", which is precisely
 * the confusion the wire union exists to prevent. Pure.
 */
function nutritionFor(id) {
    return {
        id,
        status: 'RESOLVED',
        caloriesPer100g: 200,
        proteinGPer100g: 10,
        carbsGPer100g: 20,
        fatGPer100g: 8,
        portions: [{ unit: 'cup', gramsPerUnit: 120 }],
    };
}

/** Send a JSON body. */
function json(res, status, body) {
    const payload = JSON.stringify(body);

    res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
    res.end(payload);
}

const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

    if (url.pathname === '/__stats' && req.method === 'GET') {
        json(res, 200, stats);

        return;
    }

    if (url.pathname === '/__stats/reset') {
        Object.assign(stats, { requests: 0, ids: 0, maxIdsInOneRequest: 0, overCapRequests: 0 });
        json(res, 200, stats);

        return;
    }

    if (url.pathname === '/health') {
        json(res, 200, { status: 'ok' });

        return;
    }

    if (url.pathname !== '/api/v1/foods/nutrition') {
        json(res, 404, { message: 'not found' });

        return;
    }

    const ids = (url.searchParams.get('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);

    stats.requests += 1;
    stats.ids += ids.length;
    stats.maxIdsInOneRequest = Math.max(stats.maxIdsInOneRequest, ids.length);

    if (ids.length === 0) {
        json(res, 400, { message: 'ids is required' });

        return;
    }

    if (ids.length > MAX_NUTRITION_IDS) {
        // Food's real answer, and the reason it is worth reproducing: a recipe gateway that stopped
        // chunking would otherwise show up as a FASTER run rather than a broken one.
        stats.overCapRequests += 1;
        json(res, 400, { message: `at most ${MAX_NUTRITION_IDS} ids per request` });

        return;
    }

    setTimeout(() => {
        json(res, 200, { foods: ids.map(nutritionFor), unknownIds: [] });
    }, DELAY_MS);
});

server.listen(PORT, HOST, () => {
    console.log(`foodNutritionStub: http://${HOST}:${PORT} (delay ${DELAY_MS}ms, cap ${MAX_NUTRITION_IDS} ids)`);
});
