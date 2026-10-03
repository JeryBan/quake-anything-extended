import {describe, expect, test} from 'bun:test';
import {
    hideFromOverview,
    isHiddenFromOverview,
    restoreOverviewVisibility,
} from '../src/overview-visibility.js';

/** Stand-in for Meta.Window: skip_taskbar lives on the prototype, as in GJS. */
function fakeWindow(skip = false): {skip_taskbar: boolean; skipTaskbar: boolean} {
    const proto = {
        get skip_taskbar() {
            return skip;
        },
        get skipTaskbar() {
            return skip;
        },
    };
    return Object.create(proto) as {skip_taskbar: boolean; skipTaskbar: boolean};
}

describe('hideFromOverview', () => {
    test('shadows the prototype getter so the shell sees true', () => {
        const win = fakeWindow(false);
        expect(win.skip_taskbar).toBe(false);

        hideFromOverview(win);

        expect(win.skip_taskbar).toBe(true);
        expect(win.skipTaskbar).toBe(true);
    });

    test('leaves other windows untouched', () => {
        const hidden = fakeWindow(false);
        const other = fakeWindow(false);

        hideFromOverview(hidden);

        expect(other.skip_taskbar).toBe(false);
    });

    test('is idempotent', () => {
        const win = fakeWindow(false);
        hideFromOverview(win);
        hideFromOverview(win);
        expect(win.skip_taskbar).toBe(true);
        expect(isHiddenFromOverview(win)).toBe(true);
    });
});

describe('restoreOverviewVisibility', () => {
    test('gives the prototype getter back', () => {
        const win = fakeWindow(false);
        hideFromOverview(win);
        restoreOverviewVisibility(win);

        expect(win.skip_taskbar).toBe(false);
        expect(isHiddenFromOverview(win)).toBe(false);
    });

    test('preserves a window that genuinely skips the taskbar', () => {
        const win = fakeWindow(true);
        hideFromOverview(win);
        restoreOverviewVisibility(win);

        // Restored to the window's OWN value, not forced to false.
        expect(win.skip_taskbar).toBe(true);
    });

    test('is a no-op on a window that was never hidden', () => {
        const win = fakeWindow(false);
        restoreOverviewVisibility(win);
        expect(win.skip_taskbar).toBe(false);
    });
});
