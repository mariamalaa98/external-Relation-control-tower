/**
 * Publishes the Code App to DT new without changing the Code App Development
 * app id stored in power.config.json.
 *
 * The first run creates the DT new app inside the External Relations Control
 * Tower solution. Later runs update that same app.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "power.config.json");
const dtPath = join(root, "power.dtnew.config.json");
const solutionId = "3b011aed-dc20-47d1-95d1-0f3c6a28c7e4";
const connectionId = "cb0825ac-dcd1-498f-b01e-7a1695596857";

const original = readFileSync(configPath, "utf8");
const config = JSON.parse(original);
const saved = existsSync(dtPath) ? JSON.parse(readFileSync(dtPath, "utf8")) : {};

const next = {
  ...config,
  environmentId: "24b23b77-4d64-e7f5-9796-36a7b12bb75e",
  appId: saved.appId || null,
  connectionReferences: {
    [connectionId]: {
      id: "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps",
      displayName: "Microsoft Dataverse",
      dataSources: ["commondataserviceforapps"],
      authenticationType: "Oauth",
      dataSets: {},
    },
  },
};

writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n");
let code = 1;
try {
  const result = spawnSync("power-apps", ["push", "-s", solutionId], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  code = result.status ?? 1;
  if (code === 0) {
    const pushed = JSON.parse(readFileSync(configPath, "utf8"));
    writeFileSync(dtPath, JSON.stringify({ ...next, appId: pushed.appId }, null, 2) + "\n");
    console.log(`DT new app id: ${pushed.appId}`);
  }
} finally {
  writeFileSync(configPath, original);
}
process.exit(code);
