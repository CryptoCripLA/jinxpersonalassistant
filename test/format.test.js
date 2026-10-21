import { test } from 'node:test';
import assert from 'node:assert/strict';

// public/js/core.js reads the page token when it loads; give it the one element it asks for
globalThis.document = { querySelector: () => ({ content: 'test' }), getElementById: () => null };
const { age } = await import('../public/js/core.js');

test('coin ages read naturally at every scale', () => {
  assert.equal(age(59), '59s');
  assert.equal(age(45 * 60), '45m');
  assert.equal(age(5.5 * 3600), '5.5h');
  assert.equal(age(3.2 * 86400), '3.2d');
  assert.equal(age(40.4 * 86400), '40d', 'whole days once it is weeks old');
  // live 2026-10-21: a revived coin showed as "922.8d old"
  assert.equal(age(922.8 * 86400), '2.5y');
});
