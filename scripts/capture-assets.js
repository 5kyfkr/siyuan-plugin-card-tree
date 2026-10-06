async (page) => {
    await page.setViewportSize({width: 1024, height: 768});
    await page.goto("http://127.0.0.1:4178/marketplace.html");
    await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
    await page.evaluate(() => document.fonts.ready);
    const cards = page.locator(".ct-card");
    if (await cards.count() !== 2) throw new Error("Preview must display the two example notes");
    if (await page.locator(".ct-card-excerpt").first().textContent() === "正在读取正文摘要…") throw new Error("Preview content has not loaded");
    if (await page.locator(".ct-card-leaf").count()) throw new Error("Leaf cards must not display a leaf label");
    const geometry = await cards.first().evaluate(node => {
        const card = node.getBoundingClientRect();
        const viewport = node.closest(".ct-card-scroll").getBoundingClientRect();
        return {bottom: card.bottom, viewportBottom: viewport.bottom};
    });
    if (geometry.bottom > geometry.viewportBottom) throw new Error("The main cards are clipped in the preview");
    await page.screenshot({path: "preview.png", animations: "disabled"});
    await page.setViewportSize({width: 160, height: 160});
    await page.goto("http://127.0.0.1:4178/marketplace-icon.svg");
    await page.screenshot({path: "icon.png", omitBackground: true, animations: "disabled"});
    return {icon: "icon.png (160×160)", preview: "preview.png (1024×768)", note: "Rendered from the plugin's own view with example notes"};
}
