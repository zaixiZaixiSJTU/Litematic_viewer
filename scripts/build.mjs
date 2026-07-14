import { build } from "esbuild";
import { zipSync } from "fflate";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "sjmcl.ext.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = manifest.version || pkg.version;
const extensionDir = path.join(root, "dist", manifest.identifier);
const entry = path.join(extensionDir, manifest.frontend.entry);
const development = process.argv.includes("--development");

function addTree(directory) {
  const tree = {};
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const source = path.join(directory, item.name);
    tree[item.name] = item.isDirectory() ? addTree(source) : new Uint8Array(readFileSync(source));
  }
  return tree;
}

rmSync(extensionDir, { recursive: true, force: true });
mkdirSync(path.dirname(entry), { recursive: true });
await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: entry,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2015",
  charset: "utf8",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  minify: !development,
  sourcemap: development,
  legalComments: "none",
  // SJMCL wraps extension source in a function whose parameter is named `eval`.
  // A dependency may make esbuild emit a leading "use strict" directive, which
  // would make that host wrapper a syntax error. End the directive prologue first.
  banner: { js: "void 0;" },
  define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") }
});
cpSync(path.join(root, "sjmcl.ext.json"), path.join(extensionDir, "sjmcl.ext.json"));
for (const name of ["icon.png", "assets", "data"]) {
  const source = path.join(root, name);
  if (existsSync(source)) cpSync(source, path.join(extensionDir, name), { recursive: true });
}
const archive = path.join(root, "dist", `${manifest.identifier}-${version}.sjmclx`);
writeFileSync(archive, zipSync(addTree(extensionDir), { level: 9 }));
console.log(`Built  ${extensionDir}`);
console.log(`Packed ${archive}`);
