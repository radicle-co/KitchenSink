-- The rules the expected catalog is derived by, restated in SQL (curated catalog plan U6, KTD-3).
--
-- Each function restates ONE rule of the seeder, named beside it, and `tests/e2e/catalogVerifierParity.e2e.test.ts`
-- runs both over the real committed inputs and asserts equal output, so the two cannot drift silently. They are
-- session functions: created in `pg_temp` before any transaction, and called by schema (`pg_temp.v_…`), because
-- Postgres never searches `pg_temp` for a function. Every one is pure.
--
-- ⚠️ Case mapping uses the `pg_unicode_fast` collation: full Unicode case mapping, the same as JavaScript's
-- `toLowerCase`/`toUpperCase`, and the same on every server whatever its default locale.

-- JavaScript's `String.prototype.trim`: strips WhiteSpace and LineTerminator from both ends (ECMA-262 §7.2, §7.3).
-- The seeder's CSV reader trims every field but `description` this way, and `btrim` alone strips only spaces.
CREATE FUNCTION pg_temp.v_js_trim(value text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT regexp_replace(
        value,
        '^[\t\n\u000b\f\r    -     　﻿]+|[\t\n\u000b\f\r    -     　﻿]+$',
        '',
        'g'
    )
$$;

-- `canonicalizeNutrientName` (src/sources/usda/usda.adapter.ts): trim, collapse whitespace runs to one space, lower
-- case, then upper-case the first character.
CREATE FUNCTION pg_temp.v_canonical_nutrient_name(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT upper(left(collapsed, 1) COLLATE pg_unicode_fast) || substr(collapsed, 2)
      FROM (
          SELECT lower(
                     regexp_replace(
                         pg_temp.v_js_trim(name),
                         '[\t\n\u000b\f\r    -     　﻿]+',
                         ' ',
                         'g'
                     ) COLLATE pg_unicode_fast
                 ) AS collapsed
      ) AS folded
$$;

-- `canonicalizeBulkUnit` (src/sources/usda/bulk/usdaBulk.parser.ts): trim and lower-case the bulk token, then map the
-- four tokens whose live-API spelling is verified (`BULK_UNIT_TO_API_UNIT`). `ug` becomes U+00B5 MICRO SIGN + `g`.
CREATE FUNCTION pg_temp.v_canonical_bulk_unit(unit_name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT CASE lowered WHEN 'ug' THEN U&'\00B5g' ELSE lowered END
      FROM (SELECT lower(pg_temp.v_js_trim(unit_name) COLLATE pg_unicode_fast) AS lowered) AS folded
$$;

-- R48's description key, `normalizeUsdaDescription` (src/foods/seed/catalog/baselineSeed.ts): lower-case, split on
-- commas, keep only `a-z0-9` inside each segment, drop empty segments, sort the segments by code unit, join with
-- commas. The words inside a segment are never sorted.
CREATE FUNCTION pg_temp.v_usda_description_key(description text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT coalesce(string_agg(segment, ',' ORDER BY segment COLLATE "C"), '')
      FROM (
          SELECT regexp_replace(part, '[^a-z0-9]', '', 'g') AS segment
            FROM unnest(string_to_array(lower(description COLLATE pg_unicode_fast), ',')) AS part
      ) AS segments
     WHERE segment <> ''
$$;

-- `normalizeName` (src/foods/foodName.ts over recipe-core's `sanitizeFoodName`): NFKC, drop every format character
-- (Unicode `Cf`), turn every control character (`Cc`) into a space, collapse whitespace runs to one space, trim, lower
-- case. The `Cf` set is Unicode 16's, listed because Postgres's regular expressions have no `\p{Cf}`.
CREATE FUNCTION pg_temp.v_normalize_name(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT lower(
               pg_temp.v_js_trim(
                   regexp_replace(
                       regexp_replace(
                           regexp_replace(
                               normalize(name, NFKC),
                               '[­؀-؅؜۝܏࢐-࢑࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f]',
                               '',
                               'g'
                           ),
                           '[\u0001-\u001f\u007f-\u009f]',
                           ' ',
                           'g'
                       ),
                       '[\t\n\u000b\f\r    -     　﻿]+',
                       ' ',
                       'g'
                   )
               ) COLLATE pg_unicode_fast
           )
$$;

-- `statesValue` (src/foods/seed/catalog/baselineSeed.ts): a trimmed field that is not empty and that JavaScript's
-- `Number` reads as a finite number. `Number` accepts a signed decimal with an optional exponent, or an unsigned hex,
-- octal or binary integer; a decimal past the largest double reads as Infinity.
CREATE FUNCTION pg_temp.v_states_value(amount text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT CASE
        WHEN trimmed ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' THEN
            abs(trimmed::numeric) < 179769313486231580793728971405303415079934132710037826936173778980444968292764750946649017977587207096330286416692887910946555547851940402630657488671505820681908902000708383676273854845817711531764475730270069855571366959622842914819860834936475292719074168444365510704342711559699508093042880177904174497792::numeric
        ELSE trimmed ~ '^(0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+)$'
    END
      FROM (SELECT pg_temp.v_js_trim(amount) AS trimmed) AS field
$$;

-- `isStorableAmount` (src/sources/usda/bulk/usdaBulk.parser.ts): a plain non-negative decimal whose JavaScript `Number`
-- is at most 10,000,000. `float8` reads a decimal as `Number` does: correctly rounded to the nearest double.
CREATE FUNCTION pg_temp.v_is_storable_amount(amount text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT amount ~ '^[0-9]+(\.[0-9]+)?$' AND amount::float8 <= 10000000
$$;

-- `String(n)` for a JavaScript number n that is finite and not negative (ECMA-262 Number::toString): the shortest
-- digits that read back as n, in plain notation from 1e-6 up to 1e21 and in exponent notation (`1.5e-7`) below. With
-- `extra_float_digits = 1`, Postgres prints a `float8` with those same shortest digits; only the notation differs.
CREATE FUNCTION pg_temp.v_js_number_text(value float8) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    SET extra_float_digits = 1
AS $$
    SELECT CASE
        WHEN value = 0 THEN '0'
        WHEN value < 0.000001 THEN regexp_replace(value::text, 'e-0*', 'e-')
        ELSE trim_scale(value::text::numeric)::text
    END
$$;

-- `usdaPortionLabel` (src/sources/usda/usdaPortionLabel.ts), as `mapBulkPortions` calls it: a `portion_description`
-- that starts with a digit is the label verbatim (FNDDS). Otherwise a row with no positive storable amount states no
-- measure; else the label is the amount as `String(Number(amount))`, then the measure unit unless `undetermined`, then
-- the portion description, then the modifier unless it is all digits, each trimmed, empty ones left out. A row with no
-- word to measure in states no measure. NULL means "no portion" (KTD-28).
CREATE FUNCTION pg_temp.v_portion_label(amount text, measure_unit text, portion_description text, modifier text)
    RETURNS text
    LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN description ~ '^[0-9]' THEN description
        WHEN NOT pg_temp.v_is_storable_amount(amount) OR amount::float8 <= 0 THEN NULL
        WHEN words = '' THEN NULL
        ELSE pg_temp.v_js_number_text(amount::float8) || ' ' || words
    END
      FROM (
          SELECT pg_temp.v_js_trim(portion_description) AS description,
                 concat_ws(
                     ' ',
                     nullif(CASE WHEN lower(pg_temp.v_js_trim(measure_unit) COLLATE pg_unicode_fast) = 'undetermined'
                                 THEN '' ELSE pg_temp.v_js_trim(measure_unit) END, ''),
                     nullif(pg_temp.v_js_trim(portion_description), ''),
                     nullif(CASE WHEN pg_temp.v_js_trim(modifier) ~ '^[0-9]+$' THEN '' ELSE pg_temp.v_js_trim(modifier) END, '')
                 ) AS words
      ) AS fields
$$;

-- A canonical decimal (`canonicalDecimal` in src/foods/seed/catalog/catalogSnapshot.ts): plain notation, no trailing
-- zeros. `numeric` equality already ignores trailing zeros; this is for a value rendered into a failure's sample.
CREATE FUNCTION pg_temp.v_decimal(value text) RETURNS numeric
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT trim_scale(value::numeric)
$$;

-- `divide` (src/foods/seed/catalog/basisConversion.ts, KTD-24): decimal.js divides to 20 significant digits, rounding
-- half away from zero, and the result is rounded half away from zero to three places. Both roundings are restated, so a
-- quotient that only the first rounding carries across a tie reads the same here. The dividend is padded to forty places
-- first, because `numeric` division keeps the scale of its arguments.
CREATE FUNCTION pg_temp.v_divide(dividend numeric, divisor numeric) RETURNS numeric
    LANGUAGE sql IMMUTABLE STRICT
AS $$
    SELECT CASE
        WHEN quotient = 0 THEN 0::numeric
        ELSE trim_scale(round(round(quotient, 19 - floor(log(10, abs(quotient)))::int), 3))
    END
      FROM (SELECT (dividend + 0.0000000000000000000000000000000000000000) / divisor AS quotient) AS division
$$;
