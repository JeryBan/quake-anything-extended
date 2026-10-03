import type Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {KeybindingManager} from './keybindings.js';
import {QuakeManager} from './quake-manager.js';
import {
    entriesToJson,
    formatMessage,
    migrateTuples,
    parseEntries,
    type QuakeEntry,
    type QuakeEntryTuple,
} from './types.js';

export default class QuakeAnythingExtension extends Extension {
    private _settings: Gio.Settings | null = null;
    private _quake: QuakeManager | null = null;
    private _keys: KeybindingManager | null = null;
    private _boundIds = new Set<string>();

    enable() {
        this.initTranslations();

        this._settings = this.getSettings();
        this._migrateLegacyEntries();
        this._quake = new QuakeManager();
        this._keys = new KeybindingManager();

        this._quake.enable();
        this._keys.enable();

        this._reload();
        this._settings.connectObject('changed::app-entries', () => this._reload(), this);
    }

    disable() {
        this._settings?.disconnectObject(this);

        this._keys?.disable();
        this._keys = null;

        this._quake?.disable();
        this._quake = null;

        this._boundIds.clear();
        this._settings = null;
    }

    private _reload(): void {
        if (!this._settings || !this._quake || !this._keys)
            return;

        const entries = parseEntries(this._settings.get_strv('app-entries'));
        this._quake.setEntries(entries);
        this._rebindKeys(entries);
    }

    /**
     * One-time move from the legacy `entries` tuple key to `app-entries`.
     * Guarded on the target being empty, so re-running is harmless.
     */
    private _migrateLegacyEntries(): void {
        const settings = this._settings;
        if (!settings)
            return;
        if (settings.get_strv('app-entries').length > 0)
            return;

        const legacy = settings.get_value('entries').deep_unpack() as QuakeEntryTuple[];
        if (legacy.length === 0)
            return;

        settings.set_strv('app-entries', entriesToJson(migrateTuples(legacy)));
        settings.reset('entries');
        console.log(`[quake-anything] migrated ${legacy.length} entries to app-entries`);
    }

    private _rebindKeys(entries: QuakeEntry[]): void {
        if (!this._keys || !this._quake)
            return;

        const nextIds = new Set(entries.map(e => e.id));
        for (const id of this._boundIds) {
            if (!nextIds.has(id))
                this._keys.unbind(id);
        }
        this._boundIds.clear();

        for (const entry of entries) {
            if (!entry.shortcut) {
                this._keys.unbind(entry.id);
                continue;
            }

            const ok = this._keys.bind(entry.id, entry.shortcut, () => {
                this._quake?.toggle(entry.id);
            });

            if (ok) {
                this._boundIds.add(entry.id);
            } else {
                Main.notify(
                    _('Quake Anything'),
                    formatMessage(
                        _('Shortcut "%s" is already in use and could not be bound.'),
                        entry.shortcut,
                    ),
                );
            }
        }
    }
}
