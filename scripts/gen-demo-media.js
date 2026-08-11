#!/usr/bin/env node
/* 레퍼런스용 가상 아티스트 3명의 미디어를 만든다 (아바타·커버·사진·데모 음원).
 *
 * 왜 레포에 넣나: Supabase 무료 저장소 1GB 중 이미 381MB를 썼고 그중 365MB가 오디오다.
 * 샘플까지 거기에 올리면 진짜 학생들 몫이 줄어든다. 데모 파일은 정적 자산이라
 * Vercel이 그냥 서빙하면 되고 할당량을 전혀 쓰지 않는다.
 *
 * 실행: node scripts/gen-demo-media.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'demo');
fs.mkdirSync(OUT, { recursive: true });

/* ── PNG 인코더 (의존성 없이) ───────────────────────────────────────── */
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
/** rgba: (x,y)=>[r,g,b] 를 받아 w×h PNG 버퍼를 만든다 */
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                        /* filter: none */
    for (let x = 0; x < w; x++) {
      const p = pixel(x, y);
      raw[o++] = p[0] & 255; raw[o++] = p[1] & 255; raw[o++] = p[2] & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   /* 8bit truecolor */
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── 그리기 헬퍼 ───────────────────────────────────────────────────── */
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/* 결정론적 노이즈 — 같은 씨앗이면 늘 같은 그림 */
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** 그라데이션 + 도형 + 그레인. 앱의 어두운 톤과 민트/레몬 팔레트에 맞춘다. */
function artwork(w, h, opt) {
  const r = rnd(opt.seed);
  const c1 = hex(opt.c1), c2 = hex(opt.c2), bg = hex(opt.bg || '#0e0e12');
  /* 도형 몇 개를 미리 뽑아둔다 */
  const shapes = [];
  for (let i = 0; i < (opt.shapes || 5); i++) {
    shapes.push({
      x: r() * w, y: r() * h, rad: (0.08 + r() * 0.22) * Math.min(w, h),
      /* soft=true 면 원만 쓴다 — 아바타는 동그란 마스크 안에 들어가는데 사각형·마름모가
         들어가면 원이 아니라 육각형처럼 각져 보인다. 커버·사진은 각진 도형이 있어야 멋있다. */
      kind: opt.soft ? 0 : Math.floor(r() * 3),
      col: r() < 0.5 ? c1 : c2, a: 0.18 + r() * 0.5,
    });
  }
  const grain = rnd(opt.seed ^ 0x9e3779b9);
  const gtab = new Float32Array(4096);
  for (let i = 0; i < gtab.length; i++) gtab[i] = (grain() - 0.5) * 5;
  /* 색을 몇 단계로 뭉갠다 — 부드러운 그라데이션은 픽셀마다 값이 달라 PNG가 거의 압축되지
     않는다. 눈에는 티가 안 나는 수준으로 계단을 주면 용량이 1/4 이하로 떨어진다. */
  const Q = opt.q || 6;
  const q = v => Math.round(Math.max(0, Math.min(255, v)) / Q) * Q;
  return png(w, h, (x, y) => {
    /* 대각 그라데이션 */
    const t = Math.max(0, Math.min(1, (x / w) * 0.6 + (y / h) * 0.6));
    let col = mix(bg, mix(c1, c2, t), 0.32 + 0.28 * t);
    /* 도형을 부드럽게 얹는다 */
    for (const s of shapes) {
      const dx = x - s.x, dy = y - s.y;
      let d;
      if (s.kind === 0) d = Math.sqrt(dx * dx + dy * dy);                    /* 원 */
      else if (s.kind === 1) d = Math.max(Math.abs(dx), Math.abs(dy));        /* 사각 */
      else d = Math.abs(dx) + Math.abs(dy);                                   /* 마름모 */
      if (d < s.rad) {
        const edge = Math.min(1, (s.rad - d) / (s.rad * 0.45));
        col = mix(col, s.col, s.a * edge);
      }
    }
    const g = gtab[((y * 131 + x * 7) & 4095)];
    return [q(col[0] + g), q(col[1] + g), q(col[2] + g)];
  });
}

/* ── WAV 신시사이저 ────────────────────────────────────────────────── */
const SR = 22050;                       /* 22.05kHz 모노 — 용량을 아끼면서 충분히 들린다 */
function wav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  return buf;
}
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);       /* MIDI 번호 → Hz */
/* 부드러운 신스 한 음 (사인 + 배음 + ADSR) */
function tone(out, startS, durS, midi, gain, timbre) {
  const f = NOTE(midi), a = 0.012 * SR, d = 0.25 * SR;
  const s0 = Math.floor(startS * SR), len = Math.floor(durS * SR);
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= out.length) break;
    const t = i / SR;
    let env;
    if (i < a) env = i / a;
    else env = Math.max(0, Math.pow(1 - (i - a) / Math.max(1, len - a), 1.6));
    const w = 2 * Math.PI * f * t;
    let v = Math.sin(w);
    if (timbre === 'warm') v = Math.sin(w) * 0.7 + Math.sin(2 * w) * 0.2 + Math.sin(3 * w) * 0.08;
    else if (timbre === 'bell') v = Math.sin(w) * 0.6 + Math.sin(2.01 * w) * 0.25 + Math.sin(4.02 * w) * 0.12;
    else if (timbre === 'pluck') v = (Math.sin(w) + Math.sin(3 * w) / 3 + Math.sin(5 * w) / 5) * 0.55;
    out[idx] += v * env * gain;
  }
}
/* 킥·하이햇 — 노이즈 기반 */
function drum(out, startS, kind, gain) {
  const s0 = Math.floor(startS * SR);
  const len = Math.floor((kind === 'kick' ? 0.16 : 0.05) * SR);
  const r = rnd(s0 + (kind === 'kick' ? 7 : 13));
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= out.length) break;
    const t = i / SR, env = Math.pow(1 - i / len, kind === 'kick' ? 2.2 : 3.4);
    const v = kind === 'kick'
      ? Math.sin(2 * Math.PI * (58 - 26 * (i / len)) * t)
      : (r() * 2 - 1);
    out[idx] += v * env * gain;
  }
}
function master(out) {
  /* 가벼운 소프트 클리핑 + 페이드 인/아웃 */
  const fi = 0.25 * SR, fo = 1.2 * SR;
  for (let i = 0; i < out.length; i++) {
    let v = out[i];
    v = Math.tanh(v * 1.15);
    if (i < fi) v *= i / fi;
    if (i > out.length - fo) v *= Math.max(0, (out.length - i) / fo);
    out[i] = v * 0.86;
  }
  return out;
}

/* ── 곡 3개 ────────────────────────────────────────────────────────── */
/* 1) 유하린 — 베드룸 팝. 잔잔한 4코드 루프 + 부드러운 아르페지오 */
function trackHarin(sec = 16) {
  const out = new Float32Array(sec * SR);
  const prog = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [50, 53, 57]];  /* Am F G Dm */
  const bar = 2.0;
  for (let b = 0; b * bar < sec; b++) {
    const ch = prog[b % prog.length], t0 = b * bar;
    ch.forEach((m, i) => tone(out, t0, bar * 0.98, m, 0.13, 'warm'));
    /* 아르페지오 한 옥타브 위 */
    for (let k = 0; k < 8; k++) {
      const m = ch[k % ch.length] + 12;
      tone(out, t0 + k * (bar / 8), bar / 8 * 1.6, m, 0.075, 'bell');
    }
    drum(out, t0, 'kick', 0.5); drum(out, t0 + bar / 2, 'kick', 0.36);
    for (let k = 0; k < 4; k++) drum(out, t0 + k * (bar / 4) + bar / 8, 'hat', 0.1);
  }
  return master(out);
}
/* 2) Noah Kim — 로파이 힙합 비트. 무거운 킥 + 재지한 코드 */
function trackNoah(sec = 16) {
  const out = new Float32Array(sec * SR);
  const prog = [[48, 55, 59, 62], [46, 53, 57, 60]];   /* Cmaj7-ish → Bbmaj7-ish */
  const bar = 2.4;
  for (let b = 0; b * bar < sec; b++) {
    const ch = prog[b % prog.length], t0 = b * bar;
    ch.forEach(m => tone(out, t0 + 0.04, bar * 0.9, m, 0.1, 'warm'));
    tone(out, t0, bar * 0.5, ch[0] - 12, 0.16, 'warm');            /* 베이스 */
    drum(out, t0, 'kick', 0.62);
    drum(out, t0 + bar * 0.42, 'kick', 0.4);
    drum(out, t0 + bar * 0.5, 'hat', 0.16);
    for (let k = 0; k < 8; k++) drum(out, t0 + k * (bar / 8), 'hat', k % 2 ? 0.06 : 0.11);
  }
  return master(out);
}
/* 3) 초록불 — 인디 밴드. 8비트 스트로크 + 리드 멜로디 */
function trackChorok(sec = 16) {
  const out = new Float32Array(sec * SR);
  const prog = [[52, 59, 64], [57, 60, 64], [50, 57, 62], [55, 59, 62]];  /* E A D G */
  const mel = [76, 74, 71, 74, 76, 79, 76, 71];
  const bar = 1.9;
  for (let b = 0; b * bar < sec; b++) {
    const ch = prog[b % prog.length], t0 = b * bar;
    for (let k = 0; k < 8; k++) {
      ch.forEach(m => tone(out, t0 + k * (bar / 8), bar / 8 * 1.3, m, 0.06, 'pluck'));
    }
    tone(out, t0, bar * 0.45, ch[0] - 12, 0.15, 'warm');
    if (b >= 2) tone(out, t0, bar * 0.9, mel[b % mel.length], 0.1, 'bell');
    drum(out, t0, 'kick', 0.5); drum(out, t0 + bar * 0.5, 'kick', 0.34);
    for (let k = 0; k < 8; k++) drum(out, t0 + k * (bar / 8), 'hat', 0.08);
  }
  return master(out);
}

/* ── 아티스트 정의 ─────────────────────────────────────────────────── */
const ARTISTS = [
  { slug: 'harin', c1: '#F6C453', c2: '#E0698A', seed: 20260811, track: trackHarin },
  { slug: 'noah', c1: '#53E0C8', c2: '#4A7BE0', seed: 77712345, track: trackNoah },
  { slug: 'chorok', c1: '#7CD86B', c2: '#F6C453', seed: 31415926, track: trackChorok },
];

let total = 0;
const w = (name, buf) => {
  fs.writeFileSync(path.join(OUT, name), buf);
  total += buf.length;
  console.log('  ' + name.padEnd(22) + (buf.length / 1024).toFixed(0) + ' KB');
};

console.log('데모 미디어 생성 →', OUT);
for (const a of ARTISTS) {
  /* 아바타는 동그란 마스크 안에 들어가므로 각진 도형 없이(soft) — 원형으로 읽히게 */
  w(a.slug + '-avatar.png', artwork(320, 320, { c1: a.c1, c2: a.c2, seed: a.seed, shapes: 3, soft: true }));
  w(a.slug + '-cover.png', artwork(560, 560, { c1: a.c1, c2: a.c2, seed: a.seed + 1, shapes: 6 }));
  w(a.slug + '-photo.png', artwork(800, 534, { c1: a.c2, c2: a.c1, seed: a.seed + 2, shapes: 7 }));
  w(a.slug + '-demo.wav', wav(a.track(16)));
}
console.log('합계 ' + (total / 1024 / 1024).toFixed(2) + ' MB');
