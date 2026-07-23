# Local nopCommerce infrastructure

This stack provides a reproducible local nopCommerce 4.90.6 installation backed by PostgreSQL 17. It intentionally stops at the nopCommerce installation page; installation submission remains a manual, reviewable action.

## Architecture

- `nopcommerce-web` publishes nopCommerce at `http://localhost:8080` by default.
- `nopcommerce-db` is reachable only inside the private Compose bridge network and has no host port.
- `aegis-nopcommerce-db-data` persists PostgreSQL data.
- `aegis-nopcommerce-app-data` persists installation settings and application data from `/app/App_Data`.
- `aegis-nopcommerce-product-images` persists catalogue images from `/app/wwwroot/images`.

The whole `/app` directory is deliberately not mounted because doing so would hide the application binaries supplied by the pinned image.

## PostgreSQL citext initialization

nopCommerce requires PostgreSQL's `citext` extension for case-insensitive text columns. The extension must exist before FluentMigrator creates its migration metadata and application schema.

The PostgreSQL image executes files in `/docker-entrypoint-initdb.d` only while creating a brand-new, empty database volume. Adding an initialization script does not change a database volume that PostgreSQL has already initialized. Therefore, an existing incomplete installation created without `citext` requires one full local reset before retrying the installer.

## PostgreSQL nextval compatibility

PostgreSQL's native sequence function has the signature `pg_catalog.nextval(regclass)`. The nopCommerce installation path, or one of its database libraries, may instead invoke `nextval` with a value typed as `character`. PostgreSQL cannot implicitly resolve that call to the native signature and raises error `42883: function nextval(character) does not exist`.

This local infrastructure supplies the narrow overload `public.nextval(character)`. It casts the character argument to `regclass` and delegates directly to `pg_catalog.nextval`. The overload is isolated to the nopCommerce example database: it does not replace or modify PostgreSQL's built-in function, and it adds no overloads for other argument types.

Like the `citext` initializer, this compatibility initializer runs only when PostgreSQL creates a new, empty database volume. Adding it to an already initialized volume has no effect, so a volume created before this initializer was added requires a clean local reset before retrying an incomplete installation. Run `npm run nopcommerce:infra:verify-db` after recreation to verify both function signatures and a temporary test sequence without touching application sequences or data.

## PostgreSQL datetime2fromparts compatibility

`DATETIME2FROMPARTS` originates from SQL Server and has no native PostgreSQL equivalent under that name. The nopCommerce installation path may emit it even while using PostgreSQL, which otherwise provides `pg_catalog.make_timestamp` for constructing timestamps.

This example database supplies only the exact eight-integer `public.datetime2fromparts` overload required by the observed installer expression. It validates precision and fractions, converts the fractional component into fractional seconds, and delegates timestamp construction to `pg_catalog.make_timestamp`. The function is isolated to local nopCommerce infrastructure and does not replace or modify PostgreSQL built-ins. No other SQL Server date functions or overloads are provided.

PostgreSQL stores timestamps with microsecond precision. A seventh fractional digit may therefore be rounded; that behavior is acceptable for the observed nopCommerce installation expression targeted by this compatibility function.

## PostgreSQL initialization order

PostgreSQL runs these files lexically when it creates a fresh, empty database volume:

1. `001-enable-citext.sql`
2. `002-nextval-character-compat.sql`
3. `003-datetime2fromparts-compat.sql`

Initialization scripts do not run against an existing database volume. A volume created before any required initializer was added must be cleanly reset and recreated before retrying an incomplete installation.

The reset is deliberately limited to these local nopCommerce volumes:

- PostgreSQL data in `aegis-nopcommerce-db-data`
- nopCommerce `App_Data` in `aegis-nopcommerce-app-data`
- nopCommerce product images in `aegis-nopcommerce-product-images`

It does not delete source code, Git history, repository files, or unrelated Docker images and volumes. After the reset and recreation, run `npm run nopcommerce:infra:verify-db` before submitting the installer.

## Initial preparation

From the repository root:

1. Copy `examples/nopcommerce/infrastructure/.env.example` to `examples/nopcommerce/infrastructure/.env`.
2. Replace the example database password with a strong local-development password.
3. Keep this file local. It is ignored by Git and must never contain production credentials.
4. Run `npm run nopcommerce:infra:pull`.
5. Run `npm run nopcommerce:infra:up`.
6. Run `npm run nopcommerce:infra:wait`.
7. Open `http://localhost:8080` in a browser.

## Complete the installer manually

On the nopCommerce installation page:

1. Select **PostgreSQL** as the database provider.
2. Set the database server or host to **`nopcommerce-db`**, the Compose service name. Do not use `localhost`; inside the web container, `localhost` means the web container itself.
3. Set the database name to the `POSTGRES_DB` value in the ignored infrastructure `.env` file (the example uses `nopcommerce`).
4. Set the database username to the `POSTGRES_USER` value in that file (the example uses `nopcommerce`).
5. Enter the database password from `POSTGRES_PASSWORD` in the ignored infrastructure `.env` file.
6. Enable **Create database if it does not exist** when that option is available.
7. Enable **Create sample data**. Sample data is mandatory for this automation project because it creates catalogue products such as **Build your own computer**.
8. Create a local-only administrator email address and a strong local administrator password. Do not add that password to source files, documentation, tests, or Git.
9. Review the values and submit the installer manually.
10. Wait for the storefront to load, then run `npm run nopcommerce:infra:wait` again before running browser tests.

This milestone does not automate or submit the installation form.

## Operations

| Command                               | Purpose                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run nopcommerce:infra:pull`      | Pull the pinned application and database images.                                   |
| `npm run nopcommerce:infra:up`        | Start both services in the background.                                             |
| `npm run nopcommerce:infra:down`      | Stop and remove containers and the Compose network while preserving named volumes. |
| `npm run nopcommerce:infra:status`    | Show service state and health.                                                     |
| `npm run nopcommerce:infra:logs`      | Follow logs for both services.                                                     |
| `npm run nopcommerce:infra:wait`      | Wait for an HTTP response from the configured local port.                          |
| `npm run nopcommerce:infra:verify-db` | Verify all compatibility functions, safe functional probes, and table count.       |
| `npm run nopcommerce:infra:restart`   | Restart services without deleting data.                                            |
| `npm run nopcommerce:infra:reset`     | **Destructively remove containers and all named data volumes.**                    |

`nopcommerce:infra:down` is safe for routine shutdown because application and database data remain in named volumes. `nopcommerce:infra:reset` permanently deletes the local database, installer state, and persisted images, returning the stack to an uninstalled state. Run reset only when complete local data deletion is explicitly intended.
