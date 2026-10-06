export function overlayScrollbar(scroller) {
    const area = scroller.parentElement;
    const track = document.createElement("div");
    track.className = "ct-scrollbar";
    track.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("div");
    thumb.className = "ct-scrollbar-thumb";
    track.append(thumb);
    area.append(track);

    const events = new AbortController();
    const options = {signal: events.signal};
    let frame = 0;
    let timer;
    let drag;
    let range = 0;
    let travel = 0;
    let thumbHeight = 0;

    function update() {
        range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        track.hidden = range === 0 || scroller.clientHeight === 0;
        if (track.hidden) return;
        const height = track.clientHeight;
        thumbHeight = Math.min(height, Math.max(28, height * scroller.clientHeight / scroller.scrollHeight));
        travel = height - thumbHeight;
        thumb.style.height = `${thumbHeight}px`;
        thumb.style.transform = `translateY(${travel * Math.min(1, Math.max(0, scroller.scrollTop / range))}px)`;
    }

    function scheduleUpdate() {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); });
    }

    function move(event) {
        if (!drag || drag.pointerId !== event.pointerId || travel <= 0) return;
        const position = event.clientY - track.getBoundingClientRect().top - drag.offset;
        scroller.scrollTop = Math.min(1, Math.max(0, position / travel)) * range;
    }

    track.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        update();
        drag = {
            pointerId: event.pointerId,
            offset: event.target === thumb ? event.clientY - thumb.getBoundingClientRect().top : thumbHeight / 2,
        };
        area.dataset.dragging = "true";
        track.setPointerCapture(event.pointerId);
        move(event);
    }, options);
    track.addEventListener("pointermove", move, options);
    const stopDrag = () => {
        drag = null;
        delete area.dataset.dragging;
    };
    track.addEventListener("pointerup", stopDrag, options);
    track.addEventListener("pointercancel", stopDrag, options);
    track.addEventListener("lostpointercapture", stopDrag, options);
    scroller.addEventListener("scroll", () => {
        scheduleUpdate();
        area.dataset.scrolling = "true";
        clearTimeout(timer);
        timer = setTimeout(() => { delete area.dataset.scrolling; }, 900);
    }, {signal: events.signal, passive: true});

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    update();

    return () => {
        events.abort();
        observer.disconnect();
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        delete area.dataset.scrolling;
        delete area.dataset.dragging;
        track.remove();
    };
}
