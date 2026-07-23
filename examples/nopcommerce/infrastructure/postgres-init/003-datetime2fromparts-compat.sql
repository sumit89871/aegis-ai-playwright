-- SQL Server DATETIME2FROMPARTS may be emitted by nopCommerce, while PostgreSQL uses make_timestamp.
-- This local nopCommerce-only function converts fractional seconds without modifying PostgreSQL built-ins.
CREATE OR REPLACE FUNCTION public.datetime2fromparts(
    p_year integer,
    p_month integer,
    p_day integer,
    p_hour integer,
    p_minute integer,
    p_seconds integer,
    p_fractions integer,
    p_precision integer
)
RETURNS timestamp without time zone
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
    v_fractional_seconds double precision;
    v_fraction_limit numeric;
BEGIN
    IF p_precision IS NULL THEN
        RAISE EXCEPTION 'datetime2fromparts precision must not be null';
    END IF;

    IF p_year IS NULL
        OR p_month IS NULL
        OR p_day IS NULL
        OR p_hour IS NULL
        OR p_minute IS NULL
        OR p_seconds IS NULL
        OR p_fractions IS NULL
    THEN
        RETURN NULL;
    END IF;

    IF p_precision < 0 OR p_precision > 7 THEN
        RAISE EXCEPTION
            'datetime2fromparts precision must be between 0 and 7';
    END IF;

    v_fraction_limit := power(10::numeric, p_precision);

    IF p_fractions < 0 OR p_fractions >= v_fraction_limit THEN
        RAISE EXCEPTION
            'datetime2fromparts fractions are invalid for precision %',
            p_precision;
    END IF;

    v_fractional_seconds :=
        p_seconds::double precision
        + (
            p_fractions::double precision
            / power(10::double precision, p_precision::double precision)
        );

    RETURN pg_catalog.make_timestamp(
        p_year,
        p_month,
        p_day,
        p_hour,
        p_minute,
        v_fractional_seconds
    );
END;
$function$;
