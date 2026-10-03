import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    computeQuakeRect,
    getPointerMonitorIndex,
    isValidRect,
    sanitizeMonitorIndex,
    slideOffsetForSide,
} from './geometry.js';
import {hideFromOverview, restoreOverviewVisibility} from './overview-visibility.js';
import {formatMessage, type QuakeEntry} from './types.js';

// Persistent module-level state to remember windows and their geometries
// across disable/enable cycles (such as when the system is suspended).
const PERSISTENT_WINDOWS = new Map<number, string>();
const PERSISTENT_MONITOR = new Map<string, number>();

const ANIM_MS = 180;
const CLAIM_TIMEOUT_MS = 8000;
const FIRST_FRAME_FALLBACK_MS = 750;

interface PendingClaim {
    entryId: string;
    appId: string;
    timeoutId: number;
}

interface FirstFrameWatch {
    actor: Clutter.Actor;
    fallbackId: number;
}

/**
 * Return a window to a plain, resizable state before re-placing it.
 * Fullscreen is a separate state from maximised: unmaximize() alone leaves a
 * fullscreened drawer fullscreen, so re-summoning would not reset it.
 */
function restoreWindowState(win: Meta.Window): void {
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    if (win.get_maximize_flags() !== 0)
        win.unmaximize();
}

export class QuakeManager {
    private _entries = new Map<string, QuakeEntry>();
    private _windows = new Map<string, Meta.Window>();
    private _lastMonitor = new Map<string, number>();
    private _pending: PendingClaim | null = null;
    private _animating = new Set<string>();
    private _applyingGeometry = new Set<string>();
    private _sourceIds = new Set<number>();
    private _firstFrameWatches = new Map<string, FirstFrameWatch>();

    enable(): void {
        global.display.connectObject(
            'window-created',
            (_d: Meta.Display, win: Meta.Window) => this._onWindowCreated(win),
            'window-entered-monitor',
            (_d: Meta.Display, monitorIndex: number, win: Meta.Window) =>
                this._onEnteredMonitor(monitorIndex, win),
            this,
        );

        // Claim previously spawned windows after suspend/disable
        this._idleAdd(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const aliveIds = new Set<number>();
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (!win)
                    continue;
                
                const id = win.get_id();
                aliveIds.add(id);

                const entryId = PERSISTENT_WINDOWS.get(id);
                if (entryId && this._entries.has(entryId))
                    this._claimWindow(entryId, win, true);
            }

            // Cleanup any leaked window IDs
            for (const id of PERSISTENT_WINDOWS.keys()) {
                if (!aliveIds.has(id))
                    PERSISTENT_WINDOWS.delete(id);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    disable(): void {
        global.display.disconnectObject(this);
        this._clearPending();
        this._clearSources();
        for (const id of [...this._windows.keys()])
            this._detachWindow(id, false);
        this._entries.clear();
        this._lastMonitor.clear();
        this._applyingGeometry.clear();
        this._animating.clear();
        this._firstFrameWatches.clear();
    }

    setEntries(entries: QuakeEntry[]): void {
        const nextIds = new Set(entries.map(e => e.id));
        for (const id of [...this._entries.keys()]) {
            if (!nextIds.has(id)) {
                this._detachWindow(id, false);
                this._lastMonitor.delete(id);
            }
        }

        this._entries.clear();
        for (const entry of entries)
            this._entries.set(entry.id, entry);
    }

    getEntry(id: string): QuakeEntry | undefined {
        return this._entries.get(id);
    }

    toggle(entryId: string): void {
        const entry = this._entries.get(entryId);
        if (!entry)
            return;

        const win = this._windows.get(entryId);
        if (!win || !this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            this._spawn(entry);
            return;
        }

        if (this._isVisible(win))
            this._hide(entryId, win, entry);
        else
            this._show(entryId, win, entry);
    }

    private _isWindowAlive(win: Meta.Window | null | undefined): boolean {
        if (!win)
            return false;
        try {
            return win.get_compositor_private() != null;
        } catch {
            return false;
        }
    }

    private _spawn(entry: QuakeEntry): void {
        const app = this._resolveApp(entry.appId);
        if (!app) {
            Main.notify(
                _('Quake Anything Extended'),
                formatMessage(_('Could not find app: %s'), entry.appId),
            );
            return;
        }

        this._clearPending();
        const timeoutId = this._timeoutAdd(GLib.PRIORITY_DEFAULT, CLAIM_TIMEOUT_MS, () => {
            if (this._pending?.entryId === entry.id) {
                Main.notify(
                    _('Quake Anything Extended'),
                    formatMessage(_('Timed out waiting for %s'), entry.appId),
                );
                this._pending = null;
            }
            return GLib.SOURCE_REMOVE;
        });
        this._pending = {
            entryId: entry.id,
            appId: this._normalizeAppId(entry.appId),
            timeoutId,
        };

        try {
            if (app.can_open_new_window()) {
                app.open_new_window(-1);
            } else {
                const workspace = global.workspace_manager.get_active_workspace_index();
                app.launch(global.get_current_time(), workspace, Shell.AppLaunchGpu.APP_PREF);
            }
        } catch (e) {
            this._clearPending();
            Main.notify(
                _('Quake Anything Extended'),
                formatMessage(_('Failed to launch %s'), entry.appId),
            );
            console.error('[quake-anything] launch failed', e);
        }
    }

    private _onWindowCreated(win: Meta.Window): void {
        const pending = this._pending;
        if (!pending)
            return;

        this._idleAdd(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (!this._pending || this._pending.entryId !== pending.entryId)
                return GLib.SOURCE_REMOVE;
            if (!this._isWindowAlive(win))
                return GLib.SOURCE_REMOVE;

            if (!this._windowMatchesPending(win, pending.appId)) {
                this._timeoutAdd(GLib.PRIORITY_DEFAULT, 100, () => {
                    if (!this._pending || this._pending.entryId !== pending.entryId)
                        return GLib.SOURCE_REMOVE;
                    if (!this._isWindowAlive(win))
                        return GLib.SOURCE_REMOVE;
                    if (this._windowMatchesPending(win, pending.appId))
                        this._claimWindow(pending.entryId, win);
                    return GLib.SOURCE_REMOVE;
                });
                return GLib.SOURCE_REMOVE;
            }

            this._claimWindow(pending.entryId, win);
            return GLib.SOURCE_REMOVE;
        });
    }

    private _windowMatchesPending(win: Meta.Window, appId: string): boolean {
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.get_window_app(win);
        if (!app)
            return false;
        return this._normalizeAppId(app.get_id()) === this._normalizeAppId(appId);
    }

    private _claimWindow(entryId: string, win: Meta.Window, isRestore = false): void {
        const entry = this._entries.get(entryId);
        if (!entry || !this._isWindowAlive(win))
            return;

        this._clearPending();

        const existing = this._windows.get(entryId);
        if (existing && existing !== win)
            this._detachWindow(entryId, false);

        this._windows.set(entryId, win);
        PERSISTENT_WINDOWS.set(win.get_id(), entryId);
        // A drawer is summoned by its shortcut, so listing it in the overview
        // and Alt-Tab on every workspace is just clutter.
        hideFromOverview(win);
        this._applyWindowTraits(win, entry);

        if (!isRestore) {
            this._lastMonitor.delete(entryId);
        }

        win.connectObject('unmanaged', () => {
            PERSISTENT_WINDOWS.delete(win.get_id());
            PERSISTENT_MONITOR.delete(entryId);
            if (this._windows.get(entryId) === win)
                this._detachWindow(entryId, true);
        }, this);

        if (isRestore) {
            const mon = PERSISTENT_MONITOR.get(entryId);
            if (mon !== undefined)
                this._lastMonitor.set(entryId, mon);
            
            if (this._isVisible(win))
                this._applyQuakeGeometry(entryId, win, entry, false);
            return;
        }

        const place = () => {
            this._idleAdd(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._windows.get(entryId) !== win || !this._isWindowAlive(win))
                    return GLib.SOURCE_REMOVE;
                this._applyQuakeGeometry(entryId, win, entry, true);
                this._show(entryId, win, entry);
                return GLib.SOURCE_REMOVE;
            });
        };

        const actor = this._isWindowAlive(win)
            ? win.get_compositor_private() as Clutter.Actor | null
            : null;

        if (actor) {
            this._clearFirstFrameWatch(entryId);
            actor.connectObject('first-frame', () => {
                this._clearFirstFrameWatch(entryId);
                place();
            }, this);
            const fallbackId = this._timeoutAdd(
                GLib.PRIORITY_DEFAULT,
                FIRST_FRAME_FALLBACK_MS,
                () => {
                    const watch = this._firstFrameWatches.get(entryId);
                    if (!watch || watch.fallbackId !== fallbackId)
                        return GLib.SOURCE_REMOVE;
                    this._clearFirstFrameWatch(entryId);
                    place();
                    return GLib.SOURCE_REMOVE;
                },
            );
            this._firstFrameWatches.set(entryId, { actor, fallbackId });
        } else {
            this._timeoutAdd(GLib.PRIORITY_DEFAULT, 100, () => {
                place();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    private _detachWindow(entryId: string, resetSessionState: boolean): void {
        const win = this._windows.get(entryId);
        win?.disconnectObject(this);
        this._clearFirstFrameWatch(entryId);

        this._animating.delete(entryId);
        if (win && this._isWindowAlive(win)) {
            const actor = win.get_compositor_private() as Clutter.Actor | null;
            if (actor) {
                actor.remove_all_transitions();
                actor.set_translation(0, 0, 0);
                actor.opacity = 255;
            }
            win.unstick();
        }
        if (win)
            restoreOverviewVisibility(win);

        this._windows.delete(entryId);
        this._applyingGeometry.delete(entryId);
        if (resetSessionState) {
            this._lastMonitor.delete(entryId);
        }
    }

    private _clearFirstFrameWatch(entryId: string): void {
        const watch = this._firstFrameWatches.get(entryId);
        this._firstFrameWatches.delete(entryId);
        if (!watch)
            return;
        if (watch.fallbackId)
            this._removeSource(watch.fallbackId);
        watch.actor.disconnectObject(this);
    }

    private _entryIdForWindow(win: Meta.Window): string | null {
        for (const [id, owned] of this._windows) {
            if (owned === win)
                return id;
        }
        return null;
    }

    private _onEnteredMonitor(monitorIndex: number, win: Meta.Window): void {
        const entryId = this._entryIdForWindow(win);
        if (!entryId)
            return;
        if (this._applyingGeometry.has(entryId) || this._animating.has(entryId))
            return;
        if (!this._isWindowAlive(win))
            return;

        const entry = this._entries.get(entryId);
        if (!entry)
            return;

        const safeIndex = sanitizeMonitorIndex(monitorIndex);
        if (win.minimized || !this._isVisible(win)) {
            this._lastMonitor.set(entryId, safeIndex);
            PERSISTENT_MONITOR.set(entryId, safeIndex);
            return;
        }

        const previous = this._lastMonitor.get(entryId);
        this._lastMonitor.set(entryId, safeIndex);
        PERSISTENT_MONITOR.set(entryId, safeIndex);
        if (previous === safeIndex)
            return;

        this._idleAdd(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (this._windows.get(entryId) !== win || !this._isWindowAlive(win))
                return GLib.SOURCE_REMOVE;
            this._applyQuakeGeometry(entryId, win, entry, false);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Apply the per-entry traits that are independent of geometry. */
    private _applyWindowTraits(win: Meta.Window, entry: QuakeEntry): void {
        if (!this._isWindowAlive(win))
            return;

        if (!win.is_override_redirect()) {
            if (entry.sticky)
                win.stick();
            else
                win.unstick();
        }

        const actor = win.get_compositor_private() as Clutter.Actor | null;
        if (actor) {
            const pct = Math.min(100, Math.max(10, entry.opacity));
            actor.opacity = Math.round(255 * pct / 100);
        }
    }

    private _applyQuakeGeometry(
        entryId: string,
        win: Meta.Window,
        entry: QuakeEntry,
        usePointerMonitor: boolean,
    ): void {
        if (!this._isWindowAlive(win))
            return;

        const rawMonitor = usePointerMonitor
            ? getPointerMonitorIndex()
            : win.get_monitor();
        const monitor = sanitizeMonitorIndex(rawMonitor);
        const rect = computeQuakeRect(entry.side, entry.sizePercent, entry.spanPercent, monitor);
        if (!isValidRect(rect)) {
            console.error('[quake-anything] refusing invalid quake rect', rect);
            return;
        }

        this._applyingGeometry.add(entryId);
        try {
            restoreWindowState(win);

            if (sanitizeMonitorIndex(win.get_monitor()) !== monitor)
                win.move_to_monitor(monitor);

            // A sticky window is already on every workspace; pulling it would
            // fight the stick. Only non-sticky drawers follow the user.
            if (!entry.sticky) {
                const workspace = global.workspace_manager.get_active_workspace();
                if (!win.located_on_workspace(workspace))
                    win.change_workspace(workspace);
            }

            win.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
            this._lastMonitor.set(entryId, monitor);
            PERSISTENT_MONITOR.set(entryId, monitor);
        } finally {
            this._idleAdd(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._applyingGeometry.delete(entryId);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    private _isVisible(win: Meta.Window): boolean {
        if (!this._isWindowAlive(win))
            return false;
        if (win.minimized)
            return false;
        const actor = win.get_compositor_private() as Clutter.Actor | null;
        return !!(actor && actor.visible);
    }

    private _show(entryId: string, win: Meta.Window, entry: QuakeEntry): void {
        if (this._animating.has(entryId))
            return;
        if (!this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            return;
        }

        const actor = win.get_compositor_private() as Clutter.Actor | null;

        if (win.minimized) {
            // Suppress the stock unminimise effect, which flies in from the
            // dash icon rather than from this drawer's own edge.
            if (actor)
                Main.wm.skipNextEffect(actor);
            win.unminimize();
        }

        // If the stock unminimise animation ran anyway (skipNextEffect is a
        // single token and another effect can consume it first), end it NOW.
        // Cancelling fires _unminimizeWindowDone, which forces opacity to 255 -
        // so it has to happen before _applyWindowTraits, not after.
        actor?.remove_all_transitions();

        this._applyQuakeGeometry(entryId, win, entry, false);

        if (!this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            return;
        }

        this._applyWindowTraits(win, entry);
        win.activate(global.get_current_time());

        if (!actor)
            return;

        const rect = computeQuakeRect(
            entry.side,
            entry.sizePercent,
            entry.spanPercent,
            sanitizeMonitorIndex(win.get_monitor()),
        );
        if (!isValidRect(rect))
            return;

        const offset = slideOffsetForSide(entry.side, rect);
        actor.remove_all_transitions();
        actor.set_translation(offset.x, offset.y, 0);
        this._animating.add(entryId);
        actor.ease({
            translationX: 0,
            translationY: 0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onStopped: () => {
                this._animating.delete(entryId);
                // A shell effect completing after us would have reset opacity.
                this._applyWindowTraits(win, entry);
            },
        });
    }

    private _hide(entryId: string, win: Meta.Window, entry: QuakeEntry): void {
        if (this._animating.has(entryId))
            return;
        if (!this._isWindowAlive(win)) {
            this._detachWindow(entryId, true);
            return;
        }

        const actor = win.get_compositor_private() as Clutter.Actor | null;
        if (!actor) {
            win.minimize();
            return;
        }

        const rect = computeQuakeRect(
            entry.side,
            entry.sizePercent,
            entry.spanPercent,
            sanitizeMonitorIndex(win.get_monitor()),
        );
        if (!isValidRect(rect)) {
            Main.wm.skipNextEffect(actor);
            win.minimize();
            return;
        }

        const offset = slideOffsetForSide(entry.side, rect);
        actor.remove_all_transitions();
        actor.set_translation(0, 0, 0);
        this._animating.add(entryId);
        actor.ease({
            translationX: offset.x,
            translationY: offset.y,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onStopped: (isFinished: boolean) => {
                this._animating.delete(entryId);
                // remove_all_transitions() during _detachWindow/disable() stops
                // the timeline with isFinished=false; minimising there would
                // hide a user window the extension is giving up.
                if (!isFinished)
                    return;
                if (!this._isWindowAlive(win))
                    return;
                // Minimise only once the drawer is offscreen, with the stock
                // effect suppressed so nothing flies to the corner.
                Main.wm.skipNextEffect(actor);
                win.minimize();
                // A window left translated while minimised restores offset.
                actor.set_translation(0, 0, 0);
            },
        });
    }

    private _resolveApp(appId: string): Shell.App | null {
        const context = Shell.AppSystem.get_default();
        const raw = appId.trim();
        const candidates = [
            raw,
            raw.endsWith('.desktop') ? raw : `${raw}.desktop`,
            raw.replace(/\.desktop$/i, ''),
        ];

        for (const id of candidates) {
            const app = context.lookup_app(id);
            if (app)
                return app;
        }

        const desktopId = raw.endsWith('.desktop') ? raw : `${raw}.desktop`;
        const info = GioUnix.DesktopAppInfo.new(desktopId);
        if (info) {
            const id = info.get_id();
            if (id) {
                const app = context.lookup_app(id);
                if (app)
                    return app;
            }
        }
        return null;
    }

    private _normalizeAppId(appId: string): string {
        return appId.trim().replace(/\.desktop$/i, '').toLowerCase();
    }

    private _idleAdd(priority: number, callback: () => boolean): number {
        let sourceId = 0;
        sourceId = GLib.idle_add(priority, () => {
            this._sourceIds.delete(sourceId);
            return callback();
        });
        this._sourceIds.add(sourceId);
        return sourceId;
    }

    private _timeoutAdd(priority: number, intervalMs: number, callback: () => boolean): number {
        let sourceId = 0;
        sourceId = GLib.timeout_add(priority, intervalMs, () => {
            this._sourceIds.delete(sourceId);
            return callback();
        });
        this._sourceIds.add(sourceId);
        return sourceId;
    }

    private _removeSource(sourceId: number): void {
        if (!this._sourceIds.has(sourceId))
            return;
        this._sourceIds.delete(sourceId);
        GLib.Source.remove(sourceId);
    }

    private _clearSources(): void {
        for (const sourceId of this._sourceIds)
            GLib.Source.remove(sourceId);
        this._sourceIds.clear();
    }

    private _clearPending(): void {
        if (this._pending?.timeoutId)
            this._removeSource(this._pending.timeoutId);
        this._pending = null;
    }
}
