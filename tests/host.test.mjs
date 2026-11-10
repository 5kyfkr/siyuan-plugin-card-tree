import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import vm from "node:vm";
import {JSDOM} from "jsdom";

const bundle = await build({entryPoints: ["src/index.js"], bundle: true, write: false, format: "cjs", external: ["siyuan"]});

async function pluginFor(frontend, settings = {}) {
    const dom = new JSDOM("<!doctype html><body></body>");
    const calls = {tabs: [], documents: [], dialogs: [], mounts: [], unmounts: [], saved: []};
    class EventBus {
        listeners = new Map();
        on(type, callback) {
            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(callback);
        }
        off(type, callback) { this.listeners.get(type)?.delete(callback); }
        emit(type, detail) { this.listeners.get(type)?.forEach(callback => callback({detail})); }
    }
    class Plugin {
        async loadData() { return settings; }
        async saveData(name, data) { calls.saved.push({name, data}); }
        addTab(options) { calls.tabs.push(options); }
        addDock() {}
        addTopBar() {}
        addCommand() {}
        eventBus = new EventBus();
    }
    class Dialog {
        constructor(options) {
            this.options = options;
            this.root = {dataset: {}};
            this.element = {querySelector: () => this.root};
            calls.dialogs.push(this);
        }
        destroy() { this.options.destroyCallback(); }
    }
    const siyuan = {
        Plugin, Dialog,
        Setting: class {
            items = [];
            addItem(item) { this.items.push(item); }
        },
        getFrontend: () => frontend,
        openTab: options => calls.documents.push({host: "desktop", id: options.doc?.id, position: options.position}),
        openMobileFileById: (app, id) => calls.documents.push({host: "mobile", id}),
        showMessage() {},
    };
    const context = vm.createContext({
        module: {exports: {}}, require: () => siyuan,
        document: dom.window.document, fetch() {}, console, AbortController,
        setTimeout, clearTimeout, queueMicrotask,
    });
    vm.runInContext(bundle.outputFiles[0].text, context);
    const plugin = new context.module.exports.default();
    plugin.mount = (root, host) => calls.mounts.push(host);
    plugin.unmount = root => calls.unmounts.push(root);
    await plugin.onload();
    return {plugin, calls, dom};
}

test("mobile clients open a workspace and documents without calling the desktop tab API", async () => {
    for (const frontend of ["mobile", "browser-mobile"]) {
        const {plugin, calls} = await pluginFor(frontend);
        assert.equal(calls.tabs.length, 0);
        plugin.openWorkspace();
        plugin.openWorkspace();
        assert.equal(calls.dialogs.length, 1);
        assert.deepEqual(calls.mounts, ["mobile"]);
        plugin.openDocument("note");
        assert.deepEqual(calls.documents, [{host: "mobile", id: "note"}]);
        assert.equal(calls.unmounts.length, 1);
        assert.equal(plugin.workspaceDialog, null);
    }
});

test("desktop workspaces keep opening notes in the right pane", async () => {
    const {plugin, calls} = await pluginFor("desktop");
    assert.equal(calls.tabs.length, 1);
    plugin.views.set({}, {root: {dataset: {host: "tab"}}});
    plugin.openDocument("note");
    assert.deepEqual(calls.documents, [{host: "desktop", id: "note", position: "right"}]);
});

test("the separate hover switch is on by default, applies immediately and survives other setting saves", async t => {
    const selection = {notebookId: "box", path: "/saved.sy", id: "saved", title: "已保存的选择"};
    const {plugin, calls, dom} = await pluginFor("desktop", {selection});
    t.after(async () => { await plugin.onunload(); dom.window.close(); });
    const toggle = plugin.setting.items.find(item => item.title === "文档树悬停内容预览").createActionElement();
    assert.equal(toggle.checked, true);
    assert.equal(plugin.hoverPreview.enabled, true);
    toggle.checked = true;
    toggle.dispatchEvent(new dom.window.Event("change"));
    assert.equal(plugin.hoverPreview.enabled, true);
    plugin.store.setCardHeight(400);
    await plugin.flushSettings();
    assert.equal(calls.saved.at(-1).data.hoverPreviewEnabled, true);
    assert.equal(calls.saved.at(-1).data.selection, selection);
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event("change"));
    assert.equal(plugin.hoverPreview.enabled, false);
    await plugin.flushSettings();
    assert.equal(calls.saved.at(-1).data.hoverPreviewEnabled, false);
});

test("an explicitly disabled hover preference is preserved on reload", async t => {
    const {plugin, dom} = await pluginFor("desktop", {hoverPreviewEnabled: false});
    t.after(async () => { await plugin.onunload(); dom.window.close(); });
    assert.equal(plugin.hoverPreview.enabled, false);
    const toggle = plugin.setting.items.find(item => item.title === "文档树悬停内容预览").createActionElement();
    assert.equal(toggle.checked, false);
});

test("saved hover preference works without card views and content events invalidate it", async t => {
    const {plugin, dom} = await pluginFor("browser-desktop", {hoverPreviewEnabled: true});
    t.after(async () => { await plugin.onunload(); dom.window.close(); });
    assert.equal(plugin.views.size, 0);
    assert.equal(plugin.hoverPreview.enabled, true);
    const document = dom.window.document;
    document.body.innerHTML = '<div class="sy__file"><li data-type="navigation-file" data-node-id="doc"><span class="b3-list-item__text">文档</span></li></div><div id="tooltip"></div>';
    const target = document.querySelector("span");
    const tooltipElement = document.getElementById("tooltip");
    for (const [type, detail] of [["ws-main", {cmd: "transactions"}], ["ws-main", {cmd: "lockNotebook"}], ["sync-end"], ["closed-notebook"]]) {
        plugin.hoverPreview.cache.set(":doc", {time: Date.now(), preview: {excerpt: "正文摘要"}});
        const show = {target, tooltipElement, message: "文档信息"};
        plugin.eventBus.emit("before-show-tooltip", show);
        tooltipElement.innerHTML = show.message;
        await new Promise(resolve => setImmediate(resolve));
        assert.match(tooltipElement.textContent, /正文摘要/);
        plugin.eventBus.emit(type, detail);
        assert.equal(plugin.hoverPreview.cache.size, 0);
        assert.equal(tooltipElement.textContent, "文档信息");
    }
});

test("mobile preserves the preference but disables the mouse hover feature", async t => {
    const {plugin, dom} = await pluginFor("mobile", {hoverPreviewEnabled: true});
    t.after(async () => { await plugin.onunload(); dom.window.close(); });
    const toggle = plugin.setting.items.find(item => item.title === "文档树悬停内容预览").createActionElement();
    assert.equal(toggle.checked, true);
    assert.equal(toggle.disabled, true);
    assert.equal(plugin.hoverPreview.enabled, false);
    assert.equal(plugin.store.settings().hoverPreviewEnabled, true);
});
