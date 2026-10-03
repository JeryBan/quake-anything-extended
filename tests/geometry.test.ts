import {describe, expect, test} from 'bun:test';
import {computeRectInArea} from '../src/geometry.js';

// A 2560x1440 monitor with a 37px top bar reserved.
const work = {x: 0, y: 37, width: 2560, height: 1403};

describe('computeRectInArea: bottom', () => {
    test('centres a partial width against the work area', () => {
        const r = computeRectInArea('bottom', 45, 50, work);
        expect(r.width).toBe(1280);
        expect(r.x).toBe(640);
        expect(r.height).toBe(631);
        expect(r.y).toBe(work.y + work.height - 631);
    });

    test('sits flush with the work area bottom edge', () => {
        const r = computeRectInArea('bottom', 45, 50, work);
        expect(r.y + r.height).toBe(work.y + work.height);
    });

    test('width 100 reproduces full-width output exactly', () => {
        const r = computeRectInArea('bottom', 45, 100, work);
        expect(r.x).toBe(work.x);
        expect(r.width).toBe(work.width);
    });
});

describe('computeRectInArea: top', () => {
    test('centres and sits flush with the work area top edge', () => {
        const r = computeRectInArea('top', 40, 60, work);
        expect(r.y).toBe(work.y);
        expect(r.width).toBe(1536);
        expect(r.x).toBe(512);
    });
});

describe('computeRectInArea: left and right ignore widthPercent', () => {
    test('left is unchanged by widthPercent', () => {
        const a = computeRectInArea('left', 40, 100, work);
        const b = computeRectInArea('left', 40, 25, work);
        expect(a).toEqual(b);
        expect(a).toEqual({x: 0, y: 37, width: 1024, height: 1403});
    });

    test('right is unchanged by widthPercent and stays flush right', () => {
        const a = computeRectInArea('right', 40, 100, work);
        const b = computeRectInArea('right', 40, 25, work);
        expect(a).toEqual(b);
        expect(a.x + a.width).toBe(work.x + work.width);
    });
});

describe('computeRectInArea: clamping', () => {
    test('sizePercent clamps to 10-90', () => {
        expect(computeRectInArea('bottom', 999, 100, work).height)
            .toBe(computeRectInArea('bottom', 90, 100, work).height);
        expect(computeRectInArea('bottom', 0, 100, work).height)
            .toBe(computeRectInArea('bottom', 10, 100, work).height);
    });

    test('widthPercent clamps to 10-100', () => {
        expect(computeRectInArea('bottom', 45, 999, work).width).toBe(work.width);
        expect(computeRectInArea('bottom', 45, 0, work).width)
            .toBe(computeRectInArea('bottom', 45, 10, work).width);
    });

    test('never extends past the work area horizontally', () => {
        for (const wp of [10, 33, 50, 77, 100]) {
            const r = computeRectInArea('bottom', 45, wp, work);
            expect(r.x).toBeGreaterThanOrEqual(work.x);
            expect(r.x + r.width).toBeLessThanOrEqual(work.x + work.width);
        }
    });
});
