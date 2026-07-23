-- PostgreSQL's built-in nextval accepts regclass, while nopCommerce installation may pass character.
-- This local-only overload casts to regclass and delegates without replacing the built-in function.
CREATE OR REPLACE FUNCTION public.nextval(character)
RETURNS bigint
AS $$
BEGIN
RETURN pg_catalog.nextval($1::regclass);
END;
$$
LANGUAGE plpgsql
VOLATILE
STRICT;
