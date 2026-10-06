import "../src/index.css";
import {CardTreeStore} from "../src/store.js";
import {CardTreeView} from "../src/view.js";

const entries = [
    {id: "p-1", title: "年度计划", path: "/p-1.sy", notebookId: "b1", mtime: 1710000000, subFileCount: 3, excerpt: "把长期目标分成可执行的季度计划。"},
    {id: "p-2", title: "阅读札记", path: "/p-2.sy", notebookId: "b1", mtime: 1711000000, subFileCount: 2, excerpt: "书、文章和问题之间的连接。"},
    {id: "p-3", title: "灵感收集", path: "/p-3.sy", notebookId: "b1", mtime: 1712000000, subFileCount: 0, excerpt: "还没有子笔记，正文里有几段值得回看的想法。"},
];
const branches = {
    "/": entries,
    "/p-1.sy": [
        {id: "plan-1", title: "第一步", path: "/p-1/plan-1.sy", notebookId: "b1", mtime: 1713000000, subFileCount: 0},
        {id: "plan-2", title: "季度计划", path: "/p-1/plan-2.sy", notebookId: "b1", mtime: 1713000000, subFileCount: 1},
        {id: "plan-3", title: "回顾", path: "/p-1/plan-3.sy", notebookId: "b1", mtime: 1713000000, subFileCount: 0},
    ],
    "/p-1/plan-2.sy": [
        {id: "quarter-1", title: "本月任务", path: "/p-1/plan-2/quarter-1.sy", notebookId: "b1", mtime: 1713000000, subFileCount: 0},
    ],
    "/p-2.sy": [
        {id: "reading-1", title: "书摘", path: "/p-2/reading-1.sy", notebookId: "b1", mtime: 1713000000, subFileCount: 0},
        {id: "reading-2", title: "感想", path: "/p-2/reading-2.sy", notebookId: "b1", mtime: 1713000000, subFileCount: 0},
    ],
};
const api = {
    async notebooks() { return [{id: "b1", name: "个人知识库", subFileCount: entries.length}]; },
    async children(notebook, path) { return branches[path] || []; },
    async preview(doc) { return {content: `<p>${doc.excerpt || "这篇笔记正在形成中。"}</p><p>这是正文摘要的第二行，卡片会按需请求真实文档内容。</p>`}; },
};
const root = document.querySelector("#app");
const store = new CardTreeStore(api);
const host = new URLSearchParams(location.search).get("host") === "mobile" ? "mobile" : "tab";
new CardTreeView(root, store, {open(id) { document.title = `已选择：${id}`; }, workspace() {}}, host);
store.start();
