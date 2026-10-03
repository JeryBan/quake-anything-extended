/**
 * Keep a drawer out of the overview's window list and the Alt-Tab switcher.
 *
 * `Meta.Window.skip_taskbar` is read-only: mutter derives it from the window's
 * own hints, which a Wayland client we did not write will never set. (Guake
 * manages it by setting `_NET_WM_STATE_SKIP_TASKBAR` on its own X11 window —
 * not something we can do on another app's behalf.)
 *
 * Both places GNOME Shell consults it read the property from JavaScript:
 *
 *   ui/workspace.js:1333   _isOverviewWindow(w) { return !w.skip_taskbar; }
 *   ui/altTab.js:60        .filter(w => !w.skip_taskbar && ...)
 *
 * so shadowing the GObject getter with an own property on this one window is
 * enough, and leaves every other window alone. `windowAttentionHandler.js`
 * calls the C method `is_skip_taskbar()` instead, which this cannot reach —
 * that only governs urgency hints, so it does not matter here.
 *
 * If a future GNOME filters the overview differently, this quietly stops
 * working and the window reappears in the list. It cannot break the shell.
 */

const MARKER = Symbol.for('quake-anything-extended/hidden-from-overview');

type Spoofable = Record<string | symbol, unknown>;

export function isHiddenFromOverview(win: object): boolean {
    return (win as Spoofable)[MARKER] === true;
}

export function hideFromOverview(win: object): void {
    if (isHiddenFromOverview(win))
        return;

    const target = win as Spoofable;
    for (const prop of ['skip_taskbar', 'skipTaskbar']) {
        Object.defineProperty(target, prop, {
            get: () => true,
            configurable: true,
        });
    }

    Object.defineProperty(target, MARKER, {
        value: true,
        configurable: true,
    });
}

export function restoreOverviewVisibility(win: object): void {
    if (!isHiddenFromOverview(win))
        return;

    const target = win as Spoofable;
    // Deleting the own property uncovers the real getter on the prototype,
    // so the window goes back to reporting its own value rather than false.
    for (const prop of ['skip_taskbar', 'skipTaskbar'])
        delete target[prop];

    delete target[MARKER];
}
