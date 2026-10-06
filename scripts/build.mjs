import {build} from "esbuild";
import {copyFile, mkdir} from "node:fs/promises";
import "./check-assets.mjs";

await mkdir("dist", {recursive: true});
await build({
    entryPoints: ["src/index.js"], outfile: "dist/index.js",
    bundle: true, format: "cjs", platform: "browser", target: "chrome120",
    external: ["siyuan"], footer: {js: "module.exports = module.exports.default;"},
    legalComments: "none",
});
for (const file of ["plugin.json", "README.md", "LICENSE", "icon.png", "preview.png"]) {
    await copyFile(file, `dist/${file}`);
}
await copyFile("src/index.css", "dist/index.css");
await mkdir("dist/i18n", {recursive: true});
for (const lang of ["en_US", "zh_CN"]) await copyFile(`i18n/${lang}.json`, `dist/i18n/${lang}.json`);
console.log("Built dist/index.js and plugin assets.");
