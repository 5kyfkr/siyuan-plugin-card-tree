import "../../src/index.css";
import {CardTreeStore} from "../../src/store.js";
import {CardTreeView} from "../../src/view.js";

function doc(id, title, path, count = 0, content = "") {
    return {id, title, path, subFileCount: count, notebookId: "knowledge", mtime: Date.UTC(2026, 9, 5, 10) / 1000, content};
}

const inbox = doc("inbox", "收集箱", "/inbox.sy");
const projects = doc("projects", "项目笔记", "/projects.sy", 2);
const reading = doc("reading", "读书笔记", "/reading.sy", 3);
const ideas = doc("ideas", "灵感备忘", "/ideas.sy");
const research = doc("research", "资料整理", "/projects/research.sy", 0,
    "<p>把零散资料，整理成可复用的知识。</p><p>本周收集了产品案例、设计参考和实现方案。先归纳共同问题，再记录值得尝试的做法。</p><p>• 收集：保留来源与关键摘录<br>• 整理：按主题建立笔记层级<br>• 回顾：把结论连接到具体项目</p>");
const design = doc("design", "页面设计", "/projects/design.sy", 2,
    "<p>让导航清楚，让内容更容易阅读。</p><p>左侧保留文档层级，右侧先看正文摘要。需要深入时，再打开笔记或进入下一层。</p><p>设计记录<br>留白紧凑，标题层级明确。<br>卡片随空间自动分列。<br>颜色与字体跟随思源主题。</p>");
const branches = {
    "/": [inbox, projects, reading, ideas],
    "/projects.sy": [research, design],
    "/projects/design.sy": [
        doc("layout", "布局与留白", "/projects/design/layout.sy"),
        doc("type", "文字与层级", "/projects/design/type.sy"),
    ],
};
const api = {
    async notebooks() { return [{id: "knowledge", name: "知识库", subFileCount: 4}, {id: "daily", name: "日常记录", subFileCount: 0}]; },
    async children(notebook, path) { return notebook === "knowledge" ? branches[path] || [] : []; },
    async preview(doc) { return {content: doc.content}; },
};
const store = new CardTreeStore(api, {
    selection: {notebookId: "knowledge", path: projects.path, id: projects.id, title: projects.title},
    expanded: ["knowledge:/", "knowledge:/projects.sy"],
});
new CardTreeView(document.querySelector("#workspace"), store, {open() {}, workspace() {}}, "tab");
await store.start();
await Promise.all([research, design].map(async doc => {
    store.previews.set(store.previewKey(doc), store.parse((await api.preview(doc)).content));
}));
store.emit({cards: true});
document.documentElement.dataset.ready = "true";
