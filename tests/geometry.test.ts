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

describe('computeRectInArea: left and right', () => {
    test('centres a partial span vertically', () => {
        const r = computeRectInArea('left', 40, 50, work);
        expect(r.width).toBe(1024);
        expect(r.x).toBe(work.x);
        expect(r.height).toBe(702);
        expect(r.y).toBe(388);
    });

    test('span 100 reproduces full-height output exactly', () => {
        const r = computeRectInArea('left', 40, 100, work);
        expect(r).toEqual({x: 0, y: 37, width: 1024, height: 1403});
    });

    test('right stays flush with the work area right edge', () => {
        const r = computeRectInArea('right', 40, 50, work);
        expect(r.x + r.width).toBe(work.x + work.width);
        expect(r.height).toBe(702);
        expect(r.y).toBe(388);
    });

    test('never extends past the work area vertically', () => {
        for (const span of [10, 33, 50, 77, 100]) {
            const r = computeRectInArea('right', 40, span, work);
            expect(r.y).toBeGreaterThanOrEqual(work.y);
            expect(r.y + r.height).toBeLessThanOrEqual(work.y + work.height);
        }
    });
});

describe('computeRectInArea: clamping', () => {
    test('sizePercent clamps to 10-90', () => {
        expect(computeRectInArea('bottom', 999, 100, work).height)
            .toBe(computeRectInArea('bottom', 90, 100, work).height);
        expect(computeRectInArea('bottom', 0, 100, work).height)
            .toBe(computeRectInArea('bottom', 10, 100, work).height);
    });

    test('spanPercent clamps to 10-100 on both axes', () => {
        expect(computeRectInArea('bottom', 45, 999, work).width).toBe(work.width);
        expect(computeRectInArea('bottom', 45, 0, work).width)
            .toBe(computeRectInArea('bottom', 45, 10, work).width);
        expect(computeRectInArea('left', 45, 999, work).height).toBe(work.height);
        expect(computeRectInArea('left', 45, 0, work).height)
            .toBe(computeRectInArea('left', 45, 10, work).height);
    });

    test('never extends past the work area horizontally', () => {
        for (const wp of [10, 33, 50, 77, 100]) {
            const r = computeRectInArea('bottom', 45, wp, work);
            expect(r.x).toBeGreaterThanOrEqual(work.x);
            expect(r.x + r.width).toBeLessThanOrEqual(work.x + work.width);
        }
    });
});
