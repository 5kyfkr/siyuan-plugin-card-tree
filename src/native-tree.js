// This small optional adapter is isolated because native tree DOM is not a public plugin API.
export function nativeTreeDocument(target) {
    const label = target?.closest?.(".b3-list-item__text");
    const row = label?.closest(".sy__file li[data-type='navigation-file']");
    const id = row?.getAttribute("data-node-id");
    if (!id || row.getAttribute("aria-disabled") === "true" || row.hasAttribute("data-spec-too-new")) return null;
    // 新版树的普通行通过 occurrence key 关联笔记本，加密文档读取需要保留该 ID。
    const notebookId = row.closest("ul[data-url]")?.getAttribute("data-url") ||
        row.getAttribute("data-tree-key")?.match(/^notebook:([^/]+)/)?.[1] || "";
    return {id, notebookId};
}

export function nativeTreeSelection(target) {
    if (!target?.closest) return null;
    const label = target.closest(".b3-list-item__text");
    if (!label) return null;
    const row = label.closest(".sy__file li[data-type='navigation-root'], .sy__file li[data-type='navigation-file']");
    if (!row) return null;
    const notebookId = row.closest("ul[data-url]")?.getAttribute("data-url");
    if (!notebookId) return null;
    const path = row.getAttribute("data-path");
    const isRoot = row.getAttribute("data-type") === "navigation-root";
    if (!isRoot && !path?.endsWith(".sy")) return null;
    return {
        notebookId,
        path: isRoot ? "/" : path,
        id: isRoot ? "" : row.getAttribute("data-node-id"),
        title: label.textContent.trim() || "未命名文档",
    };
}
