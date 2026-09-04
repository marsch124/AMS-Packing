// qr.js — QR code encoder for sharing a grab list as a code.
// Byte mode, error-correction levels L and M, versions 1–15 (up to 523 bytes),
// automatic mask selection. Output is a module matrix or an inline SVG. Written
// from the ISO 18004 rules so the app needs no third-party code. Ported from
// AMS PomoTimer, where the same encoder shares timer templates.

export const QR = (() => {
    /* ---- GF(256) arithmetic and Reed–Solomon ---- */
    const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
    (function () {
        let x = 1;
        for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
        for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    })();
    const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

    function genPoly(n) {
        let g = [1];
        for (let i = 0; i < n; i++) {
            const ng = new Array(g.length + 1).fill(0);
            for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
            g = ng;
        }
        return g;
    }

    function rsEncode(data, n) {
        const g = genPoly(n);
        const res = new Array(n).fill(0);
        for (const b of data) {
            const f = b ^ res[0];
            res.shift(); res.push(0);
            if (f) for (let j = 0; j < n; j++) res[j] ^= mul(g[j + 1], f);
        }
        return res;
    }

    /* ---- Version tables: [ec codewords per block, [[blocks, data codewords per block], ...]] ---- */
    const TABLE = {
        1:  { L: [7,  [[1, 19]]],            M: [10, [[1, 16]]] },
        2:  { L: [10, [[1, 34]]],            M: [16, [[1, 28]]] },
        3:  { L: [15, [[1, 55]]],            M: [26, [[1, 44]]] },
        4:  { L: [20, [[1, 80]]],            M: [18, [[2, 32]]] },
        5:  { L: [26, [[1, 108]]],           M: [24, [[2, 43]]] },
        6:  { L: [18, [[2, 68]]],            M: [16, [[4, 27]]] },
        7:  { L: [20, [[2, 78]]],            M: [18, [[4, 31]]] },
        8:  { L: [24, [[2, 97]]],            M: [22, [[2, 38], [2, 39]]] },
        9:  { L: [30, [[2, 116]]],           M: [22, [[3, 36], [2, 37]]] },
        10: { L: [18, [[2, 68], [2, 69]]],   M: [26, [[4, 43], [1, 44]]] },
        11: { L: [20, [[4, 81]]],            M: [30, [[1, 50], [4, 51]]] },
        12: { L: [24, [[2, 92], [2, 93]]],   M: [22, [[6, 36], [2, 37]]] },
        13: { L: [26, [[4, 107]]],           M: [22, [[8, 37], [1, 38]]] },
        14: { L: [30, [[3, 115], [1, 116]]], M: [24, [[4, 40], [5, 41]]] },
        15: { L: [22, [[5, 87], [1, 88]]],   M: [24, [[5, 41], [5, 42]]] }
    };
    const ALIGN = {
        2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
        10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70]
    };
    const LEVEL_BITS = { L: 1, M: 0 };

    function capacity(version, level) {
        return TABLE[version][level][1].reduce((a, [b, d]) => a + b * d, 0);
    }

    /* ---- Encode text into the final codeword sequence ---- */
    function codewords(bytes, level) {
        let version = 0;
        for (let v = 1; v <= 15; v++) {
            const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
            if (need <= capacity(v, level) * 8) { version = v; break; }
        }
        if (!version) throw new Error('Too much data for a QR code');
        const [ecPerBlock, groups] = TABLE[version][level];
        const dataCap = capacity(version, level);
        const bits = [];
        const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
        put(4, 4);
        put(bytes.length, version < 10 ? 8 : 16);
        bytes.forEach(b => put(b, 8));
        put(0, Math.min(4, dataCap * 8 - bits.length));
        while (bits.length % 8) bits.push(0);
        const data = [];
        for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
        for (let i = 0; data.length < dataCap; i++) data.push(i % 2 ? 0x11 : 0xEC);
        const blocks = [];
        let off = 0;
        groups.forEach(([count, len]) => {
            for (let i = 0; i < count; i++) { const d = data.slice(off, off + len); off += len; blocks.push({ d, e: rsEncode(d, ecPerBlock) }); }
        });
        const out = [];
        const maxD = Math.max(...blocks.map(b => b.d.length));
        for (let i = 0; i < maxD; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
        for (let i = 0; i < ecPerBlock; i++) blocks.forEach(b => out.push(b.e[i]));
        return { version, out };
    }

    /* ---- Matrix construction ---- */
    function buildMatrix(version, level, out) {
        const size = version * 4 + 17;
        const m = Array.from({ length: size }, () => new Int8Array(size).fill(0));
        const fn = Array.from({ length: size }, () => new Uint8Array(size));
        const set = (r, c, v) => { m[r][c] = v ? 1 : 0; fn[r][c] = 1; };

        const finder = (r0, c0) => {
            for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
                const rr = r0 + r, cc = c0 + c;
                if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
                const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
                set(rr, cc, inner && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
            }
        };
        finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
        for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        const al = ALIGN[version] || [];
        al.forEach(r => al.forEach(c => {
            if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) return;
            for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }));
        // Reserve the format areas (values are written after masking)
        for (let i = 0; i <= 8; i++) { if (!fn[8][i]) set(8, i, 0); if (!fn[i][8]) set(i, 8, 0); }
        for (let i = size - 8; i < size; i++) { set(8, i, 0); set(i, 8, 0); }
        if (version >= 7) {
            let rem = version;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            const vb = (version << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const bit = (vb >> i) & 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
                set(a, b, bit); set(b, a, bit);
            }
        }
        // Data, zigzag in column pairs from the right, skipping the timing column
        let bitIdx = 0, upward = true;
        for (let col = size - 1; col >= 1; col -= 2) {
            if (col === 6) col = 5;
            for (let k = 0; k < size; k++) {
                const r = upward ? size - 1 - k : k;
                for (let cc = 0; cc < 2; cc++) {
                    const c = col - cc;
                    if (fn[r][c]) continue;
                    const bit = bitIdx < out.length * 8 ? (out[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1 : 0;
                    m[r][c] = bit;
                    bitIdx++;
                }
            }
            upward = !upward;
        }
        return { size, m, fn };
    }

    const MASKS = [
        (r, c) => (r + c) % 2 === 0,
        (r, c) => r % 2 === 0,
        (r, c) => c % 3 === 0,
        (r, c) => (r + c) % 3 === 0,
        (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
        (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
        (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
        (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0
    ];

    function applyMask(mx, mask) {
        const { size, m, fn } = mx;
        const f = MASKS[mask];
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && f(r, c)) m[r][c] ^= 1;
    }

    function writeFormat(mx, level, mask) {
        const { size, m } = mx;
        const data = (LEVEL_BITS[level] << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        // Position i (0 = row 8 col 0) carries bit 14-i: most significant first.
        const bit = i => (bits >> (14 - i)) & 1;
        for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
        m[8][7] = bit(6); m[8][8] = bit(7); m[7][8] = bit(8);
        for (let i = 9; i < 15; i++) m[14 - i][8] = bit(i);
        for (let i = 0; i < 8; i++) m[size - 1 - i][8] = bit(i);
        for (let i = 8; i < 15; i++) m[8][size - 15 + i] = bit(i);
        m[size - 8][8] = 1;
    }

    function penalty(mx) {
        const { size, m } = mx;
        let p = 0;
        const runs = (get) => {
            for (let i = 0; i < size; i++) {
                let run = 1;
                for (let j = 1; j <= size; j++) {
                    if (j < size && get(i, j) === get(i, j - 1)) run++;
                    else { if (run >= 5) p += 3 + (run - 5); run = 1; }
                }
            }
        };
        runs((i, j) => m[i][j]);
        runs((i, j) => m[j][i]);
        for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
            const v = m[r][c];
            if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
        }
        const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
        const find = (get) => {
            for (let i = 0; i < size; i++) for (let j = 0; j <= size - 11; j++) {
                let a = true, b = true;
                for (let k = 0; k < 11; k++) { const v = get(i, j + k); if (v !== pat1[k]) a = false; if (v !== pat2[k]) b = false; }
                if (a || b) p += 40;
            }
        };
        find((i, j) => m[i][j]);
        find((i, j) => m[j][i]);
        let dark = 0;
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
        const total = size * size;
        p += 10 * Math.floor(Math.abs(dark * 20 - total * 10) / total);
        return p;
    }

    /* Returns { size, modules } where modules[r][c] is 1 for dark. */
    function encode(text, level) {
        level = level === 'M' ? 'M' : 'L';
        const bytes = new TextEncoder().encode(text);
        const { version, out } = codewords(bytes, level);
        let best = null, bestScore = Infinity;
        for (let mask = 0; mask < 8; mask++) {
            const mx = buildMatrix(version, level, out);
            applyMask(mx, mask);
            writeFormat(mx, level, mask);
            const score = penalty(mx);
            if (score < bestScore) { bestScore = score; best = mx; }
        }
        return { size: best.size, modules: best.m.map(row => Array.from(row)), version };
    }

    /* Inline SVG with a 4-module quiet zone. Dark modules take `dark`, ground `light`. */
    function toSvg(text, opts) {
        opts = opts || {};
        const q = 4;
        const { size, modules } = encode(text, opts.level);
        const n = size + q * 2;
        let d = '';
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) d += `M${c + q} ${r + q}h1v1h-1z`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
            `<rect width="${n}" height="${n}" fill="${opts.light || '#ffffff'}"/><path d="${d}" fill="${opts.dark || '#000000'}"/></svg>`;
    }

    return { encode, toSvg };
})();

export const encode = QR.encode;
export const toSvg = QR.toSvg;
