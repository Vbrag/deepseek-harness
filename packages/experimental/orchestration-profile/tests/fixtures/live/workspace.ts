/** Independent repair exercises and their immutable acceptance tests. */

/** Broken modules and Node tests copied into each isolated live workspace. */
export const workspaceFiles = {
  'allocate.mjs': `export function allocateSeats(weights, seats) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map(weight => Math.round(weight / total * seats));
}
`,
  'windows.mjs': `export function mergeWindows(windows) {
  windows.sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && window[0] < previous[1]) previous[1] = window[1];
    else merged.push(window);
  }
  return merged;
}
`,
  'allocate.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateSeats } from './allocate.mjs';

test('allocates every seat by largest remainder with stable input-order ties', () => {
  assert.deepEqual(allocateSeats([5, 3, 2], 7), [4, 2, 1]);
  assert.deepEqual(allocateSeats([1, 1, 1], 2), [1, 1, 0]);
  assert.deepEqual(allocateSeats([10, 20, 30], 5), [1, 2, 2]);
  assert.deepEqual(allocateSeats([0, 4, 0], 3), [0, 3, 0]);
  assert.deepEqual(allocateSeats([0.5, 1.5], 3), [1, 2]);
});

test('handles empty and zero-seat allocations without changing inputs', () => {
  assert.deepEqual(allocateSeats([], 0), []);
  assert.deepEqual(allocateSeats([0, 0], 0), [0, 0]);
  const weights = Object.freeze([3, 2, 1]);
  assert.deepEqual(allocateSeats(weights, 6), [3, 2, 1]);
  assert.deepEqual(weights, [3, 2, 1]);
});

test('rejects invalid counts and weights instead of coercing them', () => {
  for (const seats of [-1, 1.5, NaN, Infinity, '2']) {
    assert.throws(() => allocateSeats([1, 2], seats), RangeError);
  }
  for (const weights of [[-1, 2], [NaN], [Infinity], ['2'], [0, 0], []]) {
    assert.throws(() => allocateSeats(weights, 2), RangeError);
  }
});
`,
  'windows.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeWindows } from './windows.mjs';

test('sorts and merges overlapping or touching half-open windows', () => {
  assert.deepEqual(mergeWindows([[8, 10], [1, 3], [3, 5], [2, 4], [11, 12]]), [[1, 5], [8, 10], [11, 12]]);
  assert.deepEqual(mergeWindows([[0, 10], [2, 3]]), [[0, 10]]);
  assert.deepEqual(mergeWindows([[-3, -1], [-1, 1]]), [[-3, 1]]);
  assert.deepEqual(mergeWindows([[0.25, 1.5], [1.5, 2.75]]), [[0.25, 2.75]]);
});

test('omits empty windows and returns detached arrays without mutating inputs', () => {
  assert.deepEqual(mergeWindows([]), []);
  assert.deepEqual(mergeWindows([[2, 2], [1, 3], [4, 4]]), [[1, 3]]);
  const windows = Object.freeze([Object.freeze([5, 7]), Object.freeze([1, 3])]);
  const merged = mergeWindows(windows);
  assert.deepEqual(merged, [[1, 3], [5, 7]]);
  merged[0][0] = -10;
  assert.deepEqual(windows, [[5, 7], [1, 3]]);
});

test('rejects malformed, reversed, or non-finite endpoints', () => {
  for (const windows of [[[3, 1]], [[1]], [[1, 2, 3]], [[NaN, 2]], [[0, Infinity]], [['1', 2]]]) {
    assert.throws(() => mergeWindows(windows), RangeError);
  }
});
`,
}
