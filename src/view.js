import {documentKey, parentPath} from "./content.js";
import {overlayScrollbar} from "./scrollbar.js";

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", "#" + name);
    svg.append(use);
    return svg;
}

function button(label, className = "ct-button", iconName) {
    const node = element("button", className);
    node.type = "button";
    node.title = label;
    node.setAttribute("aria-label", label);
    if (iconName) node.append(icon(iconName));
    else node.textContent = label;
    return node;
}

export class CardTreeView {
    constructor(root, store, actions, host = "tab") {
        this.root = root;
        this.store = store;
        this.actions = actions;
        this.query = "";
        this.limit = 40;
        this.treeVisible = host !== "dock" && host !== "mobile";
        this.cardNodes = new Map();
        this.destroyed = false;
        this.root.classList.add("ct-workspace");
        this.root.dataset.host = host;
        this.applyCardHeight();
        this.root.innerHTML = `
            <div class="ct-toolbar">
                <button type="button" class="ct-button ct-tree-toggle" aria-label="切换文档树" title="切换文档树"><svg aria-hidden="true"><use href="#iconFiles"></use></svg><span>文档树</span></button>
                <div class="ct-breadcrumb" aria-label="当前路径"></div>
                <button type="button" class="ct-button ct-expand-workspace" title="在工作台打开" aria-label="在工作台打开"><svg aria-hidden="true"><use href="#iconLayout"></use></svg></button>
                <button type="button" class="ct-button ct-refresh" title="刷新文档和摘要" aria-label="刷新文档和摘要"><svg aria-hidden="true"><use href="#iconRefresh"></use></svg></button>
            </div>
            <div class="ct-body">
                <nav class="ct-tree-pane" aria-label="笔记本和文档树">
                    <div class="ct-tree-heading"><span>笔记本</span><button type="button" class="ct-button ct-collapse" title="折叠全部" aria-label="折叠全部"><svg aria-hidden="true"><use href="#iconContract"></use></svg></button></div>
                    <div class="ct-scroll-area"><div class="ct-tree-scroll" tabindex="0" role="region" aria-label="文档树滚动区域"><ul class="ct-tree" role="tree" aria-label="文档树"></ul></div></div>
                    <div class="ct-tree-hint">点击文档，浏览它的子笔记</div>
                </nav>
                <main class="ct-main">
                    <header class="ct-context"><button type="button" class="ct-title"></button><span class="ct-context-count" role="status" aria-live="polite"></span></header>
                    <div class="ct-controls"><label class="ct-search"><svg aria-hidden="true"><use href="#iconSearch"></use></svg><input class="b3-text-field ct-search-input" type="search" placeholder="筛选本层笔记标题" aria-label="筛选本层笔记标题"></label><select class="b3-select ct-sort" aria-label="卡片排序"><option value="tree">文档树顺序</option><option value="updated">最近更新</option><option value="title">标题排序</option></select></div>
                    <div class="ct-scroll-area"><div class="ct-card-scroll" tabindex="0" role="region" aria-label="子笔记卡片滚动区域"><div class="ct-grid" aria-label="子笔记卡片"></div><div class="ct-more"></div></div></div>
                </main>
            </div>
            <div class="ct-context-menu" role="menu" hidden></div>
            <div class="ct-create-dialog" role="dialog" aria-modal="true" aria-labelledby="ct-create-dialog-title" hidden>
                <div class="ct-create-dialog-card">
                    <h3 id="ct-create-dialog-title">新建子笔记</h3>
                    <input class="ct-create-dialog-input" type="text" maxlength="128" placeholder="输入笔记标题" />
                    <div class="ct-create-dialog-actions"><button type="button" class="ct-button ct-create-cancel">取消</button><button type="button" class="ct-button ct-create-confirm">创建</button></div>
                </div>
            </div>`;
        this.tree = root.querySelector(".ct-tree");
        this.grid = root.querySelector(".ct-grid");
        this.scroller = root.querySelector(".ct-card-scroll");
        this.scrollbarCleanups = [this.scroller, root.querySelector(".ct-tree-scroll")].map(overlayScrollbar);
        this.breadcrumb = root.querySelector(".ct-breadcrumb");
        this.search = root.querySelector(".ct-search-input");
        this.title = root.querySelector(".ct-title");
        this.layoutObserver = new ResizeObserver(entries => {
            this.compact = entries[0].contentRect.width <= 560;
        });
        this.layoutObserver.observe(root);
        this.compact = root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().width <= 560;
        this.contextMenu = root.querySelector(".ct-context-menu");
        this.createDialog = root.querySelector(".ct-create-dialog");
        this.createInput = root.querySelector(".ct-create-dialog-input");
        this.createResolve = null;
        root.querySelector(".ct-create-cancel").addEventListener("click", () => this.closeCreateDialog(null));
        root.querySelector(".ct-create-confirm").addEventListener("click", () => this.closeCreateDialog(this.createInput.value));
        this.createDialog.addEventListener("click", event => {
            if (event.target === this.createDialog) this.closeCreateDialog(null);
        });
        this.contextMenu.addEventListener("click", event => {
            const action = event.target.closest("[data-menu-action]")?.dataset.menuAction;
            const doc = this.contextMenuDoc;
            this.hideContextMenu();
            if (action === "create-child" && doc) this.run(() => this.createChild(doc));
        });
        this.onDocumentClick = event => {
            if (!this.contextMenu.contains(event.target)) this.hideContextMenu();
        };
        this.onDocumentKeydown = event => {
            if (event.key === "Escape") this.hideContextMenu();
            if (event.key === "Escape" && !this.createDialog.hidden) this.closeCreateDialog(null);
            if (event.key === "Enter" && !this.createDialog.hidden) {
                event.preventDefault();
                this.closeCreateDialog(this.createInput.value);
            }
        };
        document.addEventListener("click", this.onDocumentClick);
        document.addEventListener("keydown", this.onDocumentKeydown);
        this.title.addEventListener("click", () => {
            const id = this.store.selection?.id;
            if (id) this.actions.open(id);
        });
        this.root.querySelector(".ct-tree-toggle").addEventListener("click", () => {
            this.treeVisible = !this.treeVisible;
            this.updateTreeVisibility();
        });
        this.root.querySelector(".ct-refresh").addEventListener("click", () => this.store.refresh());
        this.root.querySelector(".ct-expand-workspace").addEventListener("click", () => this.actions.workspace?.());
        this.root.querySelector(".ct-collapse").addEventListener("click", () => {
            this.store.expanded.clear();
            this.store.save();
            this.renderTree();
        });
        this.root.querySelector(".ct-sort").addEventListener("change", event => this.store.setSort(event.target.value));
        this.search.addEventListener("input", () => {
            this.query = this.search.value;
            this.limit = 40;
            this.renderCards();
        });
        this.unsubscribe = store.subscribe(change => {
            if (change.settings) this.applyCardHeight();
            if (change.preview) this.updatePreview(change.preview);
            else if (change.tree) { this.renderTree(); this.renderStatus(); }
            else {
                if (change.selection) {
                    if (this.compact) {
                        this.treeVisible = false;
                        this.updateTreeVisibility();
                    }
                    this.query = "";
                    this.search.value = "";
                    this.limit = 40;
                    this.scroller.scrollTop = 0;
                }
                this.render();
            }
        });
        this.updateTreeVisibility();
        this.render();
    }

    applyCardHeight() {
        this.root.style.setProperty("--ct-card-height", `${this.store.cardHeight}px`);
    }

    updateTreeVisibility() {
        this.root.dataset.treeVisible = String(this.treeVisible);
        const toggle = this.root.querySelector(".ct-tree-toggle");
        toggle.setAttribute("aria-expanded", String(this.treeVisible));
        this.root.querySelector(".ct-tree-pane").hidden = !this.treeVisible;
    }

    showContextMenu(doc, event) {
        if (!doc?.id) return;
        event.preventDefault();
        event.stopPropagation();
        this.contextMenuDoc = doc;
        this.contextMenu.replaceChildren();
        const create = element("button", "ct-context-menu-item", "新建子笔记");
        create.type = "button";
        create.dataset.menuAction = "create-child";
        create.setAttribute("role", "menuitem");
        this.contextMenu.append(create);
        this.contextMenu.hidden = false;
        const bounds = this.root.getBoundingClientRect();
        const menuWidth = this.contextMenu.offsetWidth || 132;
        const menuHeight = this.contextMenu.offsetHeight || 36;
        this.contextMenu.style.left = `${Math.max(4, Math.min(event.clientX - bounds.left, bounds.width - menuWidth - 4))}px`;
        this.contextMenu.style.top = `${Math.max(4, Math.min(event.clientY - bounds.top, bounds.height - menuHeight - 4))}px`;
        create.focus();
    }

    hideContextMenu() {
        if (!this.contextMenu || this.contextMenu.hidden) return;
        this.contextMenu.hidden = true;
        this.contextMenuDoc = null;
    }

    async createChild(doc) {
        const title = await this.openCreateDialog();
        if (title === null) return;
        const created = await this.store.createChild(doc, title);
        await this.store.select(this.store.documentSelection(doc));
        this.renderTree();
        if (created?.id) this.actions.open(created.id);
    }

    openCreateDialog() {
        this.createDialog.hidden = false;
        this.createInput.value = "";
        this.createInput.focus();
        return new Promise(resolve => { this.createResolve = resolve; });
    }

    closeCreateDialog(value) {
        if (this.createDialog.hidden) return;
        this.createDialog.hidden = true;
        const resolve = this.createResolve;
        this.createResolve = null;
        resolve?.(value === null ? null : String(value || "").trim());
    }

    render() {
        this.renderTree();
        this.renderContext();
        this.renderCards();
    }

    async selectDoc(doc) {
        await this.store.select(this.store.documentSelection(doc));
    }

    async selectTreeDoc(doc) {
        if (!doc.id || doc.subFileCount > 0) {
            await this.store.select(this.store.documentSelection(doc));
            return;
        }
        const parentPathValue = parentPath(doc.path);
        let selection;
        if (parentPathValue === "/") {
            const notebook = this.store.notebooks.find(item => item.id === doc.notebookId);
            if (notebook) selection = this.store.notebookSelection(notebook);
        } else {
            let parent = this.store.documents.get(documentKey(doc.notebookId, parentPathValue));
            if (!parent) {
                await this.store.loadBranch(doc.notebookId, parentPath(parentPathValue));
                parent = this.store.documents.get(documentKey(doc.notebookId, parentPathValue));
            }
            if (parent) selection = this.store.documentSelection(parent);
        }
        if (!selection) return;
        await this.store.select(selection);
        this.focusCard(doc);
    }

    focusCard(doc) {
        const index = this.store.visibleCards(this.query).findIndex(item => item.id === doc.id);
        if (index < 0) return;
        if (index >= this.limit) {
            this.limit = Math.ceil((index + 1) / 40) * 40;
            this.renderCards();
        }
        const record = [...this.cardNodes.values()].find(item => item.doc.id === doc.id);
        if (!record) return;
        record.article.classList.add("ct-card--target");
        record.article.scrollIntoView?.({block: "center", behavior: "smooth"});
        window.setTimeout(() => record.article.classList.remove("ct-card--target"), 1800);
    }

    renderTree() {
        const active = document.activeElement?.dataset?.treeKey;
        this.tree.replaceChildren();
        for (const notebook of this.store.notebooks) {
            this.tree.append(this.treeNode({
                notebookId: notebook.id, path: "/", id: "", title: notebook.name,
                subFileCount: notebook.subFileCount || 1,
            }, 1));
        }
        if (active) {
            const row = [...this.tree.querySelectorAll("[data-tree-key]")].find(node => node.dataset.treeKey === active);
            row?.focus({preventScroll: true});
        }
    }

    treeNode(doc, depth) {
        const key = documentKey(doc.notebookId, doc.path);
        const selected = this.store.selection && documentKey(this.store.selection.notebookId, this.store.selection.path) === key;
        const expanded = this.store.expanded.has(key);
        const li = element("li", "ct-tree-item");
        li.setAttribute("role", "none");
        const row = element("div", "ct-tree-row" + (selected ? " ct-tree-row--selected" : ""));
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(depth));
        row.setAttribute("aria-selected", String(Boolean(selected)));
        row.dataset.treeKey = key;
        row.tabIndex = 0;
        row.title = doc.title;
        row.style.setProperty("--ct-depth", depth - 1);
        const hasChildren = doc.path === "/" || doc.subFileCount > 0;
        if (hasChildren) row.setAttribute("aria-expanded", String(expanded));
        const toggle = button(expanded ? "折叠" : "展开", "ct-tree-arrow", "iconRight");
        toggle.tabIndex = -1;
        toggle.disabled = !hasChildren;
        toggle.classList.toggle("ct-tree-arrow--expanded", expanded);
        toggle.addEventListener("click", event => {
            event.stopPropagation();
            this.store.toggle(doc.notebookId, doc.path);
        });
        row.append(toggle, icon(doc.path === "/" ? "iconFilesRoot" : "iconFile"), element("span", "ct-tree-text", doc.title));
        if (doc.subFileCount > 0) row.append(element("span", "ct-tree-count", doc.subFileCount));
        if (doc.id) {
            const menu = button("笔记菜单", "ct-button ct-tree-menu", "iconMore");
            menu.addEventListener("click", event => this.showContextMenu(doc, event));
            row.append(menu);
        }
        row.addEventListener("click", () => this.run(() => this.selectTreeDoc(doc)));
        row.addEventListener("contextmenu", event => this.showContextMenu(doc, event));
        row.addEventListener("dblclick", () => { if (doc.id) this.actions.open(doc.id); });
        row.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.run(() => this.selectTreeDoc(doc));
            } else if (event.key === "ArrowRight" && hasChildren && !expanded) {
                event.preventDefault();
                this.store.toggle(doc.notebookId, doc.path);
            } else if (event.key === "ArrowLeft" && expanded) {
                event.preventDefault();
                this.store.toggle(doc.notebookId, doc.path);
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const rows = [...this.tree.querySelectorAll("[role='treeitem']")];
                const index = rows.indexOf(row);
                const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index + (event.key === "ArrowDown" ? 1 : -1);
                rows[Math.max(0, Math.min(rows.length - 1, next))]?.focus();
            }
        });
        li.append(row);
        if (hasChildren && expanded) {
            const group = element("ul", "ct-tree-group");
            group.setAttribute("role", "group");
            const children = this.store.branches.get(key);
            if (children) children.forEach(child => group.append(this.treeNode(child, depth + 1)));
            else group.append(element("li", "ct-tree-loading", "加载中…"));
            li.append(group);
        }
        return li;
    }

    renderContext() {
        const selection = this.store.selection;
        this.breadcrumb.replaceChildren();
        const notebook = this.store.notebooks.find(item => item.id === selection?.notebookId);
        const notebookButton = button(notebook?.name || "卡片文档树", "ct-crumb");
        if (notebook) notebookButton.addEventListener("click", () => this.store.select(this.store.notebookSelection(notebook)));
        this.breadcrumb.append(notebookButton);
        if (selection?.id) {
            const parts = selection.path.split("/").filter(Boolean);
            for (let i = 0; i < parts.length; i++) {
                const path = "/" + parts.slice(0, i + 1).join("/").replace(/\.sy$/, "") + ".sy";
                const doc = this.store.documents.get(documentKey(selection.notebookId, path));
                this.breadcrumb.append(element("span", "ct-crumb-separator", "/"));
                const crumb = button(doc?.title || (i === parts.length - 1 ? selection.title : "父文档"), "ct-crumb");
                if (doc) crumb.addEventListener("click", () => this.selectDoc(doc));
                else crumb.disabled = true;
                this.breadcrumb.append(crumb);
            }
        }
        this.title.textContent = selection?.title || "卡片文档树";
        this.title.disabled = !selection?.id;
        this.title.title = selection?.id ? "打开当前笔记" : this.title.textContent;
        this.title.setAttribute("aria-label", selection?.id ? `打开笔记：${this.title.textContent}` : this.title.textContent);
        this.root.querySelector(".ct-sort").value = this.store.sort;
        this.root.querySelector(".ct-refresh").disabled = this.store.loading;
    }

    renderStatus() {
        const count = this.store.visibleCards(this.query).length;
        const badge = this.root.querySelector(".ct-context-count");
        const label = this.store.loading ? "正在读取子笔记" : this.store.error ? "加载失败" : `${count} 篇${this.query ? "匹配笔记" : "子笔记"}`;
        badge.textContent = this.store.loading || this.store.error ? (this.store.loading ? "…" : "!") : String(count);
        badge.setAttribute("aria-label", label);
        badge.title = label;
    }

    renderCards() {
        this.observer?.disconnect();
        this.cardNodes.clear();
        this.grid.replaceChildren();
        const more = this.root.querySelector(".ct-more");
        more.replaceChildren();
        this.renderStatus();
        if (this.store.loading) {
            for (let i = 0; i < 4; i++) {
                const skeleton = element("div", "ct-skeleton");
                skeleton.setAttribute("aria-hidden", "true");
                for (let j = 0; j < 5; j++) skeleton.append(element("span"));
                this.grid.append(skeleton);
            }
            return;
        }
        if (this.store.error) {
            const empty = this.empty("无法加载子笔记", this.store.error);
            const retry = button("重新加载", "b3-button");
            retry.addEventListener("click", () => this.store.refresh());
            empty.append(retry);
            this.grid.append(empty);
            return;
        }
        const docs = this.store.visibleCards(this.query);
        if (!docs.length) {
            const headline = this.query ? "没有匹配的标题" : !this.store.notebooks.length ? "没有已打开的笔记本" : "还没有子笔记";
            const detail = this.query ? "试试其他关键词，筛选仅匹配本层标题。" : !this.store.notebooks.length ? "在思源中打开或解锁笔记本后，点击刷新。" : this.store.selection?.id ? "此处展示当前笔记的直接子文档。可以打开当前笔记查看正文。" : "此处展示笔记本下的一级文档。在思源中创建文档后，点击刷新。";
            this.grid.append(this.empty(headline, detail));
            return;
        }
        if (typeof IntersectionObserver !== "undefined") {
            this.observer = new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const record = this.cardNodes.get(entry.target.dataset.previewKey);
                    if (record) this.store.hydrate(record.doc);
                    this.observer.unobserve(entry.target);
                });
            }, {root: this.scroller, rootMargin: "180px"});
        }
        docs.slice(0, this.limit).forEach(doc => {
            const node = this.card(doc);
            this.grid.append(node);
            if (this.observer) this.observer.observe(node);
            else this.store.hydrate(doc);
        });
        if (docs.length > this.limit) {
            const load = button(`继续显示（剩余 ${docs.length - this.limit} 篇）`, "b3-button b3-button--outline");
            load.addEventListener("click", () => { this.limit += 40; this.renderCards(); });
            more.append(load);
        }
    }

    empty(headline, detail) {
        const node = element("div", "ct-empty");
        node.append(icon("iconFileText"), element("h3", "", headline), element("p", "", detail));
        return node;
    }

    card(doc) {
        const key = this.store.previewKey(doc);
        const article = element("article", "ct-card");
        article.dataset.docId = doc.id;
        article.dataset.previewKey = key;
        // Keep the action label available to assistive technology and tooltips,
        // while leaving the card header to display the document title only once.
        const main = button("", "ct-card-main");
        main.title = doc.title;
        main.setAttribute("aria-label", `打开笔记：${doc.title}`);
        const cover = element("div", "ct-card-cover");
        cover.hidden = true;
        const title = element("h3", "ct-card-title", doc.title);
        const excerpt = element("p", "ct-card-excerpt", "正在读取正文摘要…");
        main.append(cover, title, excerpt);
        main.addEventListener("click", () => this.actions.open(doc.id));
        const footer = element("footer", "ct-card-footer");
        const date = element("time", "ct-card-date");
        if (doc.mtime) {
            const value = new Date(doc.mtime * 1000);
            if (!Number.isNaN(value.valueOf())) {
                date.dateTime = value.toISOString();
                date.textContent = value.getFullYear() === new Date().getFullYear()
                    ? value.toLocaleDateString("zh-CN", {month: "short", day: "numeric"})
                    : `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()}`;
                date.title = "更新于 " + value.toLocaleString("zh-CN");
            }
        }
        footer.append(date);
        if (doc.subFileCount > 0) {
            const children = button(`${doc.subFileCount} 篇子笔记`, "ct-card-children");
            children.append(icon("iconRight"));
            children.addEventListener("click", () => this.selectDoc(doc));
            footer.append(children);
        }
        const retry = button("重试摘要", "ct-card-retry");
        retry.hidden = true;
        retry.addEventListener("click", () => this.store.retryPreview(doc));
        article.append(main, retry, footer);
        this.cardNodes.set(key, {doc, article, excerpt, cover, retry});
        this.updatePreview(key);
        return article;
    }

    updatePreview(key) {
        const record = this.cardNodes.get(key);
        const preview = this.store.previews.get(key);
        if (!record || !preview) return;
        record.excerpt.textContent = preview.error ? "摘要暂时不可读取" : preview.excerpt || "这篇笔记还没有正文";
        record.excerpt.classList.toggle("ct-card-excerpt--empty", Boolean(preview.error || !preview.excerpt));
        record.retry.hidden = !preview.error;
        if (preview.error) record.retry.title = preview.error;
        if (preview.image && !record.cover.firstChild) {
            const image = element("img");
            image.alt = "";
            image.loading = "lazy";
            image.src = preview.image;
            image.addEventListener("error", () => { record.cover.hidden = true; });
            record.cover.replaceChildren(image);
            record.cover.hidden = false;
        }
    }

    async run(action) {
        try { await action(); }
        catch (error) { this.store.error = error.message; this.store.emit(); }
    }

    destroy() {
        this.destroyed = true;
        this.unsubscribe();
        this.observer?.disconnect();
        this.layoutObserver.disconnect();
        this.scrollbarCleanups.forEach(cleanup => cleanup());
        document.removeEventListener("click", this.onDocumentClick);
        document.removeEventListener("keydown", this.onDocumentKeydown);
        this.hideContextMenu();
        this.cardNodes.clear();
        this.root.replaceChildren();
        this.root.classList.remove("ct-workspace");
        delete this.root.dataset.host;
        delete this.root.dataset.treeVisible;
    }
}
