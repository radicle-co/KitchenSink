# Architecture 1: Full Local Mirror

## Metadata

| Field    | Value              |
| -------- | ------------------ |
| Status   | Proposal           |
| Date     | 2026-04-07         |
| Author   | AI-Generated       |
| Replaces | N/A (new proposal) |
| Ticket   | TBD                |

---

## Executive Summary

This architecture eliminates all runtime dependency on the USDA FoodData Central API by treating FDC as a dataset rather than a service. A scheduled ingestion pipeline downloads the full bulk CSV export (~458 MB compressed, ~3.1 GB uncompressed), parses it, and loads it into a self-hosted PostgreSQL database on AWS RDS. The application API layer queries this local database exclusively, making food lookups fast, predictable, and immune to external rate limits or outages.

The primary trade-off is cost and operational complexity. You pay for always-on infrastructure — roughly $80 to $100/month at minimum — and you own the ingestion pipeline. In return, you get sub-millisecond database lookups, full-text search via `pg_trgm`, unlimited query volume, and complete control over schema evolution. The USDA's CC0 license means there are no legal restrictions on redistributing or storing this data.

This is the right choice when your recipe application expects meaningful query volume (above 100K food lookups per day), needs advanced filtering, or simply cannot tolerate the unpredictability of a third-party API sitting in the hot path of user-facing requests.

---

## Context & Problem Statement

The USDA FoodData Central (FDC) API is the canonical source for food and nutrition data in the United States. It covers roughly 330K food items across five data types, with rich nutrient profiles, portion sizes, and brand information. For a recipe application, this data is foundational.

The API has a hard rate limit of **1,000 requests per hour per IP**. At 1 request per food lookup, a recipe app with modest traffic can exhaust this budget in minutes. Beyond the rate limit, the API introduces several structural problems for a production recipe application:

- **Latency unpredictability.** External API calls add 100–500ms of tail latency that you cannot control or optimize.
- **No batch delta endpoint.** There's no changelog or diff feed. Detecting what changed requires either a full re-download or paginating through the entire catalog.
- **Single point of external failure.** Any FDC outage, planned or unplanned, directly degrades your users' experience.
- **No full-text search control.** The API's search is adequate but not tunable. You can't adjust ranking, add custom synonyms, or combine nutrition filters with text queries efficiently.

The dataset itself mitigates all of these problems. The FDC bulk downloads are available at `https://fdc.nal.usda.gov/fdc-datasets/` under a CC0 (public domain) license. Foundation and SR Legacy data updates twice per year. Branded food data updates monthly. Survey/FNDDS data is largely static. Downloading and owning this data locally turns a fragile runtime dependency into a scheduled batch operation.

---

## Architecture Overview

The core idea is a clean separation between **data acquisition** (an async, scheduled pipeline) and **data serving** (a synchronous, low-latency API path). Nothing in the user-facing request path ever touches an external service.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA INGESTION PATH                         │
│                       (runs on schedule)                            │
│                                                                      │
│  EventBridge          Step Functions        ECS Fargate Task         │
│  (cron schedule) ──► (orchestration) ──►  (download + parse + load) │
│                                                   │                  │
│                                                   ▼                  │
│                                          S3 Bucket                  │
│                                     (raw CSV staging)               │
│                                                   │                  │
│                                                   ▼                  │
│                                          RDS PostgreSQL              │
│                                         (primary store)             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         USER REQUEST PATH                           │
│                        (synchronous, fast)                          │
│                                                                      │
│  Client ──► API Gateway ──► ECS Fargate (API) ──► ElastiCache Redis │
│                                                         │ miss       │
│                                                         ▼            │
│                                               RDS PostgreSQL         │
│                                            (via RDS Proxy)          │
└─────────────────────────────────────────────────────────────────────┘
```

**Key architectural decision:** FDC is treated as a versioned dataset, not a live service. The ingestion pipeline is the only component that ever contacts USDA servers. The API application has zero knowledge of FDC's existence — it only knows about your PostgreSQL schema.

---

## System Components

### 1. Data Ingestion Pipeline

The ingestion pipeline runs on a schedule, downloads the FDC bulk export, and loads it into PostgreSQL. It is entirely separate from the API serving path and has no user-facing latency requirements.

**AWS Services:**

- **Amazon EventBridge** — Cron-based scheduler triggers the pipeline. Foundation/SR Legacy runs twice yearly; Branded runs monthly.
- **AWS Step Functions** — Orchestrates the multi-step ingestion workflow with built-in retry logic, error handling, and execution history.
- **Amazon ECS Fargate** — Runs the actual download, parse, and load task. A Fargate task is preferred over Lambda because the full 3.1 GB uncompressed CSV exceeds Lambda's 512 MB `/tmp` storage and 15-minute timeout.
- **Amazon S3** — Staging bucket for raw downloaded files. Acts as a checkpoint between download and parse phases, enabling reruns without re-downloading.

**Workflow sequence:**

1. EventBridge fires a scheduled rule.
2. Step Functions starts a new execution, launching an ECS Fargate task.
3. The Fargate task downloads the zip from `https://fdc.nal.usda.gov/fdc-datasets/`.
4. The downloaded zip is stored in S3 (staging bucket, lifecycle: 30 days).
5. The task extracts and parses CSV files from the zip.
6. Data is loaded into RDS PostgreSQL using `COPY` or batched `INSERT` with upsert (`ON CONFLICT DO UPDATE`).
7. A Redis warm-up pass populates cache entries for the top-N most-queried foods (sourced from CloudWatch metrics on the API layer).
8. Step Functions marks the execution complete; CloudWatch alarm resets.

**Error handling:**

- Step Functions retries transient failures (network errors, RDS connection timeouts) up to 3 times with exponential backoff.
- If all retries fail, the execution moves to a failure state and a CloudWatch alarm fires.
- The previous dataset remains live in PostgreSQL — a failed ingestion never takes down the serving path.
- A dead-letter SNS topic notifies on-call staff.

**Full dataset size:** 458 MB zipped, ~3.1 GB uncompressed CSV. A Fargate task with 4 vCPU / 8 GB RAM can parse and load the full dataset in approximately 20–40 minutes.

---

### 2. PostgreSQL Database (RDS)

RDS PostgreSQL is the single source of truth for all food and nutrition data. It's sized conservatively for the expected data volume and query patterns, with room to scale vertically or add read replicas.

**Instance configuration:**

- **Instance type:** `db.t4g.medium` (2 vCPU, 4 GB RAM, ARM-based Graviton2)
- **Storage:** 20 GB `gp3`, expandable to 64 TB with zero downtime
- **PostgreSQL version:** 16.x (latest stable)
- **Parameter group:** `enable_pg_trgm = on`, `work_mem = 32MB`, `shared_buffers = 1GB`
- **Multi-AZ:** Optional for production; adds ~$50/mo but provides automatic failover

**Estimated data volume:**

- `foods` table: ~330K rows
- `food_nutrients` table: ~15M rows (avg 45 nutrients per food)
- `food_portions` table: ~500K rows
- `nutrient_definitions` table: ~200 rows (static)
- Total database size with indexes: ~2 GB

**Search strategy:**
Full-text food search uses `pg_trgm` with a GIN index on `description`. This enables `LIKE '%query%'` and `ILIKE` searches with index support, avoiding sequential scans on 330K rows. Search queries run in under 5ms at p95 for typical 2–4 word inputs.

**Connection pooling:**
All application connections route through **RDS Proxy**, which pools and multiplexes connections to the RDS instance. This is critical for Lambda-based API deployments, which can open hundreds of concurrent connections under load. RDS Proxy maintains a warm connection pool and handles failover transparently.

---

### 3. Application API Layer

The API layer translates HTTP requests from the recipe application into PostgreSQL queries, with Redis as an intermediate cache layer.

**AWS Services:**

- **Amazon ECS Fargate** — Preferred for persistent, long-running API containers. Avoids Lambda cold starts and supports connection pooling natively.
- **AWS Lambda + API Gateway** — Alternative for very low traffic or cost-first deployments. Acceptable when RDS Proxy handles connection pooling.
- **Amazon API Gateway (HTTP API)** — Front door for all client requests. Handles TLS termination, throttling, and request/response logging.

**API surface:**

| Method | Path                     | Description                                       |
| ------ | ------------------------ | ------------------------------------------------- |
| GET    | `/api/v1/foods/{fdcId}`  | Retrieve a single food item with nutrients        |
| POST   | `/api/v1/foods`          | Batch lookup by fdcId array (up to 100 items)     |
| GET    | `/api/v1/foods/search`   | Full-text + filter search against PostgreSQL      |
| GET    | `/api/v1/foods/list`     | Paginated listing with dataType/brandOwner filter |
| GET    | `/api/v1/nutrients/{id}` | Nutrient definition lookup                        |

The batch endpoint accepts up to 100 `fdcId` values in a single request, enabling recipe apps to hydrate an entire ingredient list in one round trip.

**Auto-scaling:**
ECS Fargate tasks scale on CPU utilization (target 60%) and request count via Application Auto Scaling. Minimum 1 task, maximum 20 tasks. Scale-out triggers in ~90 seconds.

---

### 4. ElastiCache Redis

Redis sits between the API layer and PostgreSQL, caching serialized food item responses to avoid repeated database queries for popular foods.

**Instance configuration:**

- **Node type:** `cache.t4g.small` (1.37 GB memory, ARM-based Graviton2)
- **Engine:** Redis 7.x
- **Eviction policy:** `allkeys-lfu` (least-frequently-used eviction, appropriate for a working set where Foundation/SR Legacy foods are queried far more than long-tail Branded items)
- **Cluster mode:** Disabled (single-node is sufficient at this scale; enable cluster mode at >5GB working set)

**TTL strategy:**

| Data Type        | TTL      | Rationale                                              |
| ---------------- | -------- | ------------------------------------------------------ |
| Foundation foods | 180 days | Updates twice yearly; long TTL maximizes cache utility |
| SR Legacy foods  | Infinite | Dataset is frozen; never expires until manual flush    |
| Branded foods    | 7 days   | Monthly USDA updates; balance freshness vs. cache hits |
| Search results   | 24 hours | Search queries are high-variance; shorter TTL is safe  |
| Nutrient defs    | 30 days  | Rarely change; medium TTL                              |

A ±10% random jitter is applied to all TTLs to prevent cache stampede when a large cohort of entries expire simultaneously.

**Cache key schema:**

```
food:{fdcId}                  → serialized food + nutrients JSON
food:search:{sha256(query)}   → search results array
food:list:{dataType}:{page}   → paginated list results
nutrient:{nutrientId}         → nutrient definition
```

**Cache warm-up:**
After each successful ingestion run, the pipeline queries CloudWatch Logs Insights for the top 1,000 most-requested `fdcId` values over the prior 30 days and pre-populates cache entries for those items.

---

### 5. Monitoring & Observability

**Amazon CloudWatch:**

- RDS metrics: `CPUUtilization`, `DatabaseConnections`, `ReadLatency`, `WriteLatency`, `FreeStorageSpace`
- ElastiCache metrics: `CacheHitRate`, `CurrConnections`, `Evictions`, `BytesUsedForCache`
- ECS metrics: `CPUUtilization`, `MemoryUtilization`, `RunningTaskCount`
- API Gateway metrics: `Latency`, `4XXError`, `5XXError`, `Count`
- Custom metric: `food_cache_hit_ratio` (emitted by API layer on each request)

**Alarms:**

- RDS CPU > 80% for 5 minutes → SNS notification
- RDS FreeStorageSpace < 2 GB → SNS notification (critical)
- Cache hit rate < 60% for 1 hour → SNS notification (investigate eviction or cold cache)
- API 5XX error rate > 1% for 5 minutes → PagerDuty alert
- Step Functions ingestion execution FAILED → SNS notification

**RDS Performance Insights:**
Enabled on the RDS instance. Provides query-level performance data, wait event analysis, and top SQL identification. Retention: 7 days (free tier).

**Structured logging:**
The API layer emits JSON-structured logs to CloudWatch Logs with fields: `fdcId`, `dataType`, `cacheHit`, `queryDurationMs`, `statusCode`, `requestId`. CloudWatch Logs Insights queries aggregate cache hit ratios, slow queries, and error patterns.

---

## Data Model

The schema maps directly to the FDC CSV export structure. Five food types share a common `foods` table with a `data_type` discriminator column.

```sql
-- Core food items (all data types)
CREATE TABLE foods (
    fdc_id          INTEGER         PRIMARY KEY,
    description     TEXT            NOT NULL,
    data_type       TEXT            NOT NULL,  -- 'Branded', 'Foundation', 'SR Legacy', 'Survey (FNDDS)'
    food_category   TEXT,
    brand_owner     TEXT,
    brand_name      TEXT,
    gtin_upc        TEXT,
    ingredients     TEXT,
    serving_size    NUMERIC(10, 2),
    serving_size_unit TEXT,
    household_serving_fulltext TEXT,
    published_date  DATE,
    modified_date   DATE,
    available_date  DATE,
    market_country  TEXT,
    data_source     TEXT,
    created_at      TIMESTAMPTZ     DEFAULT NOW()
);

-- Nutrient definitions (static reference table, ~200 rows)
CREATE TABLE nutrient_definitions (
    nutrient_id     INTEGER         PRIMARY KEY,
    name            TEXT            NOT NULL,
    unit_name       TEXT            NOT NULL,  -- 'G', 'MG', 'KCAL', 'IU', etc.
    nutrient_nbr    TEXT,                      -- FDC nutrient number
    rank            INTEGER
);

-- Per-food nutrient amounts (~15M rows)
CREATE TABLE food_nutrients (
    id              BIGSERIAL       PRIMARY KEY,
    fdc_id          INTEGER         NOT NULL REFERENCES foods(fdc_id) ON DELETE CASCADE,
    nutrient_id     INTEGER         NOT NULL REFERENCES nutrient_definitions(nutrient_id),
    amount          NUMERIC(14, 4),
    data_points     INTEGER,
    derivation_code TEXT,
    derivation_description TEXT,
    min             NUMERIC(14, 4),
    max             NUMERIC(14, 4),
    median          NUMERIC(14, 4),
    UNIQUE (fdc_id, nutrient_id)
);

-- Portion/serving size definitions (~500K rows)
CREATE TABLE food_portions (
    id                  BIGSERIAL       PRIMARY KEY,
    fdc_id              INTEGER         NOT NULL REFERENCES foods(fdc_id) ON DELETE CASCADE,
    seq_num             INTEGER,
    amount              NUMERIC(10, 4),
    measure_unit_name   TEXT,
    portion_description TEXT,
    modifier            TEXT,
    gram_weight         NUMERIC(10, 4)  NOT NULL,
    data_points         INTEGER,
    footnote            TEXT,
    min_year_acquired   INTEGER
);

-- Food category reference
CREATE TABLE food_categories (
    id          INTEGER     PRIMARY KEY,
    code        TEXT,
    description TEXT        NOT NULL
);

-- ─── INDEXES ───────────────────────────────────────────────────────────────

-- Full-text search on description (primary search index)
CREATE INDEX idx_foods_description_trgm
    ON foods USING GIN (description gin_trgm_ops);

-- Filtered queries by data type
CREATE INDEX idx_foods_data_type
    ON foods (data_type);

-- Brand owner filter (common in recipe apps: "show me Kraft products")
CREATE INDEX idx_foods_brand_owner
    ON foods (brand_owner)
    WHERE brand_owner IS NOT NULL;

-- UPC/GTIN barcode lookup
CREATE INDEX idx_foods_gtin_upc
    ON foods (gtin_upc)
    WHERE gtin_upc IS NOT NULL;

-- Nutrient lookups by food (most common query pattern)
CREATE INDEX idx_food_nutrients_fdc_id
    ON food_nutrients (fdc_id);

-- Nutrient-first queries (find all foods with >X grams of protein)
CREATE INDEX idx_food_nutrients_nutrient_amount
    ON food_nutrients (nutrient_id, amount DESC)
    WHERE amount IS NOT NULL;

-- Portion lookups by food
CREATE INDEX idx_food_portions_fdc_id
    ON food_portions (fdc_id);
```

**Data type breakdown:**

| Data Type      | Approximate Count | Update Frequency |
| -------------- | ----------------- | ---------------- |
| Branded        | ~300,000          | Monthly          |
| SR Legacy      | ~8,790            | Static (frozen)  |
| Survey (FNDDS) | ~8,700            | Every 2–4 years  |
| Foundation     | ~1,400            | Twice yearly     |
| **Total**      | **~319,000**      |                  |

**Upsert strategy:**
Ingestion uses `INSERT ... ON CONFLICT (fdc_id) DO UPDATE SET ...` for the `foods` table. For `food_nutrients`, the pipeline deletes all rows for affected `fdc_id` values before re-inserting, avoiding complex row-level conflict resolution on 15M rows.

---

## Data Flow

### Ingestion Flow (Scheduled)

```
1.  EventBridge cron rule fires
      └─► triggers Step Functions execution

2.  Step Functions: "Check last run" state
      └─► reads last successful ingestion timestamp from SSM Parameter Store
      └─► determines which datasets are due (Foundation, Branded, or both)

3.  Step Functions: "Launch Fargate task" state
      └─► starts ECS Fargate task with dataset type as environment variable

4.  Fargate task: downloads bulk zip from fdc.nal.usda.gov
      └─► stores raw zip in S3 (s3://your-app-fdc-staging/{dataset}/{timestamp}.zip)
      └─► Step Functions checkpoint: "Download complete"

5.  Fargate task: extracts and parses CSV files
      └─► streams CSV rows, transforms to upsert batches (1,000 rows/batch)
      └─► Step Functions checkpoint: "Parse complete"

6.  Fargate task: loads data into RDS PostgreSQL
      └─► BEGIN TRANSACTION
      └─► TRUNCATE nutrient_definitions (if nutrient metadata changed)
      └─► upserts foods rows (ON CONFLICT DO UPDATE)
      └─► deletes + re-inserts food_nutrients for affected fdc_ids
      └─► upserts food_portions
      └─► COMMIT TRANSACTION
      └─► updates SSM Parameter Store: last_ingest_timestamp, row_counts

7.  Step Functions: "Cache warm-up" state
      └─► queries CloudWatch Logs for top-1000 fdc_ids (last 30 days)
      └─► sends warm-up list to API layer endpoint (internal)
      └─► API layer pre-populates Redis entries

8.  Step Functions: execution SUCCEEDED
      └─► CloudWatch custom metric: fdc_ingest_success = 1
      └─► SNS notification (optional: success digest)
```

**Ingestion failure path:**

- Steps 4, 5, 6 each retry up to 3 times with exponential backoff (30s, 90s, 270s).
- If all retries fail, Step Functions moves to FAILED state.
- CloudWatch alarm fires; SNS notifies on-call.
- **The previous dataset remains live.** Ingestion failures never affect the serving path.

### User Request Flow (Synchronous)

```
1.  Client sends request
      └─► HTTPS to API Gateway endpoint

2.  API Gateway
      └─► validates API key or Cognito JWT
      └─► routes to ECS Fargate API service (or Lambda)

3.  API service: cache lookup
      └─► constructs Redis key (e.g., "food:12345")
      └─► Redis GET

4a. Cache HIT (expected ~85-90% of requests for Foundation/SR Legacy)
      └─► deserialize JSON
      └─► return 200 response (total latency: 2–5ms)

4b. Cache MISS (Branded long-tail, cold start, or expired TTL)
      └─► query PostgreSQL via RDS Proxy
      └─► SELECT foods + food_nutrients + food_portions WHERE fdc_id = $1
      └─► serialize result to JSON
      └─► Redis SETEX (with appropriate TTL + jitter)
      └─► return 200 response (total latency: 5–15ms)

5.  API service emits structured log
      └─► { fdcId, cacheHit, queryDurationMs, statusCode, requestId }
      └─► CloudWatch Logs
```

**Data freshness:**

- Foundation foods: current within 6 months (USDA release cadence)
- SR Legacy foods: static dataset, never stale
- Branded foods: current within 30 days (monthly ingestion)
- The API response includes a `dataLastUpdated` field sourced from SSM, allowing clients to display data freshness if needed

---

## Scalability

**Horizontal scaling — API layer:**
ECS Fargate tasks scale horizontally behind the Application Load Balancer. Application Auto Scaling adjusts task count based on CPU utilization and ALB request rate. At 1M daily active users, 10–15 Fargate tasks (0.5 vCPU / 1 GB each) handle the load comfortably, assuming an 85% cache hit rate.

**Horizontal scaling — database:**
An RDS read replica can absorb read traffic if the primary instance becomes a bottleneck. Add a replica with one CLI call; the application routes search and list queries to the replica endpoint (via RDS Proxy's reader endpoint). At the data volumes here (~2 GB), a single `db.t4g.medium` handles thousands of queries per second before becoming CPU-bound.

**Vertical scaling:**
Upgrading from `db.t4g.medium` to `db.t4g.large` (2 vCPU, 8 GB RAM) doubles available RAM and enables a larger PostgreSQL `shared_buffers`, effectively acting as an in-process page cache. This upgrade costs ~$50/mo more but can defer the need for a read replica.

**Caching leverage:**
Foundation and SR Legacy foods account for ~10K items out of 330K, but likely represent 70–80% of queries in a recipe application (they are the "canonical" foods: broccoli, chicken breast, olive oil). These fit entirely in a 1.37 GB Redis node. At 85–90% cache hit rate, the database handles only 10–15% of total request volume, making vertical scaling largely unnecessary until very high traffic.

**Database sharding:**
Not warranted at this scale. A single PostgreSQL instance handles the full 2 GB dataset trivially. Sharding would add operational complexity with zero benefit until the dataset grows by 10x or query volume exceeds 100K queries/second — neither of which is realistic for FDC data.

**ElastiCache scaling:**
If eviction rates rise (indicating the working set exceeds 1.37 GB), upgrade to `cache.t4g.medium` (3.09 GB) for ~$44/mo. Enable cluster mode only if write throughput becomes a bottleneck, which is unlikely for a read-heavy food data cache.

---

## Security Considerations

**Network isolation:**

- RDS instance and ElastiCache node are in **private subnets** with no internet gateway route.
- ECS Fargate API tasks run in private subnets; API Gateway is the only public ingress.
- The ingestion Fargate task accesses the internet via a NAT Gateway (to reach fdc.nal.usda.gov).
- All inter-service traffic stays within the VPC.

**Database access:**

- **IAM database authentication** is enabled on RDS. The application role assumes an IAM role that grants `rds-db:connect` permission. No static database passwords in environment variables.
- RDS security group allows inbound TCP 5432 only from the ECS task security group.
- RDS Proxy sits between ECS and RDS, handling connection pooling and TLS termination.

**API authentication:**

- **API Gateway API keys** for server-to-server access (recipe app backend to food API).
- **Amazon Cognito** for user-facing endpoints if end users ever query the API directly.
- Usage plans on API Gateway enforce per-key rate limits, preventing a single client from monopolizing capacity.

**Encryption:**

- RDS: encrypted at rest with AWS-managed KMS key (AES-256). Default for all new RDS instances.
- ElastiCache: encryption at rest and in transit (TLS) enabled.
- S3 staging bucket: SSE-S3 (AES-256) server-side encryption.
- All traffic in transit uses TLS 1.2+.

**Data sensitivity:**
This architecture stores no PII. FDC data consists entirely of food descriptions, nutrient amounts, and brand names — all public domain. There are no GDPR, HIPAA, or PCI DSS obligations. The main security concern is protecting API access to prevent unauthorized use of your infrastructure, not protecting the data itself.

**Secrets management:**

- Database connection strings stored in AWS Secrets Manager, not environment variables.
- API keys stored in SSM Parameter Store (SecureString type).
- No credentials in container images or source control.

---

## Cost Analysis

All prices reflect us-east-1 on-demand rates as of early 2026. Reserved instance prices assume 1-year term, no upfront.

### Component Breakdown

**RDS PostgreSQL (`db.t4g.medium`)**

| Pricing model | Monthly cost |
| ------------- | ------------ |
| On-demand     | ~$52.56/mo   |
| Reserved 1yr  | ~$33.00/mo   |

**RDS storage and I/O**

| Item                   | Monthly cost |
| ---------------------- | ------------ |
| 20 GB gp3 storage      | ~$2.30/mo    |
| gp3 IOPS (3,000 free)  | $0.00        |
| Automated backup 20 GB | ~$0.10/mo    |
| **Subtotal**           | ~$2.40/mo    |

**RDS Proxy**

| Item                             | Monthly cost |
| -------------------------------- | ------------ |
| $0.015/vCPU-hour × 2 vCPU × 730h | ~$21.90/mo   |

**ElastiCache Redis (`cache.t4g.small`)**

| Pricing model | Monthly cost |
| ------------- | ------------ |
| On-demand     | ~$22.24/mo   |
| Reserved 1yr  | ~$14.00/mo   |

**ECS Fargate (API service, 1 task baseline)**

| Item                               | Monthly cost |
| ---------------------------------- | ------------ |
| 0.5 vCPU × 730h × $0.04048/vCPU-hr | ~$14.78/mo   |
| 1 GB RAM × 730h × $0.004445/GB-hr  | ~$3.24/mo    |
| **Subtotal (1 task)**              | ~$18.00/mo   |

**ECS Fargate (ingestion task, 2 runs/year)**

| Item                                   | Cost                  |
| -------------------------------------- | --------------------- |
| 4 vCPU × 0.67h × $0.04048/vCPU-hr × 2  | ~$0.22/yr             |
| 8 GB RAM × 0.67h × $0.004445/GB-hr × 2 | ~$0.05/yr             |
| **Subtotal (annual)**                  | ~$0.27/yr (~$0.02/mo) |

**API Gateway (HTTP API)**

| Tier   | Requests/day | Monthly requests | Monthly cost    |
| ------ | ------------ | ---------------- | --------------- |
| Low    | 10K          | 300K             | $0.30/mo (< $1) |
| Medium | 100K         | 3M               | ~$3.00/mo       |
| High   | 1M           | 30M              | ~$30.00/mo      |

_HTTP API pricing: $1.00 per million requests for the first 300M._

**Amazon S3 (ingestion staging)**

| Item                                 | Monthly cost |
| ------------------------------------ | ------------ |
| 1 GB storage (2 zips, 30d lifecycle) | ~$0.023/mo   |
| PUT/GET requests (negligible)        | ~$0.01/mo    |
| **Subtotal**                         | ~$0.03/mo    |

**AWS Step Functions**

| Item                                   | Monthly cost |
| -------------------------------------- | ------------ |
| State transitions: ~50/run × 2 runs/yr | < $0.01/yr   |
| **Subtotal**                           | ~$0.00/mo    |

_Standard workflows: $0.025 per 1,000 state transitions._

**NAT Gateway (for ingestion task to reach internet)**

| Item                                     | Monthly cost |
| ---------------------------------------- | ------------ |
| $0.045/hr × 730h                         | ~$32.85/mo   |
| Data processed: ~1 GB × $0.045/GB × 2/yr | ~$0.09/yr    |

_Note: If you already have a NAT Gateway for other services, this cost is shared. If this is the only service needing NAT, consider using a VPC endpoint where possible or scheduling the ingestion task to use a NAT instance instead._

**CloudWatch**

| Item                           | Monthly cost |
| ------------------------------ | ------------ |
| Metrics (10 custom metrics)    | ~$3.00/mo    |
| Logs (5 GB/mo ingestion + API) | ~$2.50/mo    |
| Dashboards (1 dashboard)       | ~$3.00/mo    |
| **Subtotal**                   | ~$8.50/mo    |

---

### Total Cost by Traffic Tier

| Component                  | Low (10K req/day) | Medium (100K req/day) | High (1M req/day)  |
| -------------------------- | :---------------: | :-------------------: | :----------------: |
| RDS (reserved 1yr)         |      $33.00       |        $33.00         |       $33.00       |
| RDS storage                |       $2.40       |         $2.40         |       $2.40        |
| RDS Proxy                  |      $21.90       |        $21.90         |       $21.90       |
| ElastiCache (reserved 1yr) |      $14.00       |        $14.00         |       $14.00       |
| ECS Fargate API (1 task)   |      $18.00       |   $36.00 (2 tasks)    | $180.00 (10 tasks) |
| API Gateway (HTTP API)     |       $0.30       |         $3.00         |       $30.00       |
| NAT Gateway                |      $32.85       |        $32.85         |       $32.85       |
| S3 + Step Functions        |       $0.10       |         $0.10         |       $0.10        |
| CloudWatch                 |       $8.50       |        $10.00         |       $15.00       |
| **Monthly Total**          |     **~$131**     |       **~$153**       |     **~$329**      |
| **Annual Total**           |    **~$1,572**    |      **~$1,836**      |    **~$3,948**     |

**Cost notes:**

- The NAT Gateway is the surprising cost driver at low traffic tiers ($33/mo). This can be eliminated by running the Fargate ingestion task in a public subnet with a security group (lower security), or by using a shared NAT Gateway if one already exists in the VPC.
- Removing RDS Proxy (using direct connection pooling in the application) saves ~$22/mo but increases connection management complexity.
- Switching RDS and ElastiCache to reserved pricing saves ~$28/mo vs. on-demand at steady state.
- At the "High" tier, `db.t4g.medium` may need upgrading to `db.t4g.large` (~$66/mo reserved), adding ~$33/mo.

---

## Failure Modes & Recovery

**RDS instance failure:**
Without Multi-AZ, a hardware failure causes 5–10 minutes of downtime during RDS automatic recovery. With Multi-AZ enabled (~$52/mo additional), automatic failover to the standby completes in 60–120 seconds. For production, Multi-AZ is strongly recommended. In both cases, no data is lost — the standby is synchronously replicated.

**Ingestion pipeline failure:**
The most likely cause is a transient network error while downloading from USDA's servers. Step Functions retries up to 3 times with backoff. If all retries fail, the previous dataset version remains live in PostgreSQL. A CloudWatch alarm and SNS notification alert the engineering team. The ingestion can be manually retried at any time by starting a new Step Functions execution. Because the pipeline uses `INSERT ... ON CONFLICT DO UPDATE`, a partial failure followed by a retry is safe — no duplicate data accumulates.

**ElastiCache node failure:**
Redis is a cache, not a source of truth. Any cache failure results in a cache miss storm, where all requests fall through to PostgreSQL simultaneously. With RDS Proxy managing connection pooling, the database absorbs this load without exhausting connection limits. Response times increase from ~5ms to ~10–15ms during the recovery window. A new ElastiCache node is automatically provisioned; the cache warms up over 30–60 minutes as organic traffic re-populates it.

**USDA bulk download unavailable:**
If `fdc.nal.usda.gov` is down during a scheduled ingestion run, Step Functions retries fail and the execution moves to FAILED. The previous dataset version remains live. Maximum data staleness equals the time since the last successful ingestion — at worst, 30 days for Branded data, 6 months for Foundation. An SNS alarm notifies the team. No user-facing impact occurs.

**Stale data scenario:**
This architecture accepts bounded staleness by design. Foundation foods are current within 6 months, Branded foods within 30 days. If USDA publishes a correction to Foundation data, the application serves the stale version until the next scheduled ingestion. For a recipe application, this staleness is acceptable — nutritional values for whole foods (chicken, broccoli, rice) don't change meaningfully on short timescales.

**RDS Proxy failure:**
RDS Proxy is a managed service with built-in redundancy across multiple availability zones. If a proxy endpoint becomes unavailable, the application can fall back to direct RDS connections during the recovery window (requires connection string management in the application). AWS SLA for RDS Proxy is 99.95%.

**Full data corruption scenario:**
If a botched ingestion corrupts the PostgreSQL dataset, the recovery path is: (1) identify the last clean snapshot in RDS automated backups (retained 7 days by default), (2) restore to a point-in-time before the corruption, (3) re-run the ingestion pipeline. The S3 staging bucket retains the last downloaded zip for 30 days, so re-loading from the previous download requires no USDA re-download.

---

## Risks

| Risk                                                                         | Impact                                                     | Probability                                                                       | Mitigation                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| USDA changes bulk download format (CSV schema changes)                       | High — ingestion pipeline breaks silently or with errors   | Medium — has happened historically with FDC format updates                        | Pin schema version, validate row counts and column headers after each download, emit alarms on unexpected field counts; maintain a schema version mapping in the parser |
| RDS storage exhaustion                                                       | High — database goes read-only, writes fail                | Low — 20 GB is 10x the current dataset size                                       | CloudWatch alarm at 70% storage utilization; RDS autoscaling storage can be enabled ($0/mo, grows as needed)                                                            |
| Ingestion job runs during peak traffic, causes RDS I/O spike                 | Medium — search latency increases during ingestion window  | Medium — ingestion does millions of upserts                                       | Schedule ingestion during off-peak hours (3–5 AM UTC); use `pg_stat_activity` monitoring; rate-limit batch insert size                                                  |
| Redis eviction of high-value Foundation foods due to Branded long-tail churn | Medium — cache hit rate drops, DB load increases           | Medium — 300K Branded items can evict 1.4K Foundation items under memory pressure | `allkeys-lfu` policy naturally retains frequently accessed Foundation foods; monitor `evicted_keys` metric; upgrade to `cache.t4g.medium` if evictions are chronic      |
| PostgreSQL connection pool exhaustion during cache miss storm                | High — 500 errors for all users                            | Low with RDS Proxy — High without RDS Proxy                                       | Always use RDS Proxy; set `max_connections` in parameter group appropriately for instance size; API service emits `db_connection_pool_exhausted` metric                 |
| USDA FDC dataset license changes from CC0                                    | High — legal obligation to delete stored data              | Very Low — CC0 is irrevocable per Creative Commons terms                          | Document the CC0 license reference in the ingestion pipeline; legal risk is negligible                                                                                  |
| Branded data contains inaccurate or fraudulent nutritional claims            | Low for infrastructure — reputational risk for application | Medium — Branded data is self-reported by manufacturers                           | Display FDC data source attribution; link to original FDC records; do not present as medically authoritative                                                            |

---

## Trade-offs

### Pros

- **Zero runtime API dependency.** Once the ingestion pipeline has run, the application serves indefinitely without contacting USDA. Rate limits, API outages, and network latency are irrelevant.
- **Lowest achievable read latency.** PostgreSQL on RDS in the same region as the API layer delivers 1–5ms query latency. With Redis, common lookups return in under 2ms.
- **Unlimited query volume.** No per-IP rate limits. You can run 10 million food queries per day without a throttle.
- **Full control over schema.** Add columns, denormalize for performance, create application-specific views. The schema is yours.
- **Advanced search capabilities.** `pg_trgm` full-text search, combined nutrient+text filters, sorting by nutrient amount, filtered pagination — none of this is possible with the FDC API.
- **Cost predictability.** Infrastructure cost is mostly fixed regardless of query volume. Adding more users doesn't linearly increase cost.

### Cons

- **Higher base cost.** Even with zero traffic, you pay ~$80–130/mo for always-on RDS, ElastiCache, and NAT Gateway. There's no "pay per query" model.
- **Ingestion pipeline maintenance.** You own a data pipeline. USDA format changes, download failures, and schema migrations require engineering attention. This is not a set-and-forget operation.
- **Data freshness bounded by USDA release cadence.** You cannot get Foundation data fresher than the last USDA publication (twice yearly). If USDA corrects a nutritional value today, your application serves the old value for up to 6 months.
- **Stores data you may not use.** The full dataset includes ~300K Branded items. A typical recipe application may only actively use 5–10K of them. You're paying to store and index 290K items that never get queried — but the storage cost (~$2/mo) is negligible, so this is more philosophical than practical.
- **Cold start complexity.** Bootstrapping a new environment requires running the ingestion pipeline before the API is useful. This adds ~30–60 minutes to initial deployment.

---

## When to Choose This Architecture

Choose this architecture when:

- You need **sub-10ms food lookups** in the hot path of user-facing requests.
- You expect **more than 100K food queries per day** at steady state.
- Your team cannot tolerate **external API rate limits** influencing system behavior.
- You need **full-text search with custom filters** (nutrient thresholds, brand filtering, data type filtering) that the FDC API doesn't support natively.
- Your budget can support **$80–130/month minimum** in infrastructure costs.
- You have engineering capacity to maintain an ingestion pipeline and respond to USDA schema changes.
- You want **complete ownership** of the data layer — schema, indexes, backups, retention.

---

## When NOT to Choose This Architecture

Do not choose this architecture when:

- Your **budget is under $30/month**. The always-on RDS and NAT Gateway costs alone exceed this threshold.
- You only need **a small, fixed subset of foods** (fewer than a few thousand items). A lighter-weight seeding approach is more appropriate.
- You're **prototyping** and need to ship a working API in hours, not days. The ingestion pipeline and schema setup add meaningful upfront complexity.
- Your team **cannot maintain a data pipeline**. USDA format changes will eventually break the ingestion parser, and someone needs to fix it.
- Your traffic is **very low and sporadic** (under 1K queries/day). The FDC API with a simple caching proxy costs a fraction of this architecture.

---

## Migration Path

**Migrating from a caching proxy architecture (Architecture 2):**
A caching proxy populates its data store on-demand as users request foods. Migrating to Full Local Mirror is additive — run the bulk ingestion once to populate the database, then switch the API routing layer to query PostgreSQL instead of forwarding to FDC. The cache can be seeded from the bulk load. No user-facing downtime is required; traffic can be switched atomically with a feature flag.

**Migrating to a different architecture:**
If this architecture proves over-engineered for your actual traffic, the migration path is straightforward: export the `foods` and `food_nutrients` tables to CSV (or seed a lighter store), and decomission RDS, ElastiCache, and the ingestion pipeline. Because the API contract (endpoints, request/response shapes) is independent of the underlying data store, client applications need no changes.

**Incremental adoption:**
You don't have to adopt the full architecture on day one. A practical ramp:

1. Start with a manual one-time bulk load into RDS (no pipeline automation yet).
2. Add Redis caching.
3. Build the automated ingestion pipeline once you've validated the API layer is working correctly.
4. Add Multi-AZ and read replicas only when traffic justifies it.

---

## Implementation Roadmap

### Phase 1: Database Schema + Initial Bulk Load (1 week)

- Provision RDS PostgreSQL instance (`db.t4g.medium`, 20 GB gp3) in a private subnet.
- Enable `pg_trgm` extension.
- Run `CREATE TABLE` and `CREATE INDEX` statements from the Data Model section.
- Manually download the FDC full dataset zip from `https://fdc.nal.usda.gov/fdc-datasets/`.
- Write and run a one-time CSV import script to populate all tables.
- Validate row counts: ~330K foods, ~15M food_nutrients, ~500K food_portions.
- **Deliverable:** Queryable PostgreSQL database with full FDC dataset.

### Phase 2: API Layer with Basic CRUD (1 week)

- Deploy ECS Fargate service in private subnet behind an Application Load Balancer.
- Implement the 5 API endpoints (search, get by ID, batch lookup, list, nutrient definitions).
- Connect to RDS via RDS Proxy (deploy and configure RDS Proxy in this phase).
- Deploy API Gateway (HTTP API) in front of the ALB.
- Verify search latency < 10ms p95 for single-item lookups.
- **Deliverable:** Working API serving food data from PostgreSQL.

### Phase 3: Redis Caching Layer (3 days)

- Provision ElastiCache Redis node (`cache.t4g.small`) in private subnet.
- Add Redis client to the API service.
- Implement cache-aside logic: check Redis on every request, populate on miss.
- Apply TTL strategy from the ElastiCache section.
- Add `cacheHit` field to structured logs.
- Verify cache hit rate > 70% after 24 hours of organic traffic.
- **Deliverable:** API with Redis caching, measurable latency improvement.

### Phase 4: Automated Ingestion Pipeline (1 week)

- Create S3 staging bucket with 30-day lifecycle policy.
- Define Step Functions state machine: Download → Parse → Load → Warm-up.
- Create ECS Fargate task definition for the ingestion worker.
- Configure EventBridge cron rules: Foundation (twice/year), Branded (monthly).
- Test full pipeline run end-to-end in staging.
- Add CloudWatch alarm for Step Functions execution failures.
- Add SNS dead-letter notification.
- **Deliverable:** Fully automated ingestion pipeline with alerting.

### Phase 5: Monitoring & Alerting (2 days)

- Create CloudWatch dashboard with all key metrics (RDS, ElastiCache, ECS, API Gateway).
- Enable RDS Performance Insights.
- Configure all alarms listed in the Monitoring section.
- Set up SNS topic and email/PagerDuty subscriptions.
- Validate alarm delivery by triggering a test condition.
- Document runbook for common failure scenarios (ingestion failure, cache miss storm).
- **Deliverable:** Full observability stack with actionable alerts.

---

_Total estimated implementation time: approximately 3.5 weeks for a single engineer familiar with AWS and PostgreSQL._
