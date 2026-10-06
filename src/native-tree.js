// This small optional adapter is isolated because native tree DOM is not a public plugin API.
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
