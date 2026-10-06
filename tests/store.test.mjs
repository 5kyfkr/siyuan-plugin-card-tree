import test from "node:test";
import assert from "node:assert/strict";
import {CardTreeStore} from "../src/store.js";

function fakeAPI() {
    const calls = [];
    const api = {
        calls,
        async notebooks() { calls.push(["notebooks"]); return [{id: "box", name: "知识库", subFileCount: 2}]; },
        async children(notebook, path) {
            calls.push(["children", notebook, path]);
            if (path === "/") return [
                {id: "a", notebookId: notebook, path: "/a.sy", title: "项目", name: "项目", mtime: 2, subFileCount: 1},
                {id: "b", notebookId: notebook, path: "/b.sy", title: "读书", name: "读书", mtime: 1, subFileCount: 0},
            ];
            return [{id: "a1", notebookId: notebook, path: "/a/a1.sy", title: "计划", name: "计划", mtime: 3, subFileCount: 0}];
        },
        async preview(doc) { calls.push(["preview", doc.id]); return {content: `<p>${doc.title} 摘要</p>`}; },
    };
    return api;
}

test("selecting a document replaces the card list with direct children", async () => {
    const api = fakeAPI();
    const store = new CardTreeStore(api);
    await store.start();
    assert.equal(store.selection.title, "知识库");
    assert.deepEqual(store.cards.map(doc => doc.id), ["a", "b"]);
    await store.select(store.documentSelection(store.cards[0]));
    assert.equal(store.selection.title, "项目");
    assert.deepEqual(store.cards.map(doc => doc.id), ["a1"]);
    assert.equal(api.calls.filter(call => call[0] === "children").length, 2);
    assert.equal(store.expanded.has("box:/a.sy"), false);
    store.expanded.clear();
    await store.select(store.notebookSelection(store.notebooks[0]));
    assert.equal(store.expanded.size, 0);
});

test("visible card sorting and title filtering are local to the selected branch", async () => {
    const store = new CardTreeStore(fakeAPI(), {}, () => {});
    await store.start();
    store.setSort("updated");
    assert.deepEqual(store.visibleCards().map(doc => doc.id), ["a", "b"]);
    assert.deepEqual(store.visibleCards("读书").map(doc => doc.id), ["b"]);
});

test("card height is persisted and clamped to the supported range", () => {
    const saved = [];
    const store = new CardTreeStore(fakeAPI(), {cardHeight: 999}, data => saved.push(data));
    assert.equal(store.cardHeight, 640);
    store.setCardHeight(275);
    assert.equal(store.cardHeight, 280);
    assert.equal(saved.at(-1).cardHeight, 280);
    store.setCardHeight(1);
    assert.equal(store.cardHeight, 220);
});

test("creating a child document refreshes its parent branch", async () => {
    const api = fakeAPI();
    api.created = [];
    api.hPath = async id => id === "a" ? "/项目" : "/";
    api.createDoc = async (notebook, path, markdown, parentID) => {
        api.created.push({notebook, path, markdown, parentID});
        return "new-child";
    };
    const store = new CardTreeStore(api);
    await store.start();
    const parent = store.cards[0];
    api.children = async (notebook, path) => {
        if (path === "/") return [parent, {id: "b", notebookId: notebook, path: "/b.sy", title: "读书", name: "读书", mtime: 1, subFileCount: 0}];
        if (path === "/a.sy") return [{id: "new-child", notebookId: notebook, path: "/a/new-child.sy", title: "新文档", mtime: 3, subFileCount: 0}];
        return [];
    };
    const created = await store.createChild(parent, "新文档");
    assert.equal(api.created[0].path, "/项目/新文档");
    assert.equal(api.created[0].parentID, "a");
    assert.equal(created.id, "new-child");
    assert.equal(store.branches.get("box:/a.sy").length, 1);
});
