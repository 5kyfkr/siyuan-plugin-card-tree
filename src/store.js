import {documentKey, extractPreview, parentPath} from "./content.js";

export const DEFAULT_CARD_HEIGHT = 300;
export const MIN_CARD_HEIGHT = 220;
export const MAX_CARD_HEIGHT = 640;

export function normalizeCardHeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_CARD_HEIGHT;
    return Math.max(MIN_CARD_HEIGHT, Math.min(MAX_CARD_HEIGHT, Math.round(number / 10) * 10));
}

export class CardTreeStore {
    constructor(api, settings = {}, persist = () => {}, parse = extractPreview) {
        this.api = api;
        this.persist = persist;
        this.parse = parse;
        this.notebooks = [];
        this.selection = null;
        this.cards = [];
        this.branches = new Map();
        this.documents = new Map();
        this.branchRequests = new Map();
        this.expanded = new Set(Array.isArray(settings.expanded) ? settings.expanded : []);
        this.previews = new Map();
        this.previewRequests = new Map();
        this.previewQueue = [];
        this.activePreviews = 0;
        this.previewEpoch = 0;
        this.sort = ["tree", "updated", "title"].includes(settings.sort) ? settings.sort : "tree";
        this.cardHeight = normalizeCardHeight(settings.cardHeight);
        this.loading = false;
        this.error = "";
        this.listeners = new Set();
        this.generation = 0;
        this.controller = new AbortController();
        this.restored = settings.selection;
        this.started = false;
        this.disposed = false;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(change = {}) {
        if (!this.disposed) this.listeners.forEach(listener => listener(change));
    }

    settings() {
        return {
            selection: this.selection,
            expanded: [...this.expanded].slice(-300),
            sort: this.sort,
            cardHeight: this.cardHeight,
        };
    }

    save() { this.persist(this.settings()); }

    async start() {
        if (this.started || this.disposed) return;
        this.started = true;
        this.loading = true;
        this.emit();
        try {
            this.notebooks = await this.api.notebooks(this.controller.signal);
            const notebook = this.notebooks.find(item => item.id === this.restored?.notebookId) || this.notebooks[0];
            if (notebook) {
                const selection = this.restored?.notebookId === notebook.id ? this.restored : this.notebookSelection(notebook);
                if (!this.restored) this.expanded.add(documentKey(notebook.id, "/"));
                await this.select(selection);
                await this.loadExpanded();
            } else {
                this.loading = false;
                this.emit();
            }
        } catch (error) {
            if (this.disposed) return;
            this.error = error.message;
            this.loading = false;
            this.emit();
        }
    }

    notebookSelection(notebook) {
        return {notebookId: notebook.id, path: "/", title: notebook.name, id: ""};
    }

    documentSelection(doc) {
        return {notebookId: doc.notebookId, path: doc.path, title: doc.title || doc.name, id: doc.id};
    }

    async loadBranch(notebookId, path, retry = false) {
        const key = documentKey(notebookId, path);
        if (!retry && this.branches.has(key)) return this.branches.get(key);
        if (this.branchRequests.has(key)) return this.branchRequests.get(key);
        const signal = this.controller.signal;
        const request = this.api.children(notebookId, path, signal).then(docs => {
            if (this.disposed || signal.aborted) return [];
            this.branches.set(key, docs);
            docs.forEach(doc => this.documents.set(documentKey(notebookId, doc.path), doc));
            return docs;
        });
        this.branchRequests.set(key, request);
        try { return await request; }
        finally { if (this.branchRequests.get(key) === request) this.branchRequests.delete(key); }
    }

    async select(selection) {
        if (this.disposed) return;
        const generation = ++this.generation;
        this.selection = {...selection};
        this.cards = [];
        this.error = "";
        this.loading = true;
        this.save();
        this.emit({selection: true});
        try {
            const docs = await this.loadBranch(selection.notebookId, selection.path);
            if (generation !== this.generation || this.disposed) return;
            this.cards = docs;
        } catch (error) {
            if (generation !== this.generation || this.disposed) return;
            this.error = error.message;
        }
        if (generation !== this.generation || this.disposed) return;
        this.loading = false;
        this.emit();
    }

    async toggle(notebookId, path) {
        const key = documentKey(notebookId, path);
        if (this.expanded.has(key)) this.expanded.delete(key);
        else {
            this.expanded.add(key);
            try { await this.loadBranch(notebookId, path); }
            catch (error) {
                if (this.disposed) return;
                this.expanded.delete(key);
                this.error = error.message;
            }
        }
        this.save();
        this.emit({tree: true});
    }

    async loadExpanded() {
        const signal = this.controller.signal;
        for (const key of [...this.expanded]) {
            if (this.disposed || signal.aborted) return;
            const separator = key.indexOf(":");
            const notebookId = key.slice(0, separator);
            if (!this.notebooks.some(item => item.id === notebookId)) continue;
            try { await this.loadBranch(notebookId, key.slice(separator + 1)); } catch { this.expanded.delete(key); }
        }
        this.emit({tree: true});
    }

    previewKey(doc) { return `${doc.notebookId}:${doc.id}:${doc.mtime}`; }

    hydrate(doc) {
        const key = this.previewKey(doc);
        if (this.disposed || this.previews.has(key) || this.previewRequests.has(key)) return;
        this.previewRequests.set(key, true);
        this.previewQueue.push({doc, key, signal: this.controller.signal, epoch: this.previewEpoch});
        this.drainPreviews();
    }

    drainPreviews() {
        while (!this.disposed && this.activePreviews < 4 && this.previewQueue.length) {
            const job = this.previewQueue.shift();
            if (job.signal.aborted || job.epoch !== this.previewEpoch) continue;
            // Skip previews queued for a branch the user has already left.
            if (!this.cards.some(doc => this.previewKey(doc) === job.key)) {
                this.previewRequests.delete(job.key);
                continue;
            }
            this.activePreviews++;
            this.api.preview(job.doc, job.signal).then(data => {
                if (!job.signal.aborted && !this.disposed && job.epoch === this.previewEpoch) this.previews.set(job.key, this.parse(data.content));
            }).catch(error => {
                if (!job.signal.aborted && !this.disposed && job.epoch === this.previewEpoch) this.previews.set(job.key, {error: error.message});
            }).finally(() => {
                this.activePreviews--;
                if (!job.signal.aborted && job.epoch === this.previewEpoch) this.previewRequests.delete(job.key);
                if (this.previews.size > 300) this.previews.delete(this.previews.keys().next().value);
                this.emit({preview: job.key});
                this.drainPreviews();
            });
        }
    }

    retryPreview(doc) {
        this.previews.delete(this.previewKey(doc));
        this.hydrate(doc);
    }

    async createChild(doc, title) {
        const name = String(title || "").trim();
        if (!doc?.id || !name) throw new Error("请输入子笔记名称");
        const safeName = name.replaceAll("/", "／");
        const parentHPath = typeof this.api.hPath === "function"
            ? await this.api.hPath(doc.id, this.controller.signal)
            : this.hPathFromDocuments(doc);
        const basePath = String(parentHPath || this.hPathFromDocuments(doc) || "/").replace(/\/+$/, "") || "/";
        const createPath = basePath === "/" ? `/${safeName}` : `${basePath}/${safeName}`;
        const id = await this.api.createDoc(doc.notebookId, createPath, "", doc.id, this.controller.signal);
        const branchKey = documentKey(doc.notebookId, doc.path);
        this.branches.delete(branchKey);
        const children = await this.loadBranch(doc.notebookId, doc.path, true);
        const created = children.find(item => item.id === id) || children.find(item => item.title === name || item.title === safeName);
        this.emit({tree: true});
        if (this.selection && documentKey(this.selection.notebookId, this.selection.path) === branchKey) {
            this.cards = children;
            this.emit({cards: true});
        }
        return created || {id, notebookId: doc.notebookId, title: safeName, path: `${doc.path.replace(/\/$/, "")}/${safeName}.sy`, subFileCount: 0};
    }

    hPathFromDocuments(doc) {
        const names = [];
        let current = doc;
        while (current?.id) {
            names.unshift(String(current.title || current.name || "未命名文档").trim() || "未命名文档");
            const path = parentPath(current.path);
            if (path === "/") break;
            current = this.documents.get(documentKey(doc.notebookId, path));
            if (!current) break;
        }
        return "/" + names.map(name => name.replaceAll("/", "／")).join("/");
    }

    invalidatePreviews() {
        this.previewEpoch++;
        this.previews.clear();
        this.previewRequests.clear();
        this.previewQueue = [];
        this.emit({cards: true});
    }

    setSort(sort) {
        this.sort = sort;
        this.save();
        this.emit({cards: true});
    }

    setCardHeight(value) {
        const next = normalizeCardHeight(value);
        if (next === this.cardHeight) return;
        this.cardHeight = next;
        this.save();
        this.emit({settings: true});
    }

    visibleCards(query = "") {
        const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const cards = this.cards.filter(doc => terms.every(term => doc.title.toLocaleLowerCase().includes(term)));
        if (this.sort === "updated") cards.sort((a, b) => b.mtime - a.mtime);
        if (this.sort === "title") cards.sort((a, b) => a.title.localeCompare(b.title, "zh-CN", {numeric: true}));
        return cards;
    }

    async up() {
        if (!this.selection?.id) return;
        const path = parentPath(this.selection.path);
        if (path === "/") {
            const notebook = this.notebooks.find(item => item.id === this.selection.notebookId);
            if (notebook) await this.select(this.notebookSelection(notebook));
            return;
        }
        const parent = this.documents.get(documentKey(this.selection.notebookId, path));
        if (parent) await this.select(this.documentSelection(parent));
        else {
            // Resolve a restored selection's parent from its sibling list.
            await this.loadBranch(this.selection.notebookId, parentPath(path));
            const resolved = this.documents.get(documentKey(this.selection.notebookId, path));
            if (resolved) await this.select(this.documentSelection(resolved));
        }
    }

    async refresh() {
        const selection = this.selection;
        this.generation++;
        this.controller.abort();
        this.controller = new AbortController();
        this.previewEpoch++;
        this.branches.clear();
        this.branchRequests.clear();
        this.documents.clear();
        this.previews.clear();
        this.previewRequests.clear();
        this.previewQueue = [];
        this.error = "";
        this.loading = true;
        this.emit();
        try {
            const signal = this.controller.signal;
            const notebooks = await this.api.notebooks(signal);
            if (signal.aborted || this.disposed) return;
            this.notebooks = notebooks;
            const notebook = notebooks.find(item => item.id === selection?.notebookId) || notebooks[0];
            if (notebook) await this.select(notebook.id === selection?.notebookId ? selection : this.notebookSelection(notebook));
            else { this.selection = null; this.cards = []; this.loading = false; this.emit(); }
            await this.loadExpanded();
        } catch (error) {
            if (this.disposed) return;
            this.error = error.message;
            this.loading = false;
            this.emit();
        }
    }

    dispose() {
        this.disposed = true;
        this.generation++;
        this.controller.abort();
        this.previewQueue = [];
        this.listeners.clear();
    }
}
