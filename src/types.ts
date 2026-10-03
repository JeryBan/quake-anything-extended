export type QuakeSide = 'top' | 'bottom' | 'left' | 'right';

export interface QuakeEntry {
    id: string;
    appId: string;
    side: QuakeSide;
    shortcut: string;
    sizePercent: number;
    widthPercent: number;
    sticky: boolean;
    opacity: number;
}

/** Legacy GVariant shape for the pre-migration `entries` key: a(ssssi) */
export type QuakeEntryTuple = [string, string, string, string, number];

/** Defaults chosen so a migrated entry behaves exactly as it did before. */
export const ENTRY_DEFAULTS = {
    sizePercent: 40,
    widthPercent: 100,
    sticky: false,
    opacity: 100,
} as const;

export function isQuakeSide(value: string): value is QuakeSide {
    return value === 'top' || value === 'bottom' || value === 'left' || value === 'right';
}

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n))
        return fallback;
    return Math.min(hi, Math.max(lo, n));
}

export function parseEntries(raw: string[]): QuakeEntry[] {
    const entries: QuakeEntry[] = [];
    for (const text of raw) {
        let obj: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                continue;
            obj = parsed as Record<string, unknown>;
        } catch {
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

export function entriesToJson(entries: QuakeEntry[]): string[] {
    return entries.map(entry => JSON.stringify(entry));
}

/** One-time conversion of the legacy `entries` tuples into QuakeEntry objects. */
export function migrateTuples(raw: QuakeEntryTuple[]): QuakeEntry[] {
    const entries: QuakeEntry[] = [];
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

export function createEntryId(): string {
    return `entry-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Replace `%s` placeholders left-to-right (translator-friendly printf-style). */
export function formatMessage(template: string, ...args: string[]): string {
    let i = 0;
    return template.replace(/%s/g, () => args[i++] ?? '');
}
