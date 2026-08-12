#!/usr/bin/env node
/* 메인 이벤트 배너용 16:9 이미지.
 *
 * 배너가 글자만 있던 한 줄에서 이미지 위에 글이 얹히는 큰 카드로 바뀌었다.
 * 이벤트마다 다른 그림이 필요한데, 사진을 구해 올 수도 없고 Storage 여유도 없어서
 * (무료 1GB 중 381MB 사용, 그중 365MB가 오디오) 여기서 생성해 레포에 넣는다.
 *
 * 글자가 위에 얹히므로 아래쪽은 어둡게 깔아 흰 글씨가 항상 읽히게 한다.
 *
 * 실행: node scripts/gen-banner-media.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'demo', 'banner');
fs.mkdirSync(OUT, { recursive: true });

/* ── PNG 인코더 (gen-demo-media.js 와 동일) ────────────────────────── */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      raw[o++] = p[0] & 255; raw[o++] = p[1] & 255; raw[o++] = p[2] & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const strSeed = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** 16:9 배너 — 대각 그라데이션 + 큰 도형 + 하단 어둡게(글자 가독성) */
function banner(w, h, opt) {
  const r = rnd(opt.seed);
  const c1 = hex(opt.c1), c2 = hex(opt.c2), bg = hex('#0b0b0f');
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    shapes.push({
      x: r() * w, y: r() * h * 0.85,
      rad: (0.13 + r() * 0.3) * h,
      kind: Math.floor(r() * 3),
      col: r() < 0.5 ? c1 : c2,
      a: 0.2 + r() * 0.45,
    });
  }
  const g = rnd(opt.seed ^ 0x5bf03635);
  const gt = new Float32Array(4096);
  for (let i = 0; i < gt.length; i++) gt[i] = (g() - 0.5) * 5;
  const Q = 6, q = v => Math.round(Math.max(0, Math.min(255, v)) / Q) * Q;
  return png(w, h, (x, y) => {
    const t = Math.max(0, Math.min(1, (x / w) * 0.55 + (y / h) * 0.65));
    let col = mix(bg, mix(c1, c2, t), 0.34 + 0.3 * t);
    for (const s of shapes) {
      const dx = x - s.x, dy = y - s.y;
      let d;
      if (s.kind === 0) d = Math.sqrt(dx * dx + dy * dy);
      else if (s.kind === 1) d = Math.max(Math.abs(dx), Math.abs(dy));
      else d = Math.abs(dx) + Math.abs(dy);
      if (d < s.rad) col = mix(col, s.col, s.a * Math.min(1, (s.rad - d) / (s.rad * 0.5)));
    }
    /* 아래 55%부터 서서히 어둡게 — 흰 글씨가 어떤 그림 위에서도 읽히도록 */
    const fy = y / h;
    if (fy > 0.42) {
      const k = Math.pow((fy - 0.42) / 0.58, 1.35) * 0.82;
      col = mix(col, [8, 8, 12], k);
    }
    const n = gt[((y * 131 + x * 7) & 4095)];
    return [q(col[0] + n), q(col[1] + n), q(col[2] + n)];
  });
}

/* 이벤트 id → 색 조합. 성격이 다른 것끼리 확실히 구분되게. */
const EVENTS = [
  { id: 'jul', c1: '#F6C453', c2: '#E0698A' },          /* 음원 발매 — 따뜻한 노랑/핑크 */
  { id: 'sep', c1: '#F0A93B', c2: '#B85CC4' },
  { id: 'rp', c1: '#E85D5D', c2: '#7A3BE0' },           /* 공연 — 붉은/보라 */
  { id: 'gh', c1: '#53E0C8', c2: '#3B6FE0' },
  { id: 'sc2026', c1: '#7CD86B', c2: '#53E0C8' },
  { id: 'proj_minlee', c1: '#4A7BE0', c2: '#C455E0' },  /* 프로젝트 — 푸른/보라 */
  { id: 'proj_kwon', c1: '#53E0C8', c2: '#F6C453' },
  { id: 'proj_ena', c1: '#E0698A', c2: '#F0A93B' },
  { id: 'proj_yesa', c1: '#B85CC4', c2: '#F6C453' },  /* 예사 × MAMAMOO 리믹스 — 보라/금 */
];

let total = 0;
console.log('배너 이미지 생성 →', OUT);
for (const e of EVENTS) {
  const buf = banner(800, 450, { c1: e.c1, c2: e.c2, seed: strSeed(e.id) });
  fs.writeFileSync(path.join(OUT, e.id + '.png'), buf);
  total += buf.length;
  console.log('  ' + (e.id + '.png').padEnd(20) + (buf.length / 1024).toFixed(0) + ' KB');
}
console.log('합계 ' + (total / 1024).toFixed(0) + ' KB');
