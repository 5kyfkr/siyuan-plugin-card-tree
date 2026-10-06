import {Plugin, Setting, Dialog, getFrontend, openMobileFileById, openTab, showMessage} from "siyuan";
import {KernelAPI} from "./api.js";
import {CardTreeStore} from "./store.js";
import {CardTreeView} from "./view.js";
import {nativeTreeSelection} from "./native-tree.js";

const TAB_TYPE = "card-workspace";
const DOCK_TYPE = "child-cards";
const SETTINGS_FILE = "settings.json";
const CARD_HEIGHT_SETTING = "cardHeight";
const TREE_COMMANDS = new Set([
    "create", "rename", "removeDoc", "moveDocs", "sort", "docSortModeChanged",
    "mount", "unmount", "closeBox", "removeBox", "renamenotebook", "opened-notebook",
    "heading2doc", "li2doc", "createdailynote", "docsImported", "notebookIconChanged",
    "lockNotebook", "unlockNotebook", "boxDocFeatureChanged",
]);

export default class CardTreePlugin extends Plugin {
    async onload() {
        this.views = new Map();
        this.disposed = false;
        this.pendingSettings = null;
        this.writeQueue = Promise.resolve();
        this.frontend = getFrontend();
        this.mobile = ["mobile", "browser-mobile"].includes(this.frontend);
        let settings = {};
        try { settings = await this.loadData(SETTINGS_FILE) || {}; }
        catch (error) { console.warn("[card-tree] Settings could not be loaded", error); }
        if (this.disposed) return;
        this.store = new CardTreeStore(new KernelAPI(), settings, data => this.scheduleSave(data));
        this.cardHeightDraft = this.store.cardHeight;
        this.setting = new Setting({
            width: "560px",
            height: "360px",
            confirmCallback: () => this.store.setCardHeight(this.cardHeightDraft),
        });
        this.setting.addItem({
            title: "卡片固定高度",
            description: "所有卡片使用统一高度，范围 220–640 px。正文摘要超出后会截断。",
            createActionElement: () => {
                const input = document.createElement("input");
                input.className = "b3-text-field";
                input.type = "number";
                input.min = "220";
                input.max = "640";
                input.step = "10";
                input.value = String(this.store.cardHeight);
                input.title = "卡片固定高度（像素）";
                input.addEventListener("input", () => { this.cardHeightDraft = input.value; });
                return input;
            },
        });
        const plugin = this;
        if (!this.mobile && this.frontend !== "desktop-window") {
            this.addTab({
                type: TAB_TYPE,
                init() { plugin.mount(this.element, "tab"); },
                destroy() { plugin.unmount(this.element); },
            });
        }
        this.addDock({
            type: DOCK_TYPE,
            data: {},
            config: {
                position: "RightTop", size: {width: 420, height: 500},
                icon: "iconFiles", title: "子笔记卡片", index: 0, show: true,
            },
            init() { plugin.mount(this.element, "dock"); },
            destroy() { plugin.unmount(this.element); },
        });
        this.addTopBar({icon: "iconFiles", title: "打开卡片文档树", position: "right", callback: () => this.openWorkspace()});
        this.addCommand({langKey: "openCardTree", langText: "打开卡片文档树", callback: () => this.openWorkspace()});
        this.onNativeClick = event => {
            if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !this.views.size) return;
            const selection = nativeTreeSelection(event.target);
            if (selection) this.store.select(selection);
        };
        this.onWS = event => {
            if (!this.views.size || this.disposed) return;
            const cmd = event.detail?.cmd;
            if (TREE_COMMANDS.has(cmd)) this.scheduleRefresh();
            else if (cmd === "transactions") {
                clearTimeout(this.contentTimer);
                this.contentTimer = setTimeout(() => {
                    if (!this.disposed && !this.store.loading) this.store.invalidatePreviews();
                }, 1800);
            }
        };
        this.onSync = () => { if (this.views.size) this.scheduleRefresh(); };
        this.eventBus.on("ws-main", this.onWS);
        this.eventBus.on("sync-end", this.onSync);
        this.eventBus.on("opened-notebook", this.onSync);
        this.eventBus.on("closed-notebook", this.onSync);
        document.addEventListener("click", this.onNativeClick, true);
    }

    mount(root, host) {
        if (!root || this.disposed || this.views.has(root)) return;
        const view = new CardTreeView(root, this.store, {
            open: id => this.openDocument(id),
            workspace: () => this.openWorkspace(),
        }, host);
        this.views.set(root, view);
        this.store.start();
    }

    unmount(root) {
        this.views.get(root)?.destroy();
        this.views.delete(root);
    }

    openWorkspace() {
        if (this.disposed) return;
        if (this.mobile || this.frontend === "desktop-window") {
            if (this.workspaceDialog) return;
            const dialog = new Dialog({
                title: "卡片文档树",
                content: '<div class="ct-dialog-root"></div>',
                width: this.mobile ? "100vw" : "min(960px, 92vw)",
                height: this.mobile ? "100dvh" : "85vh",
                containerClassName: this.mobile ? "ct-workspace-dialog ct-workspace-dialog--mobile" : "ct-workspace-dialog",
                destroyCallback: () => {
                    this.unmount(root);
                    if (this.workspaceDialog === dialog) this.workspaceDialog = null;
                },
            });
            const root = dialog.element.querySelector(".ct-dialog-root");
            this.workspaceDialog = dialog;
            this.mount(root, this.mobile ? "mobile" : "dialog");
            return;
        }
        openTab({
            app: this.app,
            custom: {id: this.name + TAB_TYPE, title: "卡片文档树", icon: "iconFiles"},
        });
    }

    openDocument(id) {
        try {
            if (this.mobile) {
                this.workspaceDialog?.destroy();
                return openMobileFileById(this.app, id);
            }
            if (this.frontend === "desktop-window") this.workspaceDialog?.destroy();
            const hasWorkspace = [...this.views.values()].some(view => view.root.dataset.host === "tab");
            return openTab({app: this.app, doc: {id}, position: hasWorkspace ? "right" : undefined});
        } catch (error) {
            showMessage("打开笔记失败：" + error.message, 5000, "error");
        }
    }

    scheduleRefresh() {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
            if (!this.disposed) this.store.refresh();
        }, 500);
    }

    scheduleSave(settings) {
        this.pendingSettings = settings;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSettings(), 400);
    }

    flushSettings() {
        if (!this.pendingSettings) return this.writeQueue;
        const settings = this.pendingSettings;
        this.pendingSettings = null;
        this.writeQueue = this.writeQueue.then(() => this.saveData(SETTINGS_FILE, settings)).catch(error => {
            console.warn("[card-tree] Settings could not be saved", error);
        });
        return this.writeQueue;
    }

    async onunload() {
        this.disposed = true;
        this.workspaceDialog?.destroy();
        clearTimeout(this.saveTimer);
        clearTimeout(this.refreshTimer);
        clearTimeout(this.contentTimer);
        document.removeEventListener("click", this.onNativeClick, true);
        if (this.onWS) this.eventBus.off("ws-main", this.onWS);
        if (this.onSync) {
            this.eventBus.off("sync-end", this.onSync);
            this.eventBus.off("opened-notebook", this.onSync);
            this.eventBus.off("closed-notebook", this.onSync);
        }
        this.views?.forEach(view => view.destroy());
        this.views?.clear();
        this.store?.dispose();
        await this.flushSettings();
    }
}
