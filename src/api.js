export class KernelAPI {
    constructor(fetcher = globalThis.fetch.bind(globalThis)) {
        this.fetcher = fetcher;
    }

    async post(endpoint, body, signal) {
        const controller = new AbortController();
        const abort = () => controller.abort(signal.reason);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, {once: true});
        const timeout = setTimeout(() => controller.abort(new Error("请求超时，请重试")), 20000);
        try {
            const response = await this.fetcher(endpoint, {
                method: "POST",
                credentials: "same-origin",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
            const result = await response.json();
            if (result.code !== 0) throw new Error(result.msg || "文档暂不可读取，请刷新或检查笔记本是否已解锁");
            return result.data;
        } catch (error) {
            if (controller.signal.aborted && !signal?.aborted) throw new Error("请求超时，请重试");
            throw error;
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", abort);
        }
    }

    async notebooks(signal) {
        const data = await this.post("/api/notebook/lsNotebooks", {}, signal);
        return (data?.notebooks || []).filter(item => item && !item.closed && !(item.encrypted && !item.unlocked));
    }

    async children(notebook, path, signal) {
        const data = await this.post("/api/filetree/listDocsByPath", {
            notebook, path, maxListCount: 0, ignoreMaxListHint: true,
        }, signal);
        return (data?.files || []).filter(Boolean).map(file => ({
            ...file,
            notebookId: notebook,
            title: file.name || "未命名文档",
            subFileCount: Number(file.subFileCount) || 0,
        }));
    }

    async preview(doc, signal) {
        return this.post("/api/filetree/getDoc", {
            id: doc.id, notebook: doc.notebookId,
            mode: 0, size: 12, includeDocInfo: false, highlight: false,
        }, signal);
    }

    async hPath(id, signal) {
        return this.post("/api/filetree/getHPathByID", {id}, signal);
    }

    async createDoc(notebook, path, markdown = "", parentID = "", signal) {
        const body = {notebook, path, markdown};
        if (parentID) body.parentID = parentID;
        return this.post("/api/filetree/createDocWithMd", body, signal);
    }
}
