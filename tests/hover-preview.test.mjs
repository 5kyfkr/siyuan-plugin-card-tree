import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {NativeTreeHoverPreview} from "../src/hover-preview.js";
import {nativeTreeDocument} from "../src/native-tree.js";

function harness(t) {
    t.mock.timers.enable({apis: ["setTimeout"]});
    const dom = new JSDOM(`<!doctype html><body>
        <div class="sy__file"><ul data-url="notebook">
            <li data-type="navigation-root"><span class="b3-list-item__text">笔记本</span></li>
            <li data-type="navigation-file" data-node-id="doc-a" data-path="/doc-a.sy">
                <span class="b3-list-item__icon">图标</span><span class="b3-list-item__text">文档 A</span>
                <span class="b3-list-item__action">菜单</span>
            </li>
        </ul><li data-type="navigation-file" data-node-id="doc-b" data-tree-key="notebook:notebook/doc-b">
            <span class="b3-list-item__text">文档 B</span>
        </li></div>
        <div class="sy__bookmark"><li data-type="navigation-file" data-node-id="bookmark"><span class="b3-list-item__text">书签</span></li></div>
        <div id="tooltip" class="tooltip fn__none"></div>
    </body>`);
    const {document} = dom.window;
    const listeners = new Map();
    const bus = {
        on(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
        },
        off(type, callback) { listeners.get(type)?.delete(callback); },
        emit(type, detail) { listeners.get(type)?.forEach(callback => callback({detail})); },
    };
    const requests = [];
    const api = {preview(doc, signal) {
        return new Promise((resolve, reject) => requests.push({doc, signal, resolve, reject}));
    }};
    const preview = new NativeTreeHoverPreview(api, bus, document);
    const tooltip = document.getElementById("tooltip");
    const a = document.querySelector('[data-node-id="doc-a"] .b3-list-item__text');
    const b = document.querySelector('[data-node-id="doc-b"] .b3-list-item__text');
    const show = (target = a, message = "<strong>文档信息</strong><br>更新于昨天") => {
        const detail = {target, message, tooltipElement: tooltip};
        bus.emit("before-show-tooltip", detail);
        tooltip.className = "tooltip";
        tooltip.innerHTML = detail.message;
        return detail;
    };
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const start = async (target = a) => {
        show(target);
        await flush();
        t.mock.timers.tick(250);
        await flush();
        return requests.at(-1);
    };
    t.after(() => { preview.destroy(); dom.window.close(); });
    return {preview, bus, listeners, requests, tooltip, document, a, b, show, start, flush};
}

test("native hover targets support legacy and virtual rows and exclude other controls", t => {
    const h = harness(t);
    assert.deepEqual(nativeTreeDocument(h.a), {id: "doc-a", notebookId: "notebook"});
    assert.deepEqual(nativeTreeDocument(h.b), {id: "doc-b", notebookId: "notebook"});
    for (const selector of [".b3-list-item__icon", ".b3-list-item__action", "[data-type='navigation-root'] span", ".sy__bookmark span"]) {
        assert.equal(nativeTreeDocument(h.document.querySelector(selector)), null);
    }
    h.b.parentElement.setAttribute("aria-disabled", "true");
    assert.equal(nativeTreeDocument(h.b), null);
});

test("disabled preview does no work and enabled previews debounce and cache independently of the card view", async t => {
    const h = harness(t);
    h.show();
    t.mock.timers.tick(1000);
    assert.equal(h.requests.length, 0);
    assert.equal(h.tooltip.querySelector(".ct-hover-preview"), null);
    h.preview.setEnabled(true);
    h.show();
    await h.flush();
    assert.match(h.tooltip.textContent, /正在读取/);
    t.mock.timers.tick(249);
    assert.equal(h.requests.length, 0);
    t.mock.timers.tick(1);
    assert.equal(h.requests.length, 1);
    h.requests[0].resolve({content: '<p>正文 &lt;img onerror=alert(1)&gt;</p><script>alert(1)</script><img src="assets/cover.png">'});
    await h.flush();
    assert.match(h.tooltip.textContent, /文档信息.*更新于昨天/s);
    assert.match(h.tooltip.textContent, /正文 <img onerror=alert\(1\)>/);
    assert.equal(h.tooltip.querySelector("script, [onerror]"), null);
    assert.equal(h.tooltip.querySelector("img").getAttribute("src"), "/assets/cover.png");
    h.show();
    assert.match(h.tooltip.textContent, /正文/);
    await h.flush();
    t.mock.timers.tick(1000);
    assert.equal(h.requests.length, 1);
});

test("switching targets aborts requests and late responses cannot replace another tooltip", async t => {
    const h = harness(t);
    h.preview.setEnabled(true);
    const first = await h.start();
    const second = await h.start(h.b);
    assert.equal(first.signal.aborted, true);
    first.resolve({content: "<p>旧正文</p>"});
    second.resolve({content: "<p>新正文</p>"});
    await h.flush();
    assert.match(h.tooltip.textContent, /新正文/);
    assert.doesNotMatch(h.tooltip.textContent, /旧正文/);
    h.show(h.document.querySelector(".b3-list-item__action"), "菜单提示");
    assert.equal(h.tooltip.textContent, "菜单提示");
    assert.equal(h.tooltip.querySelector(".ct-hover-preview"), null);
});

test("hide and disable cancel pending work and disabling restores the native message", async t => {
    const h = harness(t);
    h.preview.setEnabled(true);
    h.show();
    h.bus.emit("before-hide-tooltip", {tooltipElement: h.tooltip});
    h.tooltip.classList.add("fn__none");
    t.mock.timers.tick(1000);
    assert.equal(h.requests.length, 0);
    const request = await h.start();
    h.preview.setEnabled(false);
    assert.equal(request.signal.aborted, true);
    assert.equal(h.tooltip.querySelector(".ct-hover-preview"), null);
    assert.equal(h.tooltip.textContent, "文档信息更新于昨天");
    assert.equal(h.listeners.get("before-show-tooltip").size, 0);
    request.resolve({content: "<p>关闭后的正文</p>"});
    await h.flush();
    assert.doesNotMatch(h.tooltip.textContent, /关闭后的正文/);
});

test("recycled or detached rows cannot receive a pending response", async t => {
    const h = harness(t);
    h.preview.setEnabled(true);
    const request = await h.start(h.b);
    h.b.parentElement.setAttribute("data-node-id", "doc-c");
    request.resolve({content: "<p>已回收行的正文</p>"});
    await h.flush();
    assert.doesNotMatch(h.tooltip.textContent, /已回收行的正文/);
    const detached = await h.start();
    h.a.parentElement.remove();
    detached.resolve({content: "<p>已移除行的正文</p>"});
    await h.flush();
    assert.doesNotMatch(h.tooltip.textContent, /已移除行的正文/);
});

test("empty documents, errors and broken images retain native document information", async t => {
    const h = harness(t);
    h.preview.setEnabled(true);
    (await h.start()).resolve({content: ""});
    await h.flush();
    assert.match(h.tooltip.textContent, /这篇笔记还没有正文/);
    h.preview.invalidate();
    (await h.start()).reject(new Error("offline"));
    await h.flush();
    assert.match(h.tooltip.textContent, /摘要暂时不可读取/);
    (await h.start()).resolve({content: '<p>正文</p><img src="assets/missing.png">'});
    await h.flush();
    h.tooltip.querySelector("img").dispatchEvent(new h.document.defaultView.Event("error"));
    assert.equal(h.tooltip.querySelector("img"), null);
    assert.match(h.tooltip.textContent, /文档信息.*正文/s);
});

test("lock, invalidation and destroy clear cached content and active requests", async t => {
    const h = harness(t);
    h.preview.setEnabled(true);
    (await h.start()).resolve({content: "<p>原正文</p>"});
    await h.flush();
    assert.equal(h.preview.cache.size, 1);
    h.bus.emit("lock-screen");
    assert.equal(h.preview.cache.size, 0);
    assert.equal(h.tooltip.querySelector(".ct-hover-preview"), null);
    const request = await h.start();
    h.preview.destroy();
    assert.equal(request.signal.aborted, true);
    assert.equal([...h.listeners.values()].every(listeners => !listeners.size), true);
});

test("cache entries expire and notebook identity prevents reusing another notebook's content", async t => {
    const h = harness(t);
    let now = 100000;
    t.mock.method(Date, "now", () => now);
    h.preview.setEnabled(true);
    (await h.start(h.b)).resolve({content: "<p>原笔记本正文</p>"});
    await h.flush();
    now += 60001;
    h.show(h.b);
    assert.match(h.tooltip.textContent, /正在读取/);
    await h.flush();
    t.mock.timers.tick(250);
    h.requests.at(-1).resolve({content: "<p>更新的正文</p>"});
    await h.flush();
    h.b.parentElement.setAttribute("data-tree-key", "notebook:other/doc-b");
    const request = await h.start(h.b);
    assert.equal(request.doc.notebookId, "other");
    assert.doesNotMatch(h.tooltip.textContent, /更新的正文/);
    h.b.parentElement.setAttribute("data-tree-key", "notebook:third/doc-b");
    request.resolve({content: "<p>其他笔记本正文</p>"});
    await h.flush();
    assert.doesNotMatch(h.tooltip.textContent, /其他笔记本正文/);
});

test("tree scrolling cancels pending content and positioning respects native window controls", async t => {
    const h = harness(t);
    h.document.documentElement.classList.add("window-controls-overlay");
    h.document.defaultView.navigator.windowControlsOverlay = {visible: true, getTitlebarAreaRect: () => ({bottom: 40})};
    h.preview.setEnabled(true);
    const request = await h.start();
    assert.equal(h.tooltip.style.top, "44px");
    h.document.querySelector(".sy__file").dispatchEvent(new h.document.defaultView.Event("scroll"));
    assert.equal(request.signal.aborted, true);
    assert.equal(h.tooltip.querySelector(".ct-hover-preview"), null);
});
