import {build} from "esbuild";
import {createServer} from "node:http";
import {readFile, copyFile} from "node:fs/promises";
import {resolve, extname} from "node:path";

await build({entryPoints: ["preview/main.js"], outfile: "preview/app.js", bundle: true, format: "esm", sourcemap: true});
await copyFile("src/index.css", "preview/app.css");
const root = resolve("preview");
const server = createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        const path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
        if (!path.startsWith(root + "/") && !path.startsWith(root + "\\")) { res.writeHead(403).end(); return; }
        const body = await readFile(path);
        const mime = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png"};
        res.writeHead(200, {"Content-Type": (mime[extname(path)] || "application/octet-stream") + "; charset=utf-8"});
        res.end(body);
    } catch { res.writeHead(404).end(); }
});
server.listen(4178, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:4178 (mock notebooks, no workspace writes)"));
