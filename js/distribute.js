// js/distribute.js — 유통사 제출용 ZIP 패키지 빌더 (유틸 모듈)
// renderUpload() 흐름에서 호출됨. 별도 라우트 없음.
//   호출: await window.Distribute.tryGenerateZip(meta, coverFile, audioFile, { onProgress })
//   반환: { name, sizeBytes }   ← 검증 통과 + ZIP 다운로드 트리거됨
//         { skipped: true, reason } ← 요건 미달, 호출측은 무시하면 됨
// 의존: JSZip (CDN, index.html에서 로드)
(function () {
  'use strict';

  const COVER_MIN_PX = 3000;
  const COVER_MAX_PX = 5000;
  const COVER_MAX_BYTES = 10 * 1024 * 1024;
  const VALID_SAMPLE_RATES = [44100, 48000];
  const VALID_BIT_DEPTHS = [16, 24];

  // RIFF/WAVE: bytes 0-3 "RIFF", 8-11 "WAVE", "fmt " 청크 안에
  // audioFormat(u16 @+8), channels(u16 @+10), sampleRate(u32 @+12), bitsPerSample(u16 @+22) (LE).
  async function parseWavHeader(file) {
    const buf = await file.slice(0, 4096).arrayBuffer();
    const dv = new DataView(buf);
    const td = new TextDecoder('ascii');
    if (td.decode(buf.slice(0, 4)) !== 'RIFF') return { error: 'RIFF 헤더가 아닙니다.' };
    if (td.decode(buf.slice(8, 12)) !== 'WAVE') return { error: 'WAVE 시그니처가 없습니다.' };
    let off = 12;
    while (off + 8 <= buf.byteLength) {
      const id = td.decode(buf.slice(off, off + 4));
      const size = dv.getUint32(off + 4, true);
      if (id === 'fmt ') {
        return {
          audioFormat: dv.getUint16(off + 8, true),
          channels: dv.getUint16(off + 10, true),
          sampleRate: dv.getUint32(off + 12, true),
          bitsPerSample: dv.getUint16(off + 22, true)
        };
      }
      off += 8 + size;
    }
    return { error: '"fmt " 청크를 찾지 못했습니다.' };
  }

  function validateWav(spec) {
    if (spec.error) return spec.error;
    if (spec.audioFormat !== 1 && spec.audioFormat !== 0xFFFE) {
      return `비압축 PCM WAV가 필요합니다 (format=${spec.audioFormat}).`;
    }
    if (!VALID_SAMPLE_RATES.includes(spec.sampleRate)) {
      return `샘플레이트는 44100/48000 Hz여야 합니다 (현재 ${spec.sampleRate}).`;
    }
    if (!VALID_BIT_DEPTHS.includes(spec.bitsPerSample)) {
      return `비트뎁스는 16/24-bit여야 합니다 (현재 ${spec.bitsPerSample}).`;
    }
    return null;
  }

  async function readImageInfo(file) {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => rej(new Error('이미지를 디코드하지 못했습니다.'));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function validateCover(file, dims) {
    if (!/^image\/(jpeg|png)$/.test(file.type)) return 'JPG/PNG만 허용됩니다.';
    if (file.size > COVER_MAX_BYTES) return `이미지가 10MB를 초과 (${(file.size/1048576).toFixed(2)}MB).`;
    if (dims.width !== dims.height) return `1:1 정사각형이어야 합니다 (현재 ${dims.width}×${dims.height}).`;
    if (dims.width < COVER_MIN_PX || dims.width > COVER_MAX_PX) {
      return `해상도는 ${COVER_MIN_PX}~${COVER_MAX_PX}px 사이여야 합니다 (현재 ${dims.width}).`;
    }
    return null;
  }

  function sanitizeName(s) {
    return (s || '').trim()
      .replace(/[^\p{L}\p{N}\-_]+/gu, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'untitled';
  }

  function buildInfoTxt(meta, wavSpec, coverDims, coverFile, wavFile) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const coverFmt = coverFile.type === 'image/png' ? 'PNG' : 'JPEG';
    const ch = wavSpec.channels === 1 ? 'Mono' : wavSpec.channels === 2 ? 'Stereo' : `${wavSpec.channels}ch`;
    const lines = [
      '=== Off-Stage 유통 패키지 ===',
      `생성일: ${now}`,
      '',
      '[필수 정보]',
      `아티스트: ${meta.artist || ''}`,
      `곡 제목: ${meta.title || ''}`,
      `발매일: ${meta.releaseDate || ''}`,
      '',
      '[부가 정보]'
    ];
    if (meta.album) lines.push(`앨범: ${meta.album}`);
    if (meta.genre) lines.push(`장르: ${meta.genre}`);
    if (meta.isrc) lines.push(`ISRC: ${meta.isrc}`);
    if (meta.composer) lines.push(`작곡: ${meta.composer}`);
    if (meta.lyricist) lines.push(`작사: ${meta.lyricist}`);
    if (meta.language) lines.push(`언어: ${meta.language}`);
    if (meta.tags && meta.tags.length) lines.push(`태그: ${meta.tags.join(', ')}`);
    if (meta.description) {
      lines.push('설명:');
      meta.description.split(/\r?\n/).forEach(l => lines.push('  ' + l));
    }
    lines.push('');
    lines.push('[기술 사양]');
    lines.push(`오디오: WAV / ${wavSpec.sampleRate} Hz / ${wavSpec.bitsPerSample}-bit / ${ch} / ${(wavFile.size/1048576).toFixed(2)} MB`);
    lines.push(`커버: ${coverDims.width}×${coverDims.height} / ${coverFmt} / ${(coverFile.size/1048576).toFixed(2)} MB`);
    lines.push('');
    return lines.join('\r\n');
  }

  async function checkEligibility(coverFile, audioFile) {
    if (!audioFile) return { ok: false, reason: '오디오 파일 없음' };
    if (!coverFile) return { ok: false, reason: '커버 파일 없음 (유통용 ZIP은 커버 필수)' };
    if (!/\.wav$/i.test(audioFile.name)) return { ok: false, reason: 'WAV가 아님 (현재: ' + audioFile.name + ')' };
    const wavSpec = await parseWavHeader(audioFile);
    const wavErr = validateWav(wavSpec);
    if (wavErr) return { ok: false, reason: 'WAV ' + wavErr };
    let coverDims;
    try { coverDims = await readImageInfo(coverFile); }
    catch (e) { return { ok: false, reason: '커버 디코드 실패' }; }
    const coverErr = validateCover(coverFile, coverDims);
    if (coverErr) return { ok: false, reason: '커버 ' + coverErr };
    return { ok: true, wavSpec, coverDims };
  }

  async function tryGenerateZip(meta, coverFile, audioFile, opts) {
    opts = opts || {};
    if (typeof JSZip === 'undefined') return { skipped: true, reason: 'JSZip 미로드' };

    const elig = await checkEligibility(coverFile, audioFile);
    if (!elig.ok) return { skipped: true, reason: elig.reason };

    const baseName = `${sanitizeName(meta.artist)}_${sanitizeName(meta.title)}`;
    const coverExt = coverFile.type === 'image/png' ? 'png' : 'jpg';
    const infoTxt = buildInfoTxt(meta, elig.wavSpec, elig.coverDims, coverFile, audioFile);

    const zip = new JSZip();
    zip.file(`${baseName}.wav`, audioFile);
    zip.file(`${baseName}_cover.${coverExt}`, coverFile);
    zip.file('info.txt', infoTxt);

    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      opts.onProgress || (() => {})
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    return { name: a.download, sizeBytes: blob.size };
  }

  // URL(예: Supabase Storage publicUrl) 기반으로 ZIP 생성. 관리자 어드민 패널에서 사용.
  // 내부에서 fetch → File로 wrap → tryGenerateZip 재사용.
  async function tryGenerateZipFromUrls(meta, coverUrl, audioUrl, opts) {
    opts = opts || {};
    if (!audioUrl) return { skipped: true, reason: '오디오 URL 없음' };
    if (!coverUrl) return { skipped: true, reason: '커버 URL 없음' };

    const audioName = (audioUrl.split('?')[0].split('/').pop() || 'audio.wav');
    if (!/\.wav$/i.test(audioName)) {
      return { skipped: true, reason: 'WAV가 아님 (' + audioName + ')' };
    }

    if (opts.onStage) opts.onStage('fetch');
    const [audioResp, coverResp] = await Promise.all([fetch(audioUrl), fetch(coverUrl)]);
    if (!audioResp.ok) return { skipped: true, reason: `오디오 fetch 실패 (${audioResp.status})` };
    if (!coverResp.ok) return { skipped: true, reason: `커버 fetch 실패 (${coverResp.status})` };
    const [audioBlob, coverBlob] = await Promise.all([audioResp.blob(), coverResp.blob()]);

    const coverName = (coverUrl.split('?')[0].split('/').pop() || 'cover.jpg');
    // Supabase는 보통 정확한 Content-Type 줌. 누락 시 확장자로 fallback.
    const coverType = coverBlob.type
      || (/\.png$/i.test(coverName) ? 'image/png' : 'image/jpeg');
    const audioFile = new File([audioBlob], audioName, { type: 'audio/wav' });
    const coverFile = new File([coverBlob], coverName, { type: coverType });

    if (opts.onStage) opts.onStage('zip');
    return await tryGenerateZip(meta, coverFile, audioFile, opts);
  }

  window.Distribute = {
    tryGenerateZip, tryGenerateZipFromUrls,
    parseWavHeader, validateWav, readImageInfo, validateCover,
    buildInfoTxt, sanitizeName, checkEligibility
  };
})();
