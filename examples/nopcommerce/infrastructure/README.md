# Local nopCommerce infrastructure

This stack provides a reproducible local nopCommerce 4.90.6 installation backed by PostgreSQL 17. It intentionally stops at the nopCommerce installation page; installation submission remains a manual, reviewable action.

## Architecture

- `nopcommerce-web` publishes nopCommerce at `http://localhost:8080` by default.
- `nopcommerce-db` is reachable only inside the private Compose bridge network and has no host port.
- `aegis-nopcommerce-db-data` persists PostgreSQL data.
- `aegis-nopcommerce-app-data` persists installation settings and application data from `/app/App_Data`.
- `aegis-nopcommerce-product-images` persists catalogue images from `/app/wwwroot/images`.

The whole `/app` directory is deliberately not mounted because doing so would hide the application binaries supplied by the pinned image.

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

| Command                             | Purpose                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run nopcommerce:infra:pull`    | Pull the pinned application and database images.                                   |
| `npm run nopcommerce:infra:up`      | Start both services in the background.                                             |
| `npm run nopcommerce:infra:down`    | Stop and remove containers and the Compose network while preserving named volumes. |
| `npm run nopcommerce:infra:status`  | Show service state and health.                                                     |
| `npm run nopcommerce:infra:logs`    | Follow logs for both services.                                                     |
| `npm run nopcommerce:infra:wait`    | Wait for an HTTP response from the configured local port.                          |
| `npm run nopcommerce:infra:restart` | Restart services without deleting data.                                            |
| `npm run nopcommerce:infra:reset`   | **Destructively remove containers and all named data volumes.**                    |

`nopcommerce:infra:down` is safe for routine shutdown because application and database data remain in named volumes. `nopcommerce:infra:reset` permanently deletes the local database, installer state, and persisted images, returning the stack to an uninstalled state. Run reset only when complete local data deletion is explicitly intended.
