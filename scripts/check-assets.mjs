import {readFile} from "node:fs/promises";

const requirements = [
    {file: "icon.png", width: 160, height: 160, maxBytes: 50000},
    {file: "preview.png", width: 1024, height: 768, maxBytes: 200000},
];
for (const {file, width, height, maxBytes} of requirements) {
    const data = await readFile(file);
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`${file} must be PNG`);
    if (data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) throw new Error(`${file} must be ${width}×${height}`);
    if (data.length >= maxBytes) throw new Error(`${file} exceeds the ${maxBytes} byte limit`);
    console.log(`${file}: ${width}×${height}, ${data.length} bytes (${(data.length / 1000).toFixed(2)} KB)`);
}
