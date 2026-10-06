import {zipSync} from "fflate";
import {readFile, writeFile, readdir, mkdir} from "node:fs/promises";
import {join} from "node:path";
import "./build.mjs";

const files = {};
async function collect(dir, prefix = "") {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        if (entry.isFile() && entry.name.toLowerCase() === "license") continue;
        const name = prefix + entry.name;
        if (entry.isDirectory()) await collect(join(dir, entry.name), name + "/");
        else files[name] = new Uint8Array(await readFile(join(dir, entry.name)));
    }
}
await collect("dist");
await mkdir("releases", {recursive: true});
const manifest = JSON.parse(await readFile("plugin.json", "utf8"));
const filename = `releases/${manifest.name}-${manifest.version}.zip`;
const archive = zipSync(files, {level: 6});
await writeFile(filename, archive);
await writeFile("releases/package.zip", archive);
console.log(`Packaged ${filename} (${Object.keys(files).length} files, flat plugin layout).`);
