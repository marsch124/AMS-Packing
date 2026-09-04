import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QR } from '../js/qr.js';

// The three finder patterns are what a phone camera locks onto first; if they
// are wrong nothing else matters. Check the top-left one in full.
function assertFinder(modules, r0, c0) {
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const edge = r === 0 || r === 6 || c === 0 || c === 6;
    const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    assert.equal(modules[r0 + r][c0 + c], edge || core ? 1 : 0, `finder module at ${r0 + r},${c0 + c}`);
  }
}

test('QR.encode: a short link fits a small symbol with correct finder patterns', () => {
  const { size, modules, version } = QR.encode('https://marsch124.github.io/AMS-Packing/#/g/abc', 'L');
  assert.equal(size, version * 4 + 17);
  assert.ok(version >= 1 && version <= 15);
  assert.equal(modules.length, size);
  assertFinder(modules, 0, 0);
  assertFinder(modules, 0, size - 7);
  assertFinder(modules, size - 7, 0);
  // The dark module beside the bottom-left finder is always set.
  assert.equal(modules[size - 8][8], 1);
});

test('QR.encode: longer text steps up through the versions, and beyond the table it refuses', () => {
  const small = QR.encode('a'.repeat(20), 'L').version;
  const big = QR.encode('a'.repeat(400), 'L').version;
  assert.ok(big > small);
  assert.throws(() => QR.encode('a'.repeat(600), 'L'), /Too much data/);
});

test('QR.toSvg: an inline SVG with a quiet zone, ready to drop into the page', () => {
  const svg = QR.toSvg('hello', { dark: '#123456', light: '#ffffff' });
  assert.ok(svg.startsWith('<svg '));
  assert.match(svg, /viewBox="0 0 29 29"/, 'version 1 (21 modules) plus a 4-module quiet zone on each side');
  assert.match(svg, /fill="#123456"/);
});
