/** Defaults chosen so a migrated entry behaves exactly as it did before. */
export const ENTRY_DEFAULTS = {
    sizePercent: 40,
    widthPercent: 100,
    sticky: false,
    opacity: 100,
};

export function isQuakeSide(value) {
    return value === 'top' || value === 'bottom' || value === 'left' || value === 'right';
}

function clampInt(value, lo, hi, fallback) {
    // Number(null), Number(false) and Number([]) are all 0 - finite, so the
    // isFinite guard alone would silently clamp them to the minimum.
    if (typeof value !== 'number' && typeof value !== 'string')
        return fallback;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(hi, Math.max(lo, n));
}

export function parseEntries(raw) {
    const entries = [];
    for (const text of raw) {
        let obj;
        try {
            const parsed = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                continue;
            obj = parsed;
        }
        catch {
            continue;
        }
        const id = typeof obj.id === 'string' ? obj.id : '';
        const appId = typeof obj.appId === 'string' ? obj.appId : '';
        const side = typeof obj.side === 'string' ? obj.side : '';
        if (!id || !appId || !isQuakeSide(side))
            continue;
        entries.push({
            id,
            appId,
            side,
            shortcut: typeof obj.shortcut === 'string' ? obj.shortcut : '',
            sizePercent: clampInt(obj.sizePercent, 10, 90, ENTRY_DEFAULTS.sizePercent),
            widthPercent: clampInt(obj.widthPercent, 10, 100, ENTRY_DEFAULTS.widthPercent),
            sticky: obj.sticky === true,
            opacity: clampInt(obj.opacity, 10, 100, ENTRY_DEFAULTS.opacity),
        });
    }
    return entries;
}

export function entriesToJson(entries) {
    return entries.map(entry => JSON.stringify(entry));
}

/** One-time conversion of the legacy `entries` tuples into QuakeEntry objects. */
export function migrateTuples(raw) {
    const entries = [];
    for (const tuple of raw) {
        if (!Array.isArray(tuple) || tuple.length < 5)
            continue;
        const [id, appId, side, shortcut, sizePercent] = tuple;
        if (!id || !appId || typeof side !== 'string' || !isQuakeSide(side))
            continue;
        entries.push({
            id,
            appId,
            side,
            shortcut: shortcut ?? '',
            sizePercent: clampInt(sizePercent, 10, 90, ENTRY_DEFAULTS.sizePercent),
            widthPercent: ENTRY_DEFAULTS.widthPercent,
            sticky: ENTRY_DEFAULTS.sticky,
            opacity: ENTRY_DEFAULTS.opacity,
        });
    }
    return entries;
}

/**
 * Move the legacy `entries` tuples into `app-entries`, once.
 *
 * Called from BOTH enable() and the prefs process: a user who opens
 * Preferences while the extension is disabled would otherwise see an empty
 * list, and saving from that state orphans the legacy config permanently.
 * Guarded on the target being empty, so calling it twice is harmless.
 *
 * @returns how many legacy entries were migrated.
 */
export function ensureMigrated(settings) {
    if (settings.get_strv('app-entries').length > 0)
        return 0;
    const legacy = settings.get_value('entries').deep_unpack();
    if (!Array.isArray(legacy) || legacy.length === 0)
        return 0;
    settings.set_strv('app-entries', entriesToJson(migrateTuples(legacy)));
    settings.reset('entries');
    return legacy.length;
}

export function createEntryId() {
    return `entry-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Replace `%s` placeholders left-to-right (translator-friendly printf-style). */
export function formatMessage(template, ...args) {
    let i = 0;
    return template.replace(/%s/g, () => args[i++] ?? '');
}
