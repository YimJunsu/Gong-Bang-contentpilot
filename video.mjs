// 숏폼(1080x1920) 렌더러. script.json → 문장별 TTS(감정) → 자막·도장 PNG(HTML) → ffmpeg 합성(효과·효과음).
// 글자는 HTML/CSS로 그려 투명 PNG로 찍는다 — 한글 외곽선·강조색을 ffmpeg drawtext보다 훨씬 쉽게 맞춘다.
//
// script.json:
// { title:[윗줄, 아랫줄], badge?, font?,
//   scenes:[{ media?, stamp?, lines:[{ text:"*강조* 포함 문장", tone:"normal|emphasis|angry|whisper|excited" }] }] }
// 예전 형식 { narration } 도 받는다 (lines 한 줄, normal).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import ffmpegPath from 'ffmpeg-static';
import { EdgeTTS } from 'node-edge-tts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(HERE, 'assets', 'fonts');
const SFX = path.join(HERE, 'data', 'sfx');
const W = 1080, H = 1920, FPS = 30;
const IMAGE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const VIDEO = /\.(mp4|mov|webm|mkv|m4v)$/i;
const CAP_Y = 1700;               // 자막 중심 y
const BOX = { y: 600, w: W - 40, h: 960 };

export const FONT_CHOICES = {
  blackhan: { file: 'BlackHanSans-Regular.ttf', name: '검은고딕' },
  dohyeon: { file: 'DoHyeon-Regular.ttf', name: '도현' },
  jua: { file: 'Jua-Regular.ttf', name: '주아' }
};

// 감정. Edge는 진짜 감정 표현이 없어(한국어 목소리 스타일 없음) 높낮이·속도·음량 + 음향 효과로 흉내 낸다.
// ElevenLabs v3는 대괄호 감정 태그를 그대로 알아듣는다.
// 2026-10-16 다시 맞춤: 처음 값(화남 속도+24%·높이+12%·음량+50%·강한 압축)은 감정 차이는 크지만 기계처럼 튀었다.
//   사람이 실제로 낼 법한 폭으로 줄이고, 크기는 음량을 올리고 내리는 대신 '체감 음량(LUFS) 목표'로 맞춘다.
//   rate·pitch = 기본 속도(설정) 위에 더하는 %, lufs = 문장 체감 음량(보통 -18), fx = 가벼운 음색 보정
export const TONES = {
  normal: { name: '보통', rate: 0, pitch: 0, lufs: -18, fx: '', tag: '' },
  emphasis: { name: '강조', rate: -4, pitch: 3, lufs: -16.5, fx: '', tag: '[firmly]' },
  angry: { name: '화남', rate: 10, pitch: 5, lufs: -15, fx: 'acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=1.5', tag: '[angry]' },
  whisper: { name: '속삭임', rate: -8, pitch: -3, lufs: -23, fx: 'highpass=f=150,treble=g=3', tag: '[whispers]' },
  excited: { name: '신남', rate: 8, pitch: 6, lufs: -16.5, fx: 'treble=g=1.5', tag: '[excited]' }
};
// 보통 문장도 매번 같은 높이·속도면 로봇처럼 들린다 → 문장마다 아주 조금씩 다르게
const NORMAL_DRIFT = [[0, 0], [2, -2], [-1, 2], [1, 0]]; // [높이%, 속도%]
const pct = (n) => `${n >= 0 ? '+' : ''}${Math.round(n)}%`;
export function prosodyFor(tone, index, baseRate = '+10%') {
  const t = TONES[tone] || TONES.normal;
  const [driftPitch, driftRate] = tone === 'normal' ? NORMAL_DRIFT[index % NORMAL_DRIFT.length] : [0, 0];
  return { rate: pct((parseFloat(baseRate) || 0) + t.rate + driftRate), pitch: pct(t.pitch + driftPitch) };
}
// 문장 뒤 쉼: 문장부호와 다음 문장의 감정에 따라. 속삭이기 전엔 한 박자 쉬고, 화남·신남으로 넘어갈 땐 바짝 붙인다
export function pauseAfter(text, nextTone) {
  const end = spoken(text).slice(-1);
  let gap = /[?!]/.test(end) ? 0.22 : /[.…]/.test(end) ? 0.16 : /[,~]/.test(end) ? 0.1 : 0.14;
  if (nextTone === 'whisper') gap += 0.12;
  if (nextTone === 'angry' || nextTone === 'excited') gap = Math.max(0.06, gap - 0.06);
  return Number(gap.toFixed(2));
}
const toneOf = (t) => (TONES[t] ? t : 'normal');

function ffmpeg(args, log = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(err);
      log(err.split('\n').slice(-8).join('\n'));
      reject(new Error(`ffmpeg 종료 코드 ${code}`));
    });
  });
}
// 체감 음량(통합 LUFS)을 잰다. 너무 짧거나 조용해서 못 재면 보통 목표(-18)로 보고 그대로 둔다
async function loudness(file, filter = '') {
  const out = await ffmpeg(['-i', file, '-af', [filter, 'ebur128'].filter(Boolean).join(','), '-f', 'null', '-'], () => {}).catch(() => '');
  const m = [...String(out).matchAll(/^\s+I:\s+(-?[\d.]+) LUFS/gm)].pop();
  const value = m ? Number(m[1]) : NaN;
  return Number.isFinite(value) && value > -70 ? value : -18;
}
async function duration(file) {
  const out = await ffmpeg(['-i', file, '-f', 'null', '-'], () => {}).catch((e) => String(e));
  const m = [...String(out).matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop() || String(out).match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// TTS에 넘길 글: *강조* 별표와 [태그] 제거
const spoken = (text) => String(text).replace(/\*/g, '').replace(/\[[^\]]*\]\s*/g, '').trim();

// ---- TTS ----
// 반환: { file, words: [{part,start,end}] (ms) | null }. 타이밍이 없으면 자막을 글자 수 비례로 나눈다.
async function speak(text, tone, file, tts, prosody = prosodyFor(tone, 0, tts.rate)) {
  const plain = spoken(text);
  if (tts.provider === 'google') {
    if (!tts.googleApiKey) throw new Error('Google TTS API 키가 없습니다 (설정)');
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(tts.googleApiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text: plain }, voice: { languageCode: 'ko-KR', name: tts.googleVoice || 'ko-KR-Neural2-A' }, audioConfig: { audioEncoding: 'MP3', speakingRate: tts.speakingRate || 1.1 } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Google TTS: ${data.error?.message || res.status}`);
    await fs.writeFile(file, Buffer.from(data.audioContent, 'base64'));
    return { file, words: null };
  }
  if (tts.provider === 'elevenlabs') return speakEleven(plain, tone, file, tts);
  // 기본: Edge 읽어주기 음성 (키 없음, 비공식 엔드포인트라 막힐 수 있음)
  // 서버가 간헐적으로 429(요청 과다)로 연결을 거절한다(2026-10-14 실측) → 간격을 늘려 다시 시도.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const edge = new EdgeTTS({ voice: tts.voice || 'ko-KR-SunHiNeural', lang: 'ko-KR', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', saveSubtitles: true, timeout: 30000, ...prosody });
      await edge.ttsPromise(plain, file);
      break;
    } catch (error) {
      const message = String(error?.message || error);
      if (attempt >= 4 || !/429|timeout|ECONN|socket|network/i.test(message)) throw new Error(`Edge TTS: ${message}`);
      const wait = 5000 * 2 ** attempt;
      tts.log?.(`  음성 서버 ${/429/.test(message) ? '요청 제한(429)' : '연결 오류'} — ${wait / 1000}초 뒤 다시 시도 (${attempt + 1}/4)`);
      await sleep(wait);
    }
  }
  const words = JSON.parse(await fs.readFile(`${file}.json`, 'utf8').catch(() => 'null'));
  return { file, words };
}

// ElevenLabs v3: 감정 태그를 문장 앞에 붙인다. with-timestamps는 글자별 시간을 주므로 어절로 묶는다.
// ponytail: 키가 없어 실제 호출은 검증 못 함. 타이밍 응답이 없으면 글자 수 비례 자막으로 떨어진다.
async function speakEleven(plain, tone, file, tts) {
  if (!tts.elevenApiKey) throw new Error('ElevenLabs API 키가 없습니다 (설정)');
  const tag = TONES[tone].tag;
  const voice = tts.elevenVoiceId || 'pNInz6obpgDQGcFmaJgB'; // Adam
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': tts.elevenApiKey },
    body: JSON.stringify({ text: tag ? `${tag} ${plain}` : plain, model_id: tts.elevenModel || 'eleven_v3', language_code: 'ko' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ElevenLabs: ${data.detail?.message || data.detail?.status || res.status}`);
  await fs.writeFile(file, Buffer.from(data.audio_base64, 'base64'));
  const a = data.alignment || data.normalized_alignment;
  let words = null;
  if (a?.characters?.length) {
    words = [];
    let cur = null;
    a.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) { cur = null; return; }
      if (!cur) { cur = { part: '', start: a.character_start_times_seconds[i] * 1000 }; words.push(cur); }
      cur.part += ch; cur.end = a.character_end_times_seconds[i] * 1000;
    });
    words = words.filter((w) => !/^\[/.test(w.part)); // 감정 태그는 말하지 않는다
  }
  await fs.writeFile(`${file}.json`, JSON.stringify(words));
  return { file, words };
}

// 같은 문장·감정·목소리면 저장해 둔 음성을 쓴다 → 다시 렌더링해도 TTS를 다시 부르지 않고, 실패 지점부터 이어진다.
async function speakCached(text, tone, cacheDir, tts, prosody) {
  const voiceKey = tts.provider === 'elevenlabs' ? [tts.elevenVoiceId, tts.elevenModel] : [tts.voice, tts.googleVoice, prosody];
  const key = createHash('sha1').update(JSON.stringify([tts.provider || 'edge', ...voiceKey, tone, spoken(text)])).digest('hex').slice(0, 16);
  const file = path.join(cacheDir, `${key}.mp3`);
  const hit = await fs.stat(file).then((s) => s.size > 0).catch(() => false);
  if (hit) return { file, words: JSON.parse(await fs.readFile(`${file}.json`, 'utf8').catch(() => 'null')), cached: true };
  await fs.mkdir(cacheDir, { recursive: true });
  return speak(text, tone, file, tts, prosody);
}

// 단어 타이밍을 자막 덩어리(한 화면에 2줄 이하)로 묶는다. 문장 끝에서는 반드시 끊는다
export function chunkCaptions(text, words, total, maxChars = 22) {
  const units = words?.length
    ? words.map((w) => ({ text: w.part.trim(), start: w.start / 1000, end: w.end / 1000 }))
    : (() => { // 타이밍 없음 → 어절 글자 수 비례로 시간 배분
      const parts = text.split(/\s+/).filter(Boolean);
      const sum = parts.reduce((s, p) => s + p.length, 0) || 1;
      let t = 0;
      return parts.map((p) => { const d = (p.length / sum) * total; const u = { text: p, start: t, end: t + d }; t += d; return u; });
    })();
  const chunks = [];
  let cur = null;
  for (const u of units) {
    const sentenceEnd = /[.!?…]$/.test(cur?.text || '');
    if (!cur || sentenceEnd || (cur.text + ' ' + u.text).length > maxChars) { cur = { text: u.text, start: u.start, end: u.end, units: [u] }; chunks.push(cur); }
    else { cur.text += ` ${u.text}`; cur.end = u.end; cur.units.push(u); }
  }
  // 덩어리 사이 빈틈 없이 다음 덩어리 시작까지 늘린다 (깜빡임 방지)
  chunks.forEach((c, i) => { c.end = i < chunks.length - 1 ? chunks[i + 1].start : Math.max(c.end, total); });
  if (chunks.length) chunks[0].start = 0;
  return chunks;
}

// *강조* 구절에 들어 있는 어절을 자막에서 <em>으로 감싼다 (TTS 타이밍 어절은 별표가 없으므로 구절로 맞춘다)
const phrasesOf = (sourceText) => [...String(sourceText).matchAll(/\*(.+?)\*/g)].map((m) => m[1].replace(/\s+/g, ''));
function isEmphasized(word, phrases) {
  const core = word.replace(/[^\p{L}\p{N}]/gu, '');
  // 조사가 붙은 어절도 잡는다 ("개로" ← *딱 세 개*)
  const stem = core.replace(/(으로|에서|까지|부터|에게|처럼|로|은|는|이|가|을|를|에|의|도|만|요)$/u, '');
  return Boolean(core) && phrases.some((p) => p.includes(core) || (stem && p.endsWith(stem)));
}
export function markEmphasis(caption, sourceText) {
  const phrases = phrasesOf(sourceText);
  if (!phrases.length) return caption;
  return caption.split(' ').map((word) => (isEmphasized(word, phrases) ? `*${word}*` : word))
    .join(' ').replace(/\*\s\*/g, ' '); // 이웃한 강조 어절은 하나로 묶는다
}

// ---- 효과음 (한 번 합성해서 data/sfx에 둔다) ----
async function sfx() {
  await fs.mkdir(SFX, { recursive: true });
  const whoosh = path.join(SFX, 'whoosh.wav');
  const pop = path.join(SFX, 'pop.wav');
  if (!(await fs.stat(whoosh).catch(() => null))) {
    await ffmpeg(['-f', 'lavfi', '-i', 'anoisesrc=d=0.4:c=pink:a=0.6', '-af', 'highpass=f=250,lowpass=f=2800,afade=t=in:d=0.16,afade=t=out:st=0.18:d=0.22,volume=0.9', '-ar', '44100', '-ac', '2', whoosh]);
  }
  if (!(await fs.stat(pop).catch(() => null))) {
    // 낮은 '퉁' + 짧은 '딱' → 도장 찍는 소리
    await ffmpeg(['-f', 'lavfi', '-i', 'sine=f=140:d=0.22', '-f', 'lavfi', '-i', 'anoisesrc=d=0.05:c=white:a=0.5',
      '-filter_complex', '[0]afade=t=out:st=0.02:d=0.2,volume=1.6[a];[1]highpass=f=1500,afade=t=out:d=0.05[b];[a][b]amix=inputs=2:normalize=0',
      '-ar', '44100', '-ac', '2', pop]);
  }
  return { whoosh, pop };
}

// ---- 장면 음성: 문장마다 감정을 달리해 만들고 이어 붙인다 ----
async function buildVoice(scene, index, work, cacheDir, tts, log) {
  const parts = [];
  let offset = 0;
  const words = [];
  for (const [k, line] of scene.lines.entries()) {
    const tone = toneOf(line.tone);
    const prosody = prosodyFor(tone, k, tts.rate);
    const raw = await speakCached(line.text, tone, cacheDir, tts, prosody);
    const wav = path.join(work, `line-${index}-${k}.wav`);
    const gap = k < scene.lines.length - 1 ? pauseAfter(line.text, toneOf(scene.lines[k + 1].tone)) : 0.1;
    // 문장 하나: (ElevenLabs가 아니면) 가벼운 음색 보정 → 감정별 체감 음량 맞춤 → 앞뒤 아주 짧게 페이드(이음새 '딱' 소리 방지) → 쉼
    // 음량은 먼저 재고 문장 전체를 같은 만큼 올리고 내린다. 한 번에 자동 맞춤(loudnorm 1패스)은 짧은 문장에서 1.5dB씩 빗나가고
    // 문장 안에서 크기가 출렁여 부자연스러웠다(2026-10-16 실측).
    const color = tts.provider === 'elevenlabs' ? '' : TONES[tone].fx;
    const gain = TONES[tone].lufs - await loudness(raw.file, color);
    const fx = [
      color, `volume=${gain.toFixed(2)}dB`, 'alimiter=limit=0.89:level=false',
      'afade=t=in:d=0.02', 'areverse,afade=t=in:d=0.04,areverse',
      `apad=pad_dur=${gap}`
    ].filter(Boolean).join(',');
    await ffmpeg(['-i', raw.file, '-af', fx, '-ar', '44100', '-ac', '2', wav]);
    const seconds = await duration(wav);
    parts.push({ wav, start: offset, end: offset + seconds - gap, tone, text: line.text, words: raw.words, cached: raw.cached });
    offset += seconds;
  }
  const voice = path.join(work, `voice-${index}.wav`);
  const inputs = parts.flatMap((p) => ['-i', p.wav]);
  // 이어 붙인 뒤 약한 압축으로 문장들을 한 목소리처럼 묶는다
  await ffmpeg([...inputs, '-filter_complex', `${parts.map((_, i) => `[${i}:a]`).join('')}concat=n=${parts.length}:v=0:a=1,acompressor=threshold=-20dB:ratio=2:attack=15:release=200[a]`, '-map', '[a]', voice]);
  log(`장면 ${index}: 음성 ${parts.map((p) => `${TONES[p.tone].name}${p.cached ? '(재사용)' : ''}`).join(' · ')}`);
  return { voice, parts, seconds: offset + 0.3, words };
}

// ---- 화면: assets/stage.html 무대를 프레임마다 캡처해 ffmpeg로 넘긴다 ----
// 캡컷의 텍스트 애니메이션·키프레임 줌·전환·흔들기·글리치·스티커·자동 자막을 CSS로 그려서 찍는 방식(Remotion과 같은 원리).
const STAGE = pathToFileURL(path.join(HERE, 'assets', 'stage.html')).href;
const EMOJI = (name) => pathToFileURL(path.join(HERE, 'public', 'emoji', `${name}.png`)).href;
const ENTERS = ['slide', 'zoomblur', 'drop', 'glitch', 'flip', 'wipe', 'spin', 'pop'];
// 문장 감정 → 기본 카메라 움직임 (대본의 move로 덮어쓸 수 있다)
const MOVES = { angry: ['punch', 'shake'], emphasis: ['punch'], excited: ['bounce'], whisper: ['zoomout'], normal: [] };
const CONCURRENCY = 3;

function ffmpegPipe(args, log) {
  const child = spawn(ffmpegPath, ['-hide_banner', '-y', ...args], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (c) => { err += c; if (err.length > 20000) err = err.slice(-8000); });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      log(err.split('\n').slice(-8).join('\n'));
      reject(new Error(`ffmpeg 종료 코드 ${code}`));
    });
  });
  const write = (buf) => (child.stdin.write(buf) ? Promise.resolve() : new Promise((ok) => child.stdin.once('drain', ok)));
  return { write, end: () => child.stdin.end(), done };
}

// 한 장면의 무대 데이터: 자막 단어 타이밍·카메라 이벤트·스티커
function sceneData(scene, v, i, ctx) {
  const captions = [];
  const events = [];
  const emojis = [];
  v.parts.forEach((part, k) => {
    const phrases = phrasesOf(part.text);
    for (const c of chunkCaptions(spoken(part.text), part.words, part.end - part.start)) {
      captions.push({
        id: `${k}-${captions.length}`, tone: part.tone, start: part.start + c.start, end: part.start + c.end,
        words: c.units.map((u) => ({ text: u.text, start: part.start + u.start, end: part.start + u.end, em: isEmphasized(u.text, phrases) }))
      });
    }
    const line = scene.lines[k];
    const moves = line.move ? [line.move].flat().filter((m) => m !== 'none') : MOVES[part.tone] || [];
    moves.forEach((type) => events.push({ type, at: part.start, dir: k % 2 ? -1 : 1 }));
    if (part.tone === 'angry') emojis.push({ src: EMOJI('fire'), at: part.start, end: part.end, x: 850, y: 540 });
    if (part.tone === 'excited') emojis.push({ src: EMOJI('sparkles'), at: part.start, end: part.end, x: 40, y: 540 });
  });
  if (captions.length) { captions[0].start = 0; captions.at(-1).end = v.seconds; }
  captions.forEach((c, k) => { if (k < captions.length - 1 && captions[k + 1].start - c.end < 0.3) c.end = captions[k + 1].start; });
  const loud = v.parts.find((p) => p.tone !== 'normal' && p.tone !== 'whisper');
  const media = scene.media ? path.resolve(ctx.dir, scene.media) : null;
  return {
    index: i + 1, seconds: v.seconds, offset: ctx.offsets[i], total: ctx.total, fonts: ctx.fonts,
    title: { lines: ctx.script.title || [], badge: ctx.script.badge || '' },
    kind: media && IMAGE.test(media) ? 'image' : media && VIDEO.test(media) ? 'video' : 'color',
    media: media ? pathToFileURL(media).href : null,
    enter: scene.enter || (i === 0 ? 'pop' : ENTERS[(i - 1) % ENTERS.length]),
    focus: Array.isArray(scene.focus) ? scene.focus : [50, 45],
    events: events.sort((a, b) => a.at - b.at), captions, emojis,
    stamp: scene.stamp ? { text: scene.stamp, at: Math.max(0.3, loud ? loud.start : 0.4) } : null
  };
}

async function renderScene(browser, data, voice, sounds, out, log) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  try {
    await page.goto(STAGE);
    await page.evaluate((d) => window.setup(d), data);
    const cdp = await page.context().newCDPSession(page);
    const T = data.seconds.toFixed(3);
    // 소리: 목소리 + (두 번째 장면부터) 휙 + 스티커 퉁
    const inputs = ['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-i', voice];
    const mixes = [`[1:a]apad=whole_dur=${T}[vo]`];
    const labels = ['[vo]'];
    let n = 2;
    if (data.index > 1) { inputs.push('-i', sounds.whoosh); mixes.push(`[${n}:a]volume=0.55[wh]`); labels.push('[wh]'); n += 1; }
    if (data.stamp) { const ms = Math.round(data.stamp.at * 1000); inputs.push('-i', sounds.pop); mixes.push(`[${n}:a]adelay=${ms}|${ms},volume=0.8[po]`); labels.push('[po]'); n += 1; }
    mixes.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first[aout]`);
    const enc = ffmpegPipe([...inputs, '-filter_complex', mixes.join(';'), '-map', '0:v', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-t', T, out], log);
    const frames = Math.ceil(data.seconds * FPS);
    for (let f = 0; f < frames; f += 1) {
      await page.evaluate((t) => window.renderAt(t), f / FPS);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
      await enc.write(Buffer.from(shot.data, 'base64'));
    }
    enc.end();
    await enc.done;
    return out;
  } finally { await page.close(); }
}

const normalize = (scene) => ({
  ...scene,
  lines: (scene.lines?.length ? scene.lines : [{ text: scene.narration || '', tone: 'normal' }])
    .map((l) => (typeof l === 'string' ? { text: l, tone: 'normal' } : l)).filter((l) => spoken(l.text))
});

export async function renderShort(dir, script, { tts = {}, log = () => {} } = {}) {
  const scenes = (script?.scenes || []).map(normalize).filter((s) => s.lines.length);
  if (!scenes.length) throw new Error('script.json에 읽을 문장이 있는 장면이 없습니다');
  const work = path.join(dir, 'build');
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const sounds = await sfx();

  // 1) 음성 먼저: 전체 길이를 알아야 진행 막대를 그린다
  const voices = [];
  for (const [i, scene] of scenes.entries()) voices.push(await buildVoice(scene, i + 1, work, path.join(dir, 'voice-cache'), { ...tts, log }, log));
  const offsets = voices.reduce((acc, v, i) => [...acc, i ? acc[i - 1] + voices[i - 1].seconds : 0], []);
  const total = voices.reduce((s, v) => s + v.seconds, 0);
  const face = FONT_CHOICES[script.font] || FONT_CHOICES.blackhan;
  const ctx = { dir, script, offsets, total, fonts: { T: pathToFileURL(path.join(FONTS, face.file)).href, B: pathToFileURL(path.join(FONTS, 'Pretendard-ExtraBold.otf')).href } };

  // 2) 장면을 몇 개씩 동시에 찍는다
  const browser = await chromium.launch({ executablePath: tts.chromePath, headless: true, args: ['--allow-file-access-from-files'] });
  const clips = new Array(scenes.length);
  try {
    let next = 0;
    const worker = async () => {
      while (next < scenes.length) {
        const i = next++;
        const data = sceneData(scenes[i], voices[i], i, ctx);
        const t0 = Date.now();
        clips[i] = await renderScene(browser, data, voices[i].voice, sounds, path.join(work, `scene-${String(i + 1).padStart(2, '0')}.mp4`), log);
        log(`장면 ${i + 1}/${scenes.length}: ${data.seconds.toFixed(1)}초 · 등장 ${data.enter}${data.stamp ? ' · 스티커' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)}초 걸림`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scenes.length) }, worker));
  } finally { await browser.close(); }

  const list = path.join(work, 'concat.txt');
  await fs.writeFile(list, clips.map((c) => `file '${c.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(dir, 'short.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], log);
  log(`완성: ${out} (${(await duration(out)).toFixed(1)}초)`);
  return out;
}
