import { context } from "esbuild";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "sjmcl.ext.json"), "utf8"));
const customPathIndex = process.argv.indexOf("--path");
const appData = process.platform === "win32" ? (process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")) : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : (process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"));
const output = customPathIndex >= 0 && process.argv[customPathIndex + 1] ? path.resolve(process.argv[customPathIndex + 1]) : path.join(appData, "SJMCL", "UserContent", "Extensions", manifest.identifier);
const entry = path.join(output, manifest.frontend.entry);
mkdirSync(path.dirname(entry), { recursive: true });
cpSync(path.join(root, "sjmcl.ext.json"), path.join(output, "sjmcl.ext.json"));
const ctx = await context({
  entryPoints: [path.join(root, "src", "index.ts")], outfile: entry, bundle: true,
  platform: "browser", format: "iife", target: "es2015", charset: "utf8", jsx: "transform",
  jsxFactory: "React.createElement", jsxFragment: "React.Fragment", sourcemap: true,
  banner: { js: "void 0;" },
  define: { "process.env.NODE_ENV": JSON.stringify("development") }
});
await ctx.watch();
console.log(`Watching src/ and writing to ${output}`);
