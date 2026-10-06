import {readFile, writeFile} from "node:fs/promises";

const version = process.argv[2]?.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
    throw new Error("Expected a version such as 1.0.0 or v1.0.0");
}
for (const file of ["plugin.json", "package.json", "package-lock.json"]) {
    const data = JSON.parse(await readFile(file, "utf8"));
    data.version = version;
    if (file === "package-lock.json") data.packages[""].version = version;
    await writeFile(file, JSON.stringify(data, null, 2) + "\n");
}
console.log(`Release version: ${version}`);
