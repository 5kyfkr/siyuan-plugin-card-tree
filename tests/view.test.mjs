import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {CardTreeStore} from "../src/store.js";
import {CardTreeView} from "../src/view.js";

function mount(t, branches) {
    const dom = new JSDOM("<!doctype html><div id='app'></div>", {pretendToBeVisual: true});
    const globals = {
        window: dom.window, document: dom.window.document, AbortController: dom.window.AbortController,
        requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
        cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
        ResizeObserver: class { observe() {} disconnect() {} },
    };
    const original = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.assign(globalThis, globals);
    const store = new CardTreeStore({
        async notebooks() { return [{id: "box", name: "知识库"}]; },
        async children(notebook, path) { return branches[path] || []; },
        async preview() { return {content: "摘要"}; },
    }, {}, () => {}, content => ({excerpt: content}));
    const root = dom.window.document.querySelector("#app");
    const view = new CardTreeView(root, store, {open() {}}, "tab");
    t.after(() => {
        view.destroy();
        store.dispose();
        dom.window.close();
        for (const [key, descriptor] of original) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    return {store, view, root};
}

function doc(id, path, title, subFileCount = 0) {
    return {id, path, title, subFileCount, notebookId: "box", mtime: 1};
}

test("clicking a nested leaf selects its parent cards and highlights it without expanding the tree", async t => {
    const parent = doc("parent", "/parent.sy", "父文档", 1);
    const branch = doc("branch", "/parent/branch.sy", "子文档", 1);
    const leaf = doc("leaf", "/parent/branch/leaf.sy", "叶子文档");
    const {store, root} = mount(t, {"/": [parent], "/parent.sy": [branch], "/parent/branch.sy": [leaf]});
    await store.start();
    await store.toggle("box", parent.path);
    await store.toggle("box", branch.path);
    const expanded = [...store.expanded];
    root.querySelector('[data-tree-key="box:/parent/branch/leaf.sy"] .ct-tree-text').click();
    await new Promise(setImmediate);
    assert.equal(store.selection.id, "branch");
    assert.equal(root.querySelector(".ct-title").textContent, "子文档");
    assert.deepEqual(store.cards.map(item => item.id), ["leaf"]);
    assert.equal(root.querySelector(".ct-card--target")?.dataset.docId, "leaf");
    assert.deepEqual([...store.expanded], expanded);
});

test("a leaf beyond the first page is located after clearing the title filter", async t => {
    const parent = doc("parent", "/parent.sy", "父文档", 45);
    const children = Array.from({length: 45}, (_, i) => doc(`leaf-${i}`, `/parent/leaf-${i}.sy`, `笔记 ${i}`));
    const {store, root} = mount(t, {"/": [parent], "/parent.sy": children});
    await store.start();
    await store.toggle("box", parent.path);
    await store.select(store.documentSelection(parent));
    const input = root.querySelector(".ct-search-input");
    input.value = "笔记 1";
    input.dispatchEvent(new window.Event("input"));
    root.querySelector('[data-tree-key="box:/parent/leaf-44.sy"] .ct-tree-text').click();
    await new Promise(setImmediate);
    assert.equal(input.value, "");
    assert.equal(root.querySelectorAll(".ct-card").length, 45);
    assert.equal(root.querySelector(".ct-card--target")?.dataset.docId, "leaf-44");
});

test("clicking a root leaf shows notebook cards and highlights the leaf", async t => {
    const leaf = doc("leaf", "/leaf.sy", "一级叶子文档");
    const {store, root} = mount(t, {"/": [leaf]});
    await store.start();
    root.querySelector('[data-tree-key="box:/leaf.sy"] .ct-tree-text').click();
    await new Promise(setImmediate);
    assert.equal(store.selection.path, "/");
    assert.equal(root.querySelector(".ct-card--target")?.dataset.docId, "leaf");
});

test("compact navigation returns from the tree to cards without expanding the selected document", async t => {
    const parent = doc("parent", "/parent.sy", "父文档", 1);
    const leaf = doc("leaf", "/parent/leaf.sy", "子文档");
    const {store, view, root} = mount(t, {"/": [parent], "/parent.sy": [leaf]});
    await store.start();
    view.compact = true;
    root.querySelector('[data-tree-key="box:/parent.sy"] .ct-tree-text').click();
    await new Promise(setImmediate);
    assert.equal(root.dataset.treeVisible, "false");
    assert.equal(root.querySelector(".ct-tree-pane").hidden, true);
    assert.equal(root.querySelector(".ct-card").dataset.docId, "leaf");
    assert.equal(store.expanded.has("box:/parent.sy"), false);
    root.querySelector(".ct-tree-toggle").click();
    root.querySelector('[data-tree-key="box:/parent.sy"] .ct-tree-menu').click();
    assert.equal(root.querySelector(".ct-context-menu").hidden, false);
    assert.equal(store.selection.id, "parent");
});
