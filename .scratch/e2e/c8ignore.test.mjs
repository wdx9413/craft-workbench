import test from 'node:test';
import assert from 'node:assert/strict';
import { f } from './c8ignore.mjs';
test('f', () => { assert.equal(f(2), 3); });
