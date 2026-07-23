import {
  applicationPreflightExitCode,
  renderApplicationPreflight,
  runApplicationPreflight,
} from "@aegis/core";

import { applicationProfile } from "../src/config/application-profile.ts";

const result = await runApplicationPreflight(applicationProfile);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(renderApplicationPreflight(result));
}
process.exitCode = applicationPreflightExitCode(result);
