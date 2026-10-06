// Parse in an inert document. Only text and an allowlisted local image URL reach the UI.
export function extractPreview(html, Parser = globalThis.DOMParser) {
    const parsed = new Parser().parseFromString(html || "", "text/html");
    parsed.querySelectorAll("script,style,iframe,object,embed,.protyle-attr,.protyle-action,[data-type='NodeBlockQueryEmbed'],[data-type='NodeAttributeView']")
        .forEach(node => node.remove());
    const image = [...parsed.querySelectorAll("img")].map(node => localAssetURL(node.getAttribute("data-src") || node.getAttribute("src"))).find(Boolean) || "";
    parsed.querySelectorAll("br").forEach(node => node.replaceWith(parsed.createTextNode("\n")));
    parsed.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div").forEach(node => {
        if (node.previousSibling) node.before(parsed.createTextNode("\n"));
        if (node.nextSibling) node.after(parsed.createTextNode("\n"));
    });
    // Lute's editable nodes preserve paragraph and list boundaries without UI controls.
    let leaves = [...parsed.querySelectorAll("[contenteditable],pre")];
    leaves = leaves.filter(node => !node.querySelector("[contenteditable],pre"));
    const text = (leaves.length ? leaves.map(node => node.textContent).join("\n") : parsed.body.textContent)
        .replace(/\u200b|\u200d|\ufeff/g, "")
        .split("\n").map(line => line.replace(/[\t ]+/g, " ").trim()).filter(Boolean).join("\n");
    const excerpt = [...text].slice(0, 520).join("");
    return {excerpt: text.length > excerpt.length ? excerpt + "…" : excerpt, image};
}

export function localAssetURL(value) {
    if (!value) return "";
    const path = value.replace(/^\//, "").split(/[?#]/)[0];
    if (!path.startsWith("assets/") || /[\\\u0000-\u001f]/.test(path)) return "";
    let decoded;
    try { decoded = decodeURIComponent(path); } catch { return ""; }
    if (decoded.split("/").some(part => part === "." || part === "..") || /[\\\u0000-\u001f]/.test(decoded)) return "";
    return "/" + path;
}

export function documentKey(notebookId, path) {
    return `${notebookId}:${path}`;
}

export function parentPath(path) {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    if (!parts.length) return "/";
    return "/" + parts.join("/").replace(/\.sy$/, "") + ".sy";
}
