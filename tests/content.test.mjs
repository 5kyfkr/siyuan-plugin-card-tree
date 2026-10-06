import test from "node:test";
import assert from "node:assert/strict";
import {JSDOM} from "jsdom";
import {extractPreview, localAssetURL, parentPath} from "../src/content.js";

test("extractPreview removes executable markup and returns a bounded text preview", () => {
    const source = `<div contenteditable="true"><h1>标题</h1><p>第一段 <strong>内容</strong></p><script>window.pwned=1</script><img src="assets/cover.png" /></div>`;
    const dom = new JSDOM("<!doctype html><body></body>");
    const result = extractPreview(source, dom.window.DOMParser);
    assert.equal(result.excerpt, "标题\n第一段 内容");
    assert.equal(result.image, "/assets/cover.png");
    assert.equal(dom.window.pwned, undefined);
});

test("asset and path filters reject traversal and external images", () => {
    assert.equal(localAssetURL("https://example.com/x.png"), "");
    assert.equal(localAssetURL("assets/../secret.png"), "");
    assert.equal(localAssetURL("assets/cover.png?x=1"), "/assets/cover.png");
    assert.equal(parentPath("/a/b.sy"), "/a.sy");
    assert.equal(parentPath("/a/b/c.sy"), "/a/b.sy");
    assert.equal(parentPath("/a.sy"), "/");
});
