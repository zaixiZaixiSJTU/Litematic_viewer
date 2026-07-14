import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import semver from "semver";

const version = process.argv[2];
if (!semver.valid(version)) throw new Error("用法：npm run bump -- <semver>，例如 0.2.0");
const root = path.resolve(import.meta.dirname, "..");
for (const name of ["package.json", "sjmcl.ext.json"]) {
  const file = path.join(root, name), json = JSON.parse(readFileSync(file, "utf8"));
  json.version = version; writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`Version bumped to ${version}`);
