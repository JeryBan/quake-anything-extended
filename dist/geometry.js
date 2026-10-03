/** Clamp/validate a monitor index; fall back to current monitor if invalid. */
export function sanitizeMonitorIndex(monitorIndex) {
    const display = global.display;
    const n = display.get_n_monitors();
    if (n <= 0)
        return 0;
    if (Number.isInteger(monitorIndex) && monitorIndex >= 0 && monitorIndex < n)
        return monitorIndex;
    const current = display.get_current_monitor();
    if (Number.isInteger(current) && current >= 0 && current < n)
        return current;
    return 0;
}

export function isValidRect(rect) {
    return (Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0);
}

export function getPointerMonitorIndex() {
    const [x, y] = global.get_pointer();
    const display = global.display;
    const n = display.get_n_monitors();
    for (let i = 0; i < n; i++) {
        const geo = display.get_monitor_geometry(i);
        if (x >= geo.x && x < geo.x + geo.width && y >= geo.y && y < geo.y + geo.height)
            return i;
    }
    return sanitizeMonitorIndex(display.get_current_monitor());
}

export function getWorkAreaForMonitor(monitorIndex) {
    const index = sanitizeMonitorIndex(monitorIndex);
    const workspace = global.workspace_manager.get_active_workspace();
    const area = workspace.get_work_area_for_monitor(index);
    return {
        x: area.x,
        y: area.y,
        width: area.width,
        height: area.height,
    };
}

/** Pure placement maths. `work` is the target work area in absolute coords. */
export function computeRectInArea(side, sizePercent, widthPercent, work) {
    const sp = Math.min(90, Math.max(10, sizePercent)) / 100;
    const wp = Math.min(100, Math.max(10, widthPercent)) / 100;
    switch (side) {
        case 'top':
        case 'bottom': {
            const height = Math.round(work.height * sp);
            const width = Math.round(work.width * wp);
            const x = work.x + Math.round((work.width - width) / 2);
            const y = side === 'top'
                ? work.y
                : work.y + work.height - height;
            return { x, y, width, height };
        }
        case 'left':
            return {
                x: work.x,
                y: work.y,
                width: Math.round(work.width * sp),
                height: work.height,
            };
        case 'right': {
            const width = Math.round(work.width * sp);
            return {
                x: work.x + work.width - width,
                y: work.y,
                width,
                height: work.height,
            };
        }
    }
}

export function computeQuakeRect(side, sizePercent, widthPercent, monitorIndex) {
    return computeRectInArea(side, sizePercent, widthPercent, getWorkAreaForMonitor(monitorIndex));
}

export function slideOffsetForSide(side, rect) {
    switch (side) {
        case 'top':
            return { x: 0, y: -rect.height };
        case 'bottom':
            return { x: 0, y: rect.height };
        case 'left':
            return { x: -rect.width, y: 0 };
        case 'right':
            return { x: rect.width, y: 0 };
    }
}
