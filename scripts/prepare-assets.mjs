import {build} from "esbuild";
import {copyFile, readFile, writeFile} from "node:fs/promises";

await build({entryPoints: ["assets/marketplace/preview.js"], outfile: "preview/marketplace.js", bundle: true, format: "esm", target: "chrome120"});
const sample = await readFile("preview/index.html", "utf8");
const icons = sample.match(/<svg[\s\S]*?<\/svg>/)?.[0];
if (!icons) throw new Error("Missing preview icon definitions");
const poster = await readFile("assets/marketplace/preview.html", "utf8");
await writeFile("preview/marketplace.html", poster.replace("<!-- WORKSPACE_ICONS -->", icons));
await copyFile("assets/marketplace/icon.svg", "preview/marketplace-icon.svg");
console.log("Prepared http://127.0.0.1:4178/marketplace.html");
