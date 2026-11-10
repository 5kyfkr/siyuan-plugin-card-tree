import {extractPreview} from "./content.js";
import {nativeTreeDocument} from "./native-tree.js";

const HOVER_DELAY = 250;
const CACHE_LIMIT = 100;
const CACHE_TTL = 60000;

export class NativeTreeHoverPreview {
    constructor(api, eventBus, doc = globalThis.document) {
        this.api = api;
        this.eventBus = eventBus;
        this.document = doc;
        this.cache = new Map();
        this.enabled = false;
        this.sequence = 0;
        this.active = null;
        this.onShow = event => this.show(event.detail);
        this.onHide = () => this.reset();
        this.onLock = () => this.invalidate();
        this.onScroll = event => {
            if (event.target?.closest?.(".sy__file")) this.reset(true);
        };
    }

    setEnabled(enabled) {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        if (enabled) {
            this.eventBus.on("before-show-tooltip", this.onShow);
            this.eventBus.on("before-hide-tooltip", this.onHide);
            this.eventBus.on("lock-screen", this.onLock);
            this.document.addEventListener("scroll", this.onScroll, true);
        } else {
            this.eventBus.off("before-show-tooltip", this.onShow);
            this.eventBus.off("before-hide-tooltip", this.onHide);
            this.eventBus.off("lock-screen", this.onLock);
            this.document.removeEventListener("scroll", this.onScroll, true);
            this.invalidate();
        }
    }

    show(detail) {
        this.reset();
        const doc = nativeTreeDocument(detail.target);
        if (!this.enabled || !doc || !detail.message || !detail.tooltipElement) return;
        const state = {
            doc, target: detail.target, tooltip: detail.tooltipElement,
            key: `${doc.notebookId}:${doc.id}`,
            token: String(++this.sequence), controller: new AbortController(),
        };
        this.active = state;
        const cached = this.cache.get(state.key);
        const preview = cached && Date.now() - cached.time < CACHE_TTL ? cached.preview : null;
        const container = this.document.createElement("div");
        container.className = "ct-hover-preview";
        container.dataset.ctHoverToken = state.token;
        this.render(container, preview);
        detail.message += container.outerHTML;
        // 宿主在同步事件返回后填充并定位提示框。
        queueMicrotask(() => {
            if (!this.isCurrent(state)) return;
            state.maxHeight = state.tooltip.style.maxHeight;
            this.bindImage(state);
            this.position(state);
        });
        if (preview) {
            this.cache.delete(state.key);
            this.cache.set(state.key, cached);
        } else {
            this.timer = setTimeout(() => {
                this.timer = null;
                void this.load(state);
            }, HOVER_DELAY);
        }
    }

    container(state) {
        return state.tooltip.querySelector(`.ct-hover-preview[data-ct-hover-token="${state.token}"]`);
    }

    isCurrent(state) {
        const doc = nativeTreeDocument(state.target);
        return this.enabled && this.active === state && state.target.isConnected &&
            !state.tooltip.classList.contains("fn__none") &&
            doc?.id === state.doc.id && doc.notebookId === state.doc.notebookId && Boolean(this.container(state));
    }

    async load(state) {
        if (!this.isCurrent(state)) return;
        let preview;
        try {
            const data = await this.api.preview(state.doc, state.controller.signal);
            if (!this.isCurrent(state)) return;
            preview = extractPreview(data.content, this.document.defaultView.DOMParser);
            this.cache.delete(state.key);
            this.cache.set(state.key, {preview, time: Date.now()});
            if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value);
        } catch {
            if (!this.isCurrent(state) || state.controller.signal.aborted) return;
            preview = {error: true};
        }
        this.render(this.container(state), preview);
        this.bindImage(state);
        this.position(state);
    }

    render(container, preview) {
        container.replaceChildren();
        if (preview?.image) {
            const image = this.document.createElement("img");
            image.className = "ct-hover-preview-image";
            image.alt = "";
            image.src = preview.image;
            container.append(image);
        }
        const excerpt = this.document.createElement("p");
        excerpt.className = "ct-hover-preview-excerpt";
        excerpt.textContent = !preview ? "正在读取正文摘要…" : preview.error ? "摘要暂时不可读取" :
            preview.excerpt || "这篇笔记还没有正文";
        container.append(excerpt);
    }

    bindImage(state) {
        const image = this.container(state)?.querySelector("img");
        image?.addEventListener("error", () => {
            if (!this.isCurrent(state)) return;
            image.remove();
            this.position(state);
        }, {once: true});
    }

    position(state) {
        const {tooltip, target} = state;
        const win = this.document.defaultView;
        const rect = target.parentElement.getBoundingClientRect();
        const overlay = win.navigator.windowControlsOverlay;
        const minTop = overlay?.visible && this.document.documentElement.classList.contains("window-controls-overlay") &&
            !this.document.body.classList.contains("body--fullscreen") ? Math.max(8, overlay.getTitlebarAreaRect().bottom + 4) : 8;
        tooltip.style.maxHeight = Math.max(0, win.innerHeight - minTop - 8) + "px";
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        const left = rect.right + 8 + width <= win.innerWidth - 8 ? rect.right + 8 : rect.left - width - 8;
        tooltip.style.left = Math.max(8, Math.min(left, win.innerWidth - width - 8)) + "px";
        tooltip.style.top = Math.max(minTop, Math.min(rect.top + (rect.height - height) / 2, win.innerHeight - height - 8)) + "px";
    }

    reset(restore = false) {
        clearTimeout(this.timer);
        this.timer = null;
        const state = this.active;
        this.active = null;
        if (!state) return;
        state.controller.abort();
        const container = this.container(state);
        if (!container) return;
        container.remove();
        if (restore && state.target.isConnected && !state.tooltip.classList.contains("fn__none")) {
            this.position(state);
            state.tooltip.style.maxHeight = state.maxHeight || "";
        }
    }

    invalidate() {
        this.cache.clear();
        this.reset(true);
    }

    destroy() {
        this.setEnabled(false);
    }
}
