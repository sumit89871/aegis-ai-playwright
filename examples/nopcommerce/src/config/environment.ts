import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import { createEnvironmentConfig } from "@aegis/core";

const environmentFile = fileURLToPath(new URL("../../.env", import.meta.url));

dotenv.config({ path: environmentFile, quiet: true });

export const environment = createEnvironmentConfig(
  {
    baseUrl: "http://localhost:8080",
    testEnvironment: "local",
  },
  process.env,
);
