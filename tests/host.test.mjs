import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import vm from "node:vm";

const bundle = await build({entryPoints: ["src/index.js"], bundle: true, write: false, format: "cjs", external: ["siyuan"]});

async function pluginFor(frontend) {
    const calls = {tabs: [], documents: [], dialogs: [], mounts: [], unmounts: []};
    class Plugin {
        async loadData() { return {}; }
        addTab(options) { calls.tabs.push(options); }
        addDock() {}
        addTopBar() {}
        addCommand() {}
        eventBus = {on() {}, off() {}};
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
        Setting: class {addItem() {}},
        getFrontend: () => frontend,
        openTab: options => calls.documents.push({host: "desktop", id: options.doc?.id, position: options.position}),
        openMobileFileById: (app, id) => calls.documents.push({host: "mobile", id}),
        showMessage() {},
    };
    const context = vm.createContext({
        module: {exports: {}}, require: () => siyuan,
        document: {addEventListener() {}}, fetch() {}, console, AbortController,
    });
    vm.runInContext(bundle.outputFiles[0].text, context);
    const plugin = new context.module.exports.default();
    plugin.mount = (root, host) => calls.mounts.push(host);
    plugin.unmount = root => calls.unmounts.push(root);
    await plugin.onload();
    return {plugin, calls};
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
