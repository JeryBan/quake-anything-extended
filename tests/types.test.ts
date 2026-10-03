import {describe, expect, test} from 'bun:test';
import {
    ENTRY_DEFAULTS,
    entriesToJson,
    migrateTuples,
    parseEntries,
    type QuakeEntry,
} from '../src/types.js';

const full: QuakeEntry = {
    id: 'e1',
    appId: 'org.gnome.Nautilus.desktop',
    side: 'bottom',
    shortcut: '<Control><Alt>n',
    sizePercent: 45,
    widthPercent: 50,
    sticky: true,
    opacity: 95,
};

describe('parseEntries', () => {
    test('round-trips a complete entry', () => {
        expect(parseEntries(entriesToJson([full]))).toEqual([full]);
    });

    test('skips malformed JSON but keeps good neighbours', () => {
        const raw = ['{not json', ...entriesToJson([full]), '{"id":'];
        expect(parseEntries(raw)).toEqual([full]);
    });

    test('applies defaults when new fields are absent', () => {
        const raw = [JSON.stringify({
            id: 'e2',
            appId: 'foo.desktop',
            side: 'top',
            shortcut: '',
            sizePercent: 40,
        })];
        const [entry] = parseEntries(raw);
        expect(entry.widthPercent).toBe(ENTRY_DEFAULTS.widthPercent);
        expect(entry.widthPercent).toBe(100);
        expect(entry.sticky).toBe(false);
        expect(entry.opacity).toBe(100);
    });

    test('drops entries with a missing id, appId or bad side', () => {
        const raw = [
            JSON.stringify({appId: 'a.desktop', side: 'top'}),
            JSON.stringify({id: 'x', side: 'top'}),
            JSON.stringify({id: 'y', appId: 'a.desktop', side: 'diagonal'}),
        ];
        expect(parseEntries(raw)).toEqual([]);
    });

    test('clamps each percentage to its own range', () => {
        const raw = [JSON.stringify({
            ...full, sizePercent: 999, widthPercent: 999, opacity: 999,
        })];
        const [entry] = parseEntries(raw);
        expect(entry.sizePercent).toBe(90);
        expect(entry.widthPercent).toBe(100);
        expect(entry.opacity).toBe(100);
    });

    test('rejects a non-object payload without throwing', () => {
        expect(parseEntries(['42', '"a string"', 'null'])).toEqual([]);
    });
});

describe('migrateTuples', () => {
    test('converts a legacy tuple and fills new fields with defaults', () => {
        const [entry] = migrateTuples([
            ['entry-musp', 'org.gnome.Nautilus.desktop', 'bottom', '<Control><Alt>n', 45],
        ]);
        expect(entry).toEqual({
            id: 'entry-musp',
            appId: 'org.gnome.Nautilus.desktop',
            side: 'bottom',
            shortcut: '<Control><Alt>n',
            sizePercent: 45,
            widthPercent: 100,
            sticky: false,
            opacity: 100,
        });
    });

    test('skips short or malformed tuples', () => {
        expect(migrateTuples([['a', 'b'] as never])).toEqual([]);
    });
});
