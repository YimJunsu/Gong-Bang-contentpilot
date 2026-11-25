// 클립 숏폼: 인물·화제 → 유튜브 원본 영상 찾기(yt-dlp) → 장면 모음 그림 → AI가 구간·자막 결정 → 원본 소리 그대로 세로 영상.
// 설계: docs/클립-숏폼-설계.md. 저작권 기본값(가): 자동 찾기는 인증(공식) 채널만, 사람이 넣은 주소는 그대로 쓴다. 출처는 영상·설명에 자동으로 붙인다.
//
// script.json (layout: "clip"):
// { layout:"clip", mute?, title:["흰 줄","*강조* 줄"], sources:[{n,url,title,channel,file}],
//   scenes:[{ src:1, start:12.5, end:17, focus:[50,40], caption:"큰 자막", sub:"작은 자막" }],
//   description, hashtags:[], sound, uploaded?:{url,at} }
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { ffmpeg, duration, FONT_CHOICES, buildVoice, chunkCaptions, markEmphasis, spoken } from './video.mjs';
import { clipStyleOf, KIND_DEFAULTS } from './title-styles.mjs';
import { UPLOAD_RULE } from './shorts-kinds.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(HERE, 'assets', 'fonts');
const W = 1080, H = 1920, TOP = 440, VH = H - TOP, FPS = 30;
const MAX_SOURCE_SEC = 15 * 60;
export const youtubeUrl = (s) => /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/)|youtu\.be\/)\S+$/i.test(String(s || '').trim());

// ---- yt-dlp ----
// winget으로 막 설치하면 이미 켜진 서버의 PATH에는 없다 → winget 설치 위치를 직접 찾아본다
let ytdlpFound;
function ytdlpBin(config) {
  if (config.ytdlpPath) return config.ytdlpPath;
  if (ytdlpFound) return ytdlpFound;
  const local = process.env.LOCALAPPDATA || '';
  const cands = [path.join(local, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe')];
  try {
    const pk = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    for (const d of readdirSync(pk)) if (/^yt-dlp\.yt-dlp/i.test(d)) cands.push(path.join(pk, d, 'yt-dlp.exe'));
  } catch {}
  ytdlpFound = cands.find((f) => existsSync(f));
  return ytdlpFound || 'yt-dlp';
}
function ytdlp(config, args, log = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpBin(config), ['--encoding', 'utf-8', '--no-warnings', ...args], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '', err = '';
    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.stderr.on('data', (c) => { err += c.toString('utf8'); });
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('yt-dlp가 없습니다. 명령 프롬프트에서 `winget install yt-dlp` 후 다시 시도하세요') : e));
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      log(err.trim().split('\n').slice(-5).join('\n'));
      reject(new Error(`yt-dlp 실패: ${err.trim().split('\n').pop() || code}`));
    });
  });
}
const pickInfo = (d) => ({
  id: d.id, url: d.webpage_url || `https://www.youtube.com/watch?v=${d.id}`, title: d.title || '', channel: d.channel || d.uploader || '',
  verified: Boolean(d.channel_is_verified), duration: Math.round(d.duration || 0), views: d.view_count || 0
});
export async function searchVideos(config, query, n = 20) {
  const data = JSON.parse(await ytdlp(config, [`ytsearch${n}:${query}`, '--flat-playlist', '-J']));
  return (data.entries || []).filter((e) => e?.id && e.duration && e.duration <= MAX_SOURCE_SEC).map(pickInfo);
}
// 유튜브 검색 결과 주소(예: 이번 주 업로드 거르기)를 그대로 읽는다
export async function searchUrl(config, url, n = 30) {
  const data = JSON.parse(await ytdlp(config, [url, '--flat-playlist', '-J', '--playlist-end', String(n)]));
  return (data.entries || []).filter((e) => e?.id && e.duration && e.duration <= MAX_SOURCE_SEC).map(pickInfo);
}
// 영상 하나의 정보 + 많이 다시 본 구간(있을 때만, 값 큰 순 5개)
export async function videoInfo(config, url) {
  const d = JSON.parse(await ytdlp(config, [url, '-J', '--skip-download', '--no-playlist']));
  if ((d.duration || 0) > MAX_SOURCE_SEC) throw new Error(`영상이 너무 깁니다(15분까지): ${d.title}`);
  const hot = (d.heatmap || []).slice().sort((a, b) => b.value - a.value).slice(0, 5).map((h) => [Math.round(h.start_time), Math.round(h.end_time)]);
  return { ...pickInfo(d), hot };
}
// 1080p 이하, 가능하면 H.264(브라우저·ffmpeg 어디서나 열린다)
// 유튜브가 요청이 몰리면 잠깐 403·429로 막는다(2026-11-22: 영상은 받고 소리에서 403) → 쉬었다가 이어 받기(2번까지)
export async function download(config, url, outBase, log, waits = [20000, 60000]) {
  for (let k = 0; ; k += 1) {
    try {
      await ytdlp(config, [url, '--no-playlist', '-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
        '--merge-output-format', 'mp4', '--ffmpeg-location', ffmpegPath, '-o', `${outBase}.%(ext)s`], log);
      return `${outBase}.mp4`;
    } catch (e) {
      if (k >= waits.length || !/\b(403|429)\b/.test(e.message)) throw e;
      log(`유튜브가 잠시 막음(${e.message.match(/\b(403|429)\b/)[1]}) — ${waits[k] / 1000}초 뒤 이어 받기`);
      await new Promise((r) => setTimeout(r, waits[k]));
    }
  }
}

// mp3·mp4 추출기: 영상 하나를 그대로 받아 dir에 '영상 제목.mp3|mp4'로 저장하고 그 파일 경로를 돌려준다.
// mp4는 휴대폰에서도 열리게 H.264 + AAC(1080p 이하)를 먼저 고른다. 재생목록 주소여도 그 영상 하나만
export const EXTRACT_FORMATS = ['mp3', 'mp4'];
export function extractArgs(url, format, dir) {
  const pick = format === 'mp3'
    ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0']
    : ['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4', '--remux-video', 'mp4'];
  return [url, '--no-playlist', ...pick, '--ffmpeg-location', ffmpegPath, '--windows-filenames',
    '--no-simulate', '--print', 'after_move:filepath', '-o', path.join(dir, '%(title).80B.%(ext)s')];
}
export async function extract(config, url, format, dir, log) {
  if (!youtubeUrl(url)) throw new Error('유튜브 주소가 아닙니다');
  if (!EXTRACT_FORMATS.includes(format)) throw new Error('mp3 또는 mp4만 고를 수 있습니다');
  const out = await ytdlp(config, extractArgs(url.trim(), format, dir), log);
  const file = out.trim().split(/\r?\n/).pop();
  if (!file || !existsSync(file)) throw new Error('받은 파일을 찾지 못했습니다');
  return file;
}

// 영어 대사(자막 파일만 받는다, 영상 아님): 올린 사람 자막 → 없으면 유튜브 자동 자막. [{start,end,text}] (원본 초)
// 한글 번역 자막을 만들 때 AI에게 넘긴다. 없으면 빈 배열(말 없는 영상이거나 자막이 꺼진 영상)
export async function transcript(config, url, outBase, log = () => {}) {
  const dir = path.dirname(outBase), base = path.basename(outBase);
  await ytdlp(config, [url, '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'en,en-US,en-GB,en-orig', '--sub-format', 'json3', '-o', `${outBase}.%(ext)s`], log).catch((e) => log(`영어 자막 없음: ${e.message}`));
  const files = (await fs.readdir(dir).catch(() => [])).filter((n) => n.startsWith(`${base}.`) && n.endsWith('.json3'));
  const pick = files.find((n) => /\.en(-US|-GB)?\.json3$/.test(n)) || files[0];
  return pick ? parseJson3(await fs.readFile(path.join(dir, pick), 'utf8')) : [];
}
// json3: events[{tStartMs, dDurationMs, segs[{utf8}]}]. 자동 자막은 줄이 겹쳐 나오므로 같은 글은 합치고 줄바꿈만 있는 것은 뺀다
export function parseJson3(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^﻿/, '')); } catch { return []; }
  const out = [];
  for (const e of data.events || []) {
    const t = (e.segs || []).map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!t || /^\[[^\]]*\]$/.test(t)) continue; // [Music]·[Applause] 같은 표시는 뺀다
    const start = (e.tStartMs || 0) / 1000, end = start + (e.dDurationMs || 1500) / 1000;
    const last = out[out.length - 1];
    if (last && last.text === t) { last.end = Math.max(last.end, end); continue; }
    if (last && last.end > start) last.end = start; // 겹치면 앞 줄을 다음 줄 시작에서 끊는다
    out.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, text: t });
  }
  return out.filter((c) => c.end > c.start);
}
// 프롬프트용: "[12.3-14.8] text" 줄, 너무 길면 앞에서부터 자른다
export const transcriptText = (cues, max = 16000) => {
  let s = '';
  for (const c of cues) { const line = `[${c.start}-${c.end}] ${c.text}\n`; if (s.length + line.length > max) break; s += line; }
  return s.trim();
};

// 장면 모음 그림: 2초마다 한 칸, 칸 왼쪽 위에 '12s'처럼 원본 시각. 5×6칸(1분)씩 여러 장
export async function contactSheets(file, outPrefix, every = 2) {
  file = path.resolve(file); outPrefix = path.resolve(outPrefix); // ffmpeg는 글꼴을 찾으려고 글꼴 폴더에서 돈다
  const vf = [`fps=1/${every}`, "scale='if(gt(iw,ih),360,-2)':'if(gt(iw,ih),-2,360)'",
    "drawtext=fontfile=Pretendard-ExtraBold.otf:text='%{eif\\:t\\:d}s':x=6:y=6:fontsize=30:fontcolor=yellow:box=1:boxcolor=black@0.7:boxborderw=4", 'tile=5x6'].join(',');
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-y', '-i', file, '-vf', vf, '-q:v', '4', `${outPrefix}-%02d.jpg`], { cwd: FONTS, windowsHide: true });
    let err = ''; child.stderr.on('data', (c) => { err += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`장면 모음 그림 실패: ${err.split('\n').slice(-3).join(' ')}`))));
  });
  const dir = path.dirname(outPrefix), base = path.basename(outPrefix);
  return (await fs.readdir(dir)).filter((n) => n.startsWith(`${base}-`) && n.endsWith('.jpg')).sort().map((n) => path.join(dir, n));
}

// ---- AI 프롬프트 ----
const RULES = [
  '- 사생활·루머·열애설·사건사고, 외모 비하, 몸매·노출을 부각하는 성적 표현은 쓰지 않는다. 무대·표정·반응·성장·에피소드 같은 긍정적 관점으로 쓴다.',
  '- 영상에 보이는 것과 영상 제목에 있는 사실만 쓴다. 조회수·순위·나이·관계 같은 사실을 지어내지 않는다.'
].join('\n');
// ② 해외 재밌는 영상: 원작자 채널만(설계 docs/숏폼-통합-설계.md). 모음·재업로드·리액션·번역 채널로 보이는 후보는 검색 단계에서 뺀다
export const COMPILATION = /compilation|compil|모음|best of|top ?\d+|try not to laugh|funniest|funny moments|fails? (of|compilation)|reaction|리액션|react(s|ing)? to|tik ?tok|틱톡|reels|번역|자막|재업|weekly|daily dose|memes?/i;
// 채널 이름이 웃음·짤 모음 계정처럼 생겼으면 원작자가 아니다(2026-11-22 'Mzansi Laughter' 9분 모음 영상이 걸림)
export const AGGREGATOR = /laugh|lol|funny|fails|viral|memes?|clips|hub|vines|humou?r|giggle|lmao|rofl|짤|웃긴|유머/i;
// 원작자의 웃긴 영상은 대개 짧다. 5분 넘으면 모음·라이브·방송분으로 본다
export const VIRAL_MAX_SEC = 5 * 60;
export const notCompilation = (v) => !COMPILATION.test(`${v.title} ${v.channel}`) && !AGGREGATOR.test(String(v.channel || '')) && !((v.duration || 0) > VIRAL_MAX_SEC);

export function pickPrompt({ topic, notes = '', kind = 'celeb' }, found) {
  if (kind === 'viral') return [
    `유튜브 쇼츠용 '해외 재밌는 영상' 클립의 원본을 고른다. 분야·키워드: ${topic}`,
    notes ? `메모: ${notes}` : '',
    '원작자 채널 영상만 고른다: 그 장면을 직접 찍었거나 만든 사람·팀·방송사·공연 주최 측이 올린 영상. 여러 영상을 모은 채널, 재업로드·번역·리액션·밈 채널로 보이면 고르지 않는다(제목·채널명으로 판단).',
    '한 장면이 확실히 웃기거나 놀랍거나 뭉클한 영상 1개(많아야 2개)를 고른다. 화질이 좋고, 말이 아니라 화면만 봐도 상황이 이해되는 것을 우선한다. 맞는 게 없으면 picks를 빈 배열로.',
    '파일은 만들지 말고 JSON만 출력한다: {"picks":[{"id":"영상 id","why":"한 줄 이유(원작자로 본 근거 포함)"}]}',
    '후보:',
    ...found.map((v) => `- id=${v.id} | ${v.channel}${v.verified ? ' (인증)' : ''} | ${v.duration}초 | 조회 ${v.views} | ${v.title}`)
  ].filter(Boolean).join('\n');
  return [
    `유튜브 쇼츠용 클립 영상의 원본을 고른다. 인물·화제: ${topic}`,
    notes ? `메모: ${notes}` : '',
    '아래 후보로 쇼츠 이야기 하나를 만든다(2026-11-22 레퍼런스 분석). 인물·그룹 화제면 이야기가 되는 영상 2~3개: 예전 인터뷰·예능에서의 모습이나 약속 → 지금 무대·시상식·예능 → 그 반응처럼 순서가 이어지게. 영상 하나로 충분하면 1개도 된다.',
    '화제가 한 인물이 아니라 주제 모음(예: "관객 난입 레전드", "무대 실수 레전드")이면 서로 다른 인물·장면 영상 3~5개(TOP N 모음). 이미 여러 장면을 모아 둔 영상(제목에 모음·특집·레전드 모음, 화면에 자막이 잔뜩)은 고르지 않고 한 장면짜리 원본을 고른다.',
    '공식 채널(방송사·소속사·음악 채널·예능 채널)을 우선하고, 같은 무대가 여럿이면 화질 좋은 것 하나만.',
    '메모에 "요즘 뜨는 이유"가 있으면 그 화제와 바로 이어지는 최신 영상(예능 출연분·인터뷰·무대·티저)을 우선한다. 무대만 고집하지 않는다. 반응이 터지는 장면(웃음·반전·케미·돌발 행동)이 있을 법한 영상이 좋다.',
    '파일은 만들지 말고 JSON만 출력한다: {"picks":[{"id":"영상 id","why":"한 줄 이유"}]}',
    '후보:',
    ...found.map((v) => `- id=${v.id} | ${v.channel} | ${v.duration}초 | 조회 ${v.views} | ${v.title}`)
  ].filter(Boolean).join('\n');
}
// ② 해설 형식(2026-11-22 레퍼런스 분석 docs/숏폼-레퍼런스-분석.md): 한국어 목소리 해설이 영상을 끌고 가고, 결정적 순간만 원본 소리
export const NARR_CPS = 6.5; // 해설 읽는 속도(글자/초, 빈칸 뺀 글자) — 구간 길이에 맞출 때 쓴다
const NARRATION_RULES = (seconds, hasTalk) => [
  `- 구간 2~5개, 하나에 3~20초, 합쳐서 ${seconds[0]}~${seconds[1]}초. 원본 길이 안에서. 한 영상 안의 이야기 흐름(상황 → 기대 → 결정적 순간 → 반응)대로.`,
  '- 장면마다 "say": 그 구간 동안 나오는 한국어 해설(목소리로 읽고 자막으로도 나온다). 다큐 해설 말투: "~인데요", "~죠", "~습니다", "~됩니다"를 섞는다. 반말·ㅋㅋ·감탄사 남발 금지.',
  `- say 길이: 그 구간 길이(초) × ${NARR_CPS}글자(빈칸 빼고) 이하. 넘치면 구간을 늘리거나 문장을 줄인다. 한 문장 30자 이내로 짧게 끊는다.`,
  '- 첫 장면 say 첫 문장은 영상에서 가장 신기한 사실을 바로 던진다(배경 설명보다 그림 먼저). 예: "1미터가 넘는 팬에 고기가 끝도 없이 올라갑니다.", "현장에 신입이 두 명 들어왔는데 똑같은 일을 시켜도 이렇게 다릅니다."',
  '- 결정적 순간(웃음·반전·놀라움이 터지는 바로 그 구간)은 say를 빈 문자열로 둬서 원본 소리를 살린다. 그 앞 장면 say는 "그리고 잠시 후", "그런데", "알고 보니", "반면 둘째는" 같은 말로 끝을 열어 둔다(결과를 미리 말하지 않는다).',
  '- 마지막 장면은 짧은 마무리 해설 한 문장 또는 빈 문자열(반응·여운).',
  '- say 안 *별표*는 문장마다 많아야 1곳(자막에서 노랑). 숫자는 "11명", "3초"처럼 아라비아 숫자 + 단위, 영어 약어·기호(m, %, & 등)는 한글로("미터", "퍼센트").',
  '- 보이는 것과 영상 제목·대사에 있는 것만 말한다. 사람 이름·나이·장소·숫자를 지어내지 않는다(모르면 "한 남성", "이 소년").',
  hasTalk
    ? '- say가 빈 구간에 영어 대사가 있으면 "subs"에 한글 번역 자막을 대사 타이밍 그대로: [{"at":원본 시작초,"end":원본 끝초,"text":"번역"}] (22자 이내, 구간 안만, 뜻만 자연스러운 구어로). say가 있는 구간은 subs를 비운다.'
    : '- "subs"는 빈 배열.',
  '- 제목 두 줄은 영상 내내 위에 고정. 담백한 소개형, 각 15자 이내: [누가 놀랐나·어떤 평가] + [누구의 무엇]. 예: ["현장 고인물 감탄시킨","신입 막내의 일머리"], ["마이클 잭슨의","환생 같다는 소년의 무대"], ["초자연적인 현상을","눈앞에서 목격한 서퍼들"]. 결과는 다 말하지 않는다. 반말·ㅋㅋ·물음표 낚시 금지. 첫 줄은 노랑, 둘째 줄은 흰색으로 나오고 *별표* 1곳은 노랑 강조.',
  '- caption·sub·pops·stamp는 쓰지 않는다(빈 값).'
].join('\n');
export function scriptPrompt({ topic, notes = '', mute = false, seconds = [15, 40], kind = 'celeb', narrate = kind === 'viral' }, sources) {
  const viral = kind === 'viral';
  const hasTalk = sources.some((s) => s.transcript?.length);
  if (viral && narrate) return [
    '세로(9:16) 유튜브 쇼츠를 만든다. 아래 해외 원본 영상에서 구간을 골라 이어 붙이고, 한국어 해설 목소리·자막을 얹어 한국 시청자에게 소개한다. 결과는 이 폴더의 script.json 하나다.',
    `분야·키워드: ${topic}`,
    notes ? `메모(따른다): ${notes}` : '',
    '',
    '원본 영상 (장면 모음 그림을 직접 열어 본다. 칸마다 왼쪽 위 노란 글자가 원본 시각(초)이고, 한 칸 = 2초):',
    ...sources.map((s) => [
      `[${s.n}] ${s.title} | ${s.channel} | ${s.duration}초`,
      ...s.sheets.map((f) => `  그림: ${f}`),
      s.hot?.length ? `  많이 다시 본 구간(초): ${s.hot.map(([a, b]) => `${a}-${b}`).join(', ')}` : '',
      s.transcript?.length ? `  영어 대사([원본 시작초-끝초] 문장, 자동 자막이라 틀릴 수 있다):\n${transcriptText(s.transcript).replace(/^/gm, '    ')}` : ''
    ].filter(Boolean).join('\n')),
    '',
    'script.json 형식:',
    '{"title":["첫 줄","둘째 줄"],"scenes":[{"src":1,"start":12,"end":17.5,"focus":[50,40],"cover":[],"say":"해설 또는 빈 문자열","subs":[]}],"textZone":"none","description":"업로드 설명 2~3줄(출처는 자동으로 붙으니 쓰지 않는다)","hashtags":["#태그"],"sound":"깔릴 배경 음악 분위기 한 줄"}',
    NARRATION_RULES(seconds, hasTalk),
    '- focus: 세로로 자를 때 중심 [가로%, 세로%]. 영상 칸은 거의 정사각형(가로 1080 × 세로 1200)이다. 기본 [50,45].',
    '- "cover" (장면마다): 원본 화면에 이미 박혀 있는 자막·방송 글자·다른 채널 워터마크를 모자이크로 가린다. 장면 모음 그림에서 그 구간 동안 글자가 있는 자리를 원본 화면 % 상자로: [[x,y,w,h]] (왼쪽 위 기준, 예: 아래 자막 띠 [[5,78,90,18]]). 넉넉하게 잡고, 사람 얼굴·몸은 덮지 않는다. 점수판처럼 꼭 필요한 정보, 원작자 로고는 가리지 않는다. 글자가 없으면 [].',
    '- "textZone": 쓰는 구간의 원본 화면에 이미 박혀 있는 자막·글자가 주로 어디 있는지 "bottom"·"top"·"none". 우리 자막이 피해 간다.',
    '- 다른 사람 영상을 모아 올린 채널(모음·짤 계정, 화면에 다른 채널 워터마크가 있음)로 보이면 그 원본은 쓰지 않는다.',
    RULES,
    UPLOAD_RULE,
    '- 질문하지 말고 끝까지 진행한다. 이 폴더 밖 파일을 수정하지 않는다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter((l) => l !== '').join('\n');
  if (!viral) return celebPrompt({ topic, notes, mute, seconds }, sources);
  return [
    '세로(9:16) 유튜브 쇼츠를 만든다. 아래 원본 영상에서 구간을 골라 이어 붙이고, 위에 훅 제목·아래에 자막을 얹는다. 결과는 이 폴더의 script.json 하나다.',
    viral ? `분야·키워드: ${topic} (해외 재밌는 영상 — 한국 시청자에게 소개한다)` : `인물·화제: ${topic}`,
    notes ? `메모(따른다): ${notes}` : '',
    '',
    '원본 영상 (장면 모음 그림을 직접 열어 본다. 칸마다 왼쪽 위 노란 글자가 원본 시각(초)이고, 한 칸 = 2초):',
    ...sources.map((s) => [
      `[${s.n}] ${s.title} | ${s.channel} | ${s.duration}초`,
      ...s.sheets.map((f) => `  그림: ${f}`),
      s.hot?.length ? `  많이 다시 본 구간(초): ${s.hot.map(([a, b]) => `${a}-${b}`).join(', ')}` : '',
      s.transcript?.length ? `  영어 대사([원본 시작초-끝초] 문장, 자동 자막이라 틀릴 수 있다):\n${transcriptText(s.transcript).replace(/^/gm, '    ')}` : ''
    ].filter(Boolean).join('\n')),
    '',
    'script.json 형식:',
    '{"title":["윗줄(14자 이내)","아랫줄(14자 이내, *강조* 1곳)"],"scenes":[{"src":1,"start":12,"end":17.5,"focus":[50,40],"caption":"큰 자막(16자 이내)","sub":"작은 자막(22자 이내) 또는 빈 문자열"}],"description":"업로드 설명 2~3줄(출처는 자동으로 붙으니 쓰지 않는다)","hashtags":["#태그"],"sound":"어울리는 음악 분위기 한 줄"}',
    viral
      ? `- 구간 1~4개, 하나에 3~20초, 합쳐서 ${seconds[0]}~${seconds[1]}초. 원본 길이 안에서. 웃기거나 놀라운 순간 하나를 앞뒤 맥락과 함께 보여 준다(기다림 → 터지는 순간 → 반응). 원본의 자막·워터마크는 그대로 둔다.`
      : `- 구간 3~6개, 하나에 3~8초, 합쳐서 ${seconds[0]}~${seconds[1]}초. 원본 길이 안에서. 인물이 화면에 크게, 표정·동작이 살아 있는 구간을 고른다(장면 전환·자막·광고 화면 피함).`,
    viral
      ? '- 제목 두 줄은 영상 내내 위에 고정되는 훅. 첫째 줄(작게)은 기대를 까는 상황("드럼 배틀 끝난 줄 알았는데", "내향인이라면 제일 피하고 싶은"), 둘째 줄(크게)은 커뮤니티 말투로 터뜨린다: ~함/~임/~됨/~각/~ㄷㄷ 끝맺음, 12자 안팎("밴드 통째로 난입함", "보험사 기절각", "이건 반칙이지"). 결과를 다 말하지 말고 "뭔데?" 궁금하게. 설명문·존댓말·"~하는 순간" 같은 밋밋한 말 금지. "*별표*"는 한 곳만 강조.'
      : '- 첫 구간이 가장 강한 장면(훅). 일반 시청자가 "이 사람 요즘 왜 뜨지?" 하고 멈춰 보게 만든다: 웃음·반전·케미·돌발 행동·말실수 같은 반응 터지는 순간을 고르고, 그냥 서 있거나 노래만 하는 밋밋한 구간은 피한다. 메모의 "요즘 뜨는 이유"를 제목에 살린다(목록에 없는 사실·의혹은 단정하지 않는다). 제목 두 줄은 영상 내내 위에 고정되는 훅, 커뮤니티 제목 말투: 첫째 줄은 궁금증·배경("이 얼굴로 별명이", "3년 만에 디즈니에서 다시 부른", "긴 생머리 vs 중단발 뭐가 답?"), 둘째 줄은 반전·결론 + 인물 이름("수원왕발가락인 *리브*..", "결론은 뭐든 됨 *카리나*"). 인물 이름(그룹·멤버)은 *별표*로 감싸고(응원봉 색 테두리), 끝은 ".." 또는 "?"로 여운. 각 줄 18자 이내.',
    viral
      ? '- "stamp": 제목 옆에 찍히는 원 도장 문구 2~3자("실화", "레전드", "반전", "역대급", "킹받음"). 영상 내용에 맞게, 낚시 금지.'
      : '- "accent": 이름 테두리(응원봉) 색. 밝고 귀엽거나 상큼한 분위기면 "coral", 몽환·시크·카리스마 분위기면 "purple".',
    '- focus: 세로로 자를 때 중심 [가로%, 세로%]. 원본에서 인물 얼굴·몸 중심 위치. 기본 [50,40].',
    '- "textZone": 장면 모음 그림을 보고, 쓰는 구간의 원본 화면에 이미 박혀 있는 자막·글자·워터마크가 주로 어디 있는지 "bottom"·"top"·"none" 중 하나. 우리 자막이 그 자리를 피해 간다. 원본 글자가 화면 대부분을 덮는 구간은 고르지 않는다.',
    viral ? '- 다른 사람 영상을 모아 올린 채널(모음·짤 계정, 화면에 다른 채널 워터마크가 있음)로 보이면 그 원본은 쓰지 않는다.' : '',
    viral ? '- 한국 시청자는 영어를 못 알아듣는다고 본다. 제목 첫 줄은 무슨 상황인지(누가·어디서·뭘 하는지) 알려 주고, 말을 알아야만 웃긴 장면이면 반드시 번역 자막(subs)을 단다.' : '',
    viral && hasTalk
      ? '- 장면에 영어 대사가 있으면 "subs"에 한글 번역 자막을 대사 타이밍 그대로 단다: [{"at":원본 시작초,"end":원본 끝초,"text":"번역"}]. 위 영어 대사 시각을 따르고 구간(start~end) 안만. 직역 말고 자연스러운 한국어 구어(존댓말·반말은 말하는 사람 분위기대로), 한 자막 22자 이내(길면 두 줄은 | 로 나눔), 자막 사이 빈틈 없이 말하는 동안 계속. 고유명사는 그대로 또는 한글 표기. 번역은 대사에 있는 뜻만(지어내지 않음). 이 자막은 흰 글씨로 깔끔하게 나온다.'
      : viral ? '- 대사가 거의 없는 영상이면 "subs"는 빈 배열.' : '',
    viral
      ? '- 반응 말풍선은 "pops"로 터지는 순간에만: [{"at":원본초,"text":"오 지린다;"}] 장면마다 0~2개, 영상 전체 2~4개, 한 번 1.8초 정도 뜬다. 웃음·반전·놀라는 바로 그 순간 시각으로. caption은 빈 문자열로 둔다.'
      : '',
    viral
      ? '- pops 글은 옆에서 같이 보는 친구의 반응(말풍선): 반말, 짧게(12자 안팎), 감탄·드립 위주. 예: "오 지린다;", "아니 표정 봐ㅋㅋㅋ", "이게 생방이라고?", "ㄹㅇ 미쳤네", "형님 여기서 왜 웃음", "잠깐만 다시 봐". ㅋㅋ·;·?! 허용. 외국어 대사는 이 말투로 핵심만 옮긴다("이거 말고 없냐고ㅋㅋ"). 장면 해설("무대가 다시 분주해져요")·존댓말·뉴스 말투 금지. *별표* 1곳은 분홍 강조. sub는 대부분 빈 문자열, 꼭 필요할 때만 짧은 상황 보충. 욕설·외모 비하·성적 표현 금지. 원본이 누구 것인지 지어내지 않는다.'
      : '- caption은 같이 보는 사람 반응 댓글 같은 한 줄(장면이 왜 웃긴지·왜 화제인지 짚기. 예: "이 직캠 댓글 1위", "크리스마스 공주들 그 자체", "워너원 때 춤선부터"), sub는 그 아래 작은 보충(그 댓글 내용·포인트, 선택). 반말·팬 말투, 짧게. 외모 품평·성적 표현 금지.',
    mute ? '- 원본 소리는 끄고 업로드 때 음악을 고른다. sound에 어울리는 음악 분위기를 쓴다.' : '- 원본 소리를 그대로 쓴다. sound에는 원본 소리를 끌 때 쓸 음악 분위기를 쓴다.',
    RULES,
    UPLOAD_RULE,
    '- 질문하지 말고 끝까지 진행한다. 이 폴더 밖 파일을 수정하지 않는다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter((l) => l !== '').join('\n');
}
// ① 연예인 이슈 형식(2026-11-22 레퍼런스 '원데이슈'·'담장너'·'리센느 로그'): 원본 2~3개를 이야기 순서로, 설명 자막 + 팬 반응 상자 두 가지, 출처 줄.
// 주제 모음이면 TOP N(장면마다 인물 이름 + 한 줄 평)
function celebPrompt({ topic, notes = '', mute = false, seconds = [15, 40] }, sources) {
  return [
    '세로(9:16) 유튜브 쇼츠를 만든다. 아래 원본 영상에서 구간을 골라 이야기 순서로 이어 붙이고, 위에 제목·영상 위에 자막을 얹는다. 결과는 이 폴더의 script.json 하나다.',
    `인물·화제: ${topic}`,
    notes ? `메모(따른다): ${notes}` : '',
    '',
    '원본 영상 (장면 모음 그림을 직접 열어 본다. 칸마다 왼쪽 위 노란 글자가 원본 시각(초)이고, 한 칸 = 2초):',
    ...sources.map((s) => [`[${s.n}] ${s.title} | ${s.channel} | ${s.duration}초`, ...s.sheets.map((f) => `  그림: ${f}`),
      s.hot?.length ? `  많이 다시 본 구간(초): ${s.hot.map(([a, b]) => `${a}-${b}`).join(', ')}` : ''].filter(Boolean).join('\n')),
    '',
    'script.json 형식:',
    '{"format":"story","title":["첫 줄","둘째 줄"],"scenes":[{"src":1,"start":12,"end":17.5,"focus":[50,40],"cover":[],"from":"인기가요","caption":"설명 자막","react":"팬 반응 또는 빈 문자열","label":""}],"textZone":"none","description":"업로드 설명 2~3줄(출처는 자동으로 붙으니 쓰지 않는다)","hashtags":["#태그"],"sound":"원본 소리를 끌 때 쓸 음악 분위기 한 줄"}',
    '- "format": 한 인물·그룹 이야기면 "story", 여러 인물의 같은 주제 모음이면 "top".',
    `- story: 구간 3~7개, 하나에 3~10초, 합쳐서 ${seconds[0]}~${seconds[1]}초. 원본이 여럿이면 이야기 순서(예전 모습·약속 → 지금 → 감정·반응)로 섞는다. 첫 구간은 가장 센 장면(웃음·반전·눈물·돌발 행동)으로 시작해 멈춰 보게 하고, 그다음 배경을 깐다.`,
    `- top: 원본마다 장면 1개(TOP 순서대로, 마지막이 제일 센 것), 하나에 5~12초, 합쳐서 ${seconds[0]}~${Math.max(seconds[1], 50)}초. label = 그 장면 인물·그룹 이름(10자 이내), caption = 그 장면 한 줄 평(노랑, 팬 말투, 24자 이내, 예: "멀리서 지켜보다 끌려가서 귀엽단 반응ㅋㅋ"). react는 비운다.`,
    '- caption(story) = 설명 자막: 장면을 이어 주는 상황 설명, ~함/~됨/~음 끝맺음, 26자 이내, 두 줄이면 | 로 나눔. 예: "5년 안에 서겠다던 MAMA를|1년도 안 돼서 서게 됨", "업로드 당시 26년 5월|큰 무대에서 만나자 약속했던 두 사람". 예능·인터뷰에서 말하는 장면이면 그 말을 받아 적는다(들리는 뜻 그대로 짧게, 지어내지 않음). 핵심어 1곳은 *별표*(노랑).',
    '- react = 팬 반응: 같이 보는 팬의 혼잣말 같은 한 줄(20자 이내). 장면마다 0~1개, 영상 전체 2~4개만, 반응이 터지는 장면에. 예: "와... 노래 진짜 높다...", "미나미 없으면 안 될 듯ㅋ", "아 진짜 또 그럴 줄 알았다". 반말·ㅋㅋ·... 허용. 닉네임·좋아요 수처럼 실제 누가 단 댓글로 보이게 쓰지 않는다.',
    '- from: 그 장면 원본의 프로그램·행사 이름(영상 제목에서. 예: "인기가요", "MAMA", "아는 형님", "공식 인터뷰"). 모르면 채널 이름. 화면에 "출처: …"로 작게 나온다.',
    '- 제목 두 줄은 영상 내내 위에 고정, 결말을 다 말하지 않는 궁금증 + 감정. 첫 줄은 배경, 둘째 줄은 핵심 + 인물 이름. 예: ["기다리던 MAMA에서","결국 눈물보인 *리센느*"], ["미나미 없는","*리센느* 앵콜 라이브"], ["*리브* 또","그럴 줄 알았다ㅋㅋ"], ["빠른년생 문화가","없어져야 하는 이유"], top이면 ["보기만 해도 아찔한","*관객 난입* 레전드"]. 메모의 "요즘 뜨는 이유"를 살리되 목록에 없는 사실·의혹은 단정하지 않는다. 인물 이름(story)·주제어(top)는 *별표*로(빨강 강조). 첫 줄은 검정, 둘째 줄은 빨강으로 나온다. 각 줄 15자 이내.',
    '- focus: 영상 칸(가로 1080 × 세로 1200, 거의 정사각형)으로 자를 때 중심 [가로%, 세로%]. 인물 얼굴·몸 중심. 기본 [50,40].',
    '- "cover" (장면마다): 원본 화면에 이미 박혀 있는 자막·방송 글자·다른 채널 워터마크를 모자이크로 가린다. 장면 모음 그림에서 그 구간 동안 글자가 있는 자리를 원본 화면 % 상자로: [[x,y,w,h]] (왼쪽 위 기준, 예: 아래 자막 띠 [[5,78,90,18]]). 넉넉하게 잡고, 사람 얼굴·몸은 덮지 않는다. 점수판처럼 꼭 필요한 정보, 원작자 로고는 가리지 않는다. 글자가 없으면 [].',
    '- "textZone": 쓰는 구간의 원본 화면에 이미 박혀 있는 자막·글자가 주로 어디 있는지 "bottom"·"top"·"none". 우리 자막이 피해 간다. 원본 글자가 화면 대부분을 덮는 구간은 고르지 않는다.',
    '- 인물이 화면에 크게, 표정·동작이 살아 있는 구간을 고른다(장면 전환·광고 화면 피함).',
    mute ? '- 원본 소리는 끄고 업로드 때 음악을 고른다.' : '- 원본 소리를 그대로 쓴다(라이브·예능 대사가 핵심).',
    RULES,
    UPLOAD_RULE,
    '- 질문하지 말고 끝까지 진행한다. 이 폴더 밖 파일을 수정하지 않는다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter((l) => l !== '').join('\n');
}
export function pickIds(result, found, max = 2) {
  const byId = new Map(found.map((v) => [v.id, v]));
  const picks = (Array.isArray(result?.picks) ? result.picks : []).map((p) => byId.get(p?.id)).filter(Boolean);
  if (!picks.length) throw new Error('AI가 원본 영상을 고르지 못했습니다. 영상 주소를 직접 넣어 주세요');
  return [...new Set(picks)].slice(0, max);
}

// AI 대본 검사 + 정리. 시각은 0.1초 단위, 원본 길이 안으로
const num = (v) => Number(v);
export function validateClip(script, sources) {
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  if (scenes.length < 1 || scenes.length > 8) throw new Error('구간 수가 올바르지 않습니다(1~8개)');
  if (!Array.isArray(script.title) || !script.title.some((l) => String(l).trim())) throw new Error('제목이 없습니다');
  let total = 0;
  const clean = scenes.map((s, i) => {
    const src = sources.find((x) => x.n === num(s.src));
    if (!src) throw new Error(`구간 ${i + 1}: 원본 번호 ${s.src}가 없습니다`);
    const start = Math.round(num(s.start) * 10) / 10;
    let end = Math.round(num(s.end) * 10) / 10;
    if (!(start >= 0 && end > start + 0.5)) throw new Error(`구간 ${i + 1}: 시작·끝 시각이 올바르지 않습니다`);
    if (src.duration && end > src.duration + 0.5) throw new Error(`구간 ${i + 1}: 원본 길이(${src.duration}초)를 넘습니다`);
    if (end - start > 20) end = start + 20; // 한 구간 20초까지 — 넘으면 실패 대신 잘라 쓴다(AI 한 번을 버리지 않게)
    total += end - start;
    const f = Array.isArray(s.focus) ? s.focus.map(num) : [50, 40];
    const focus = [0, 1].map((k) => (Number.isFinite(f[k]) ? Math.min(100, Math.max(0, f[k])) : [50, 40][k]));
    // 번역 자막(subs)·반응 말풍선(pops): 원본 시각 → 구간 안으로 자르고, 장면 안 시각(0초부터)으로 바꿔 둔다
    const inside = (t) => Math.min(end, Math.max(start, num(t)));
    const subs = (Array.isArray(s.subs) ? s.subs : []).map((x) => ({ a: inside(x?.at), b: inside(x?.end), text: String(x?.text || '').trim() }))
      .filter((x) => x.text && x.b - x.a >= 0.3).sort((x, y) => x.a - y.a)
      .map((x) => ({ at: +(x.a - start).toFixed(2), end: +(x.b - start).toFixed(2), text: x.text.slice(0, 50) }));
    subs.forEach((x, k) => { if (subs[k + 1] && x.end > subs[k + 1].at) x.end = subs[k + 1].at; });
    const pops = (Array.isArray(s.pops) ? s.pops : []).map((x) => ({ a: inside(x?.at), text: String(x?.text || '').trim() }))
      .filter((x) => x.text && x.a < end - 0.3).slice(0, 3)
      .map((x) => ({ at: +(x.a - start).toFixed(2), end: +Math.min(end - start, x.a - start + 1.8).toFixed(2), text: x.text.slice(0, 24) }));
    // 번역 자막·말풍선이 있는 장면은 통자막(caption·sub)을 안 쓴다 — 같은 자리에 겹친다(2026-11-22 '한편…' 겹침)
    const timed = pops.length || subs.length;
    const extra = {};
    const cover = (Array.isArray(s.cover) ? s.cover : []).filter((b) => Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(Number(v))))
      .map((b) => b.map((v) => Math.min(100, Math.max(0, Number(v))))).filter(([x, y, w, h]) => w >= 2 && h >= 2).slice(0, 4);
    if (cover.length) extra.cover = cover;
    // 해설(say)이 있는 장면은 해설이 자막이 되므로 번역 자막·통자막을 쓰지 않는다
    const say = String(s.say || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (say) return { src: src.n, start, end, focus, say, caption: '', sub: '', subs: [], pops: [], ...(extra.cover ? { cover: extra.cover } : {}) };
    for (const [k, n] of [['from', 20], ['react', 30], ['label', 14]]) { const t = String(s[k] || '').trim(); if (t) extra[k] = t.slice(0, n); }
    return { src: src.n, start, end, focus, caption: timed ? '' : String(s.caption || '').trim(), sub: timed ? '' : String(s.sub || '').trim(), subs, pops, ...extra };
  });
  if (total > 60) throw new Error(`전체 길이가 너무 깁니다(${total.toFixed(0)}초, 60초까지)`);
  const stamp = String(script.stamp || '').replace(/\*/g, '').trim().slice(0, 4);
  const narrate = clean.some((s) => s.say);
  const format = script.format === 'top' ? 'top' : clean.some((s) => s.from || s.react) ? 'story' : undefined;
  return { ...script, narrate, ...(format ? { format } : {}), layout: 'clip', title: script.title.slice(0, 2).map(String), scenes: clean, hashtags: Array.isArray(script.hashtags) ? script.hashtags : [], stamp, accent: script.accent === 'purple' ? 'purple' : 'coral', textZone: ['top', 'bottom'].includes(script.textZone) ? script.textZone : 'none' };
}
// 설명란: AI 설명 + 출처(원본 주소)는 코드가 붙인다
export const withCredits = (description, sources) =>
  `${String(description || '').replace(/\n*출처[\s\S]*$/, '').trim()}\n\n출처\n${sources.map((s) => `${s.channel} ${s.url}`).join('\n')}`.trim();

// ---- 해설(② story): 문장마다 TTS → 이어 붙임(video.mjs buildVoice), 자막은 문장별 단어 타이밍으로 덩어리 ----
export const sayLines = (say) => String(say || '').split(/(?<=[.!?…])\s+/).map((t) => t.trim()).filter(Boolean);
// 원본 글자를 모자이크로 가렸으면 피할 필요가 없다 → 우리 자막을 제자리(아래)에 둬 가린 자리를 덮는다
export const zoneOf = (script) => {
  const hid = (script.scenes || []).flatMap((s) => s.cover || []);
  if (script.textZone === 'bottom' && hid.some(([, y]) => y >= 60)) return 'cover';
  if (script.textZone === 'top' && hid.some(([, y, , h]) => y + h <= 40)) return 'none';
  return script.textZone || 'none';
};
// parts: buildVoice의 문장들({start,end,text,words}). tempo: 해설을 빨리 돌린 배율. total: 장면 길이(초)
export function narrationCaps(parts, total, tempo = 1, max = 16) {
  const caps = parts.flatMap((p) => chunkCaptions(spoken(p.text), p.words, Math.max(0.3, p.end - p.start), max)
    .reduce((list, c) => { // '합니다.'처럼 짧은 꼬리만 남으면 앞 덩어리에 붙인다
      const prev = list[list.length - 1];
      if (prev && c.text.trim().length <= 4 && prev.text.length + c.text.length <= max + 5) { prev.text = `${prev.text} ${c.text}`; prev.end = c.end; } else list.push({ ...c });
      return list;
    }, [])
    .map((c) => ({ at: (p.start + c.start) / tempo, end: (p.start + c.end) / tempo, text: markEmphasis(c.text, p.text) })));
  caps.forEach((c, k) => { c.end = k < caps.length - 1 ? caps[k + 1].at : Math.max(c.end, total); });
  return caps.filter((c) => c.at < total - 0.1).map((c) => ({ at: +c.at.toFixed(2), end: +Math.min(total, c.end).toFixed(2), text: c.text }));
}

// ---- 렌더: 장면마다 글자판(투명 PNG)을 한 번 찍고, ffmpeg로 원본 구간을 세로로 잘라 얹는다 ----
// 글자는 장면 안에서 바뀌지 않으므로 프레임 캡처(숏폼 무대)보다 훨씬 빠르다. 소리는 원본 그대로(체감 음량만 맞춤).
const CLIP_PAGE = pathToFileURL(path.join(HERE, 'assets', 'clip.html')).href;
// vh: 영상 칸 높이(형식마다 위 띠 높이가 달라 영상 칸도 달라진다)
// 원본 화면에 박힌 자막 가리기(2026-11-22 사용자: 원래 자막은 모자이크). cover = [[x,y,w,h], ...] 원본 화면 % → 픽셀 모자이크.
// size = 원본 [가로, 세로] 픽셀. 반환: 필터 조각(입력 [0:v] → 출력 [mv]) 또는 ''
export function mosaicFilter(cover, [sw, sh]) {
  const even = (v) => Math.max(0, Math.round(v / 2) * 2);
  const boxes = (cover || []).map(([x, y, w, h]) => {
    const bx = even(sw * x / 100), by = even(sh * y / 100);
    return { x: Math.min(bx, sw - 4), y: Math.min(by, sh - 4), w: even(Math.min(sw - bx, sw * w / 100)), h: even(Math.min(sh - by, sh * h / 100)) };
  }).filter((b) => b.w >= 8 && b.h >= 8);
  if (!boxes.length) return '';
  const cell = Math.max(12, Math.round(sh / 45)); // 1080p에서 24px 칸
  return [
    `[0:v]split=${boxes.length + 1}[m0]${boxes.map((_, k) => `[c${k}]`).join('')}`,
    ...boxes.map((b, k) => `[c${k}]crop=${b.w}:${b.h}:${b.x}:${b.y},scale=${Math.max(1, Math.round(b.w / cell))}:${Math.max(1, Math.round(b.h / cell))},scale=${b.w}:${b.h}:flags=neighbor[p${k}]`),
    ...boxes.map((b, k) => `[m${k}][p${k}]overlay=${b.x}:${b.y}[${k === boxes.length - 1 ? 'mv' : `m${k + 1}`}]`)
  ].join(';');
}
// 원본 가로·세로(픽셀)
export async function videoSize(file) {
  const out = await ffmpeg(['-i', file, '-t', '0.1', '-f', 'null', '-'], () => {}).catch(() => '');
  const m = String(out).match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  return m ? [Number(m[1]), Number(m[2])] : [1920, 1080];
}
export const cropFilter = ([fx, fy], vh = VH) => {
  const R = (W / vh).toFixed(5);
  return `crop='min(iw,ih*${R})':'min(ih,iw/${R})':'max(0,min(iw-ow,iw*${fx / 100}-ow/2))':'max(0,min(ih-oh,ih*${fy / 100}-oh/2))',scale=${W}:${vh},setsar=1`;
};
export async function renderClip(dir, script, { chromePath, tts = {}, log = () => {} } = {}) {
  const work = path.join(dir, 'build');
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  // 글꼴: 고른 것(titleFont) → 예전 대본의 font → 탭 기본값. 색 조합: clipStyle(title-styles.mjs CLIP_STYLES)
  const face = FONT_CHOICES[script.titleFont] || FONT_CHOICES[script.font] || FONT_CHOICES[(KIND_DEFAULTS[script.kind] || KIND_DEFAULTS.celeb).font] || FONT_CHOICES.blackhan;
  const style = clipStyleOf(script);
  const top = style.top || TOP;
  const vh = style.vh || H - top; // 영상 칸 높이(해설 형식은 가운데 정사각형 가까이, 아래는 검정 칸)
  const fonts = { T: pathToFileURL(path.join(FONTS, face.file)).href, B: pathToFileURL(path.join(FONTS, 'Pretendard-ExtraBold.otf')).href, R: pathToFileURL(path.join(FONTS, FONT_CHOICES.ssurround.file)).href };
  const sources = new Map((script.sources || []).map((s) => [s.n, s]));
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--allow-file-access-from-files'] });
  const clips = [];
  const sizes = new Map(); // 원본 번호 → [가로, 세로]
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(CLIP_PAGE);
    for (const [i, scene] of script.scenes.entries()) {
      const s = { ...scene };
      const src = sources.get(s.src);
      if (!src) throw new Error(`장면 ${i + 1}: 원본 ${s.src}가 없습니다`);
      // 해설: 목소리가 구간보다 길면 원본 안에서 구간을 늘리고, 그래도 길면 해설을 1.3배까지 빨리 돌린다
      let voice = null, tempo = 1;
      if (script.narrate && s.say) {
        voice = await buildVoice({ lines: sayLines(s.say).map((text) => ({ text, tone: 'normal' })) }, i + 1, work, path.join(dir, 'voice-cache'), { ...tts, log }, log);
        if (voice.seconds > s.end - s.start) s.end = Math.round(Math.min(src.duration || Infinity, s.start + voice.seconds) * 10) / 10;
        if (voice.seconds > s.end - s.start) tempo = Math.min(1.3, voice.seconds / (s.end - s.start));
        s.subs = narrationCaps(voice.parts, s.end - s.start, tempo);
      }
      const file = path.resolve(dir, src.file);
      const png = path.join(work, `text-${i + 1}.png`);
      await page.evaluate((d) => window.setup(d), { fonts, style, title: script.title || [], caption: s.caption, sub: s.sub, credit: style.layout === 'story' ? '' : style.layout === 'issue' ? (s.from ? `출처: ${s.from}` : '') : src.channel ? (style.layout === 'stick' ? (s.from ? `출처: ${s.from}` : `OFFICIAL · ${src.channel}`) : `출처: ${src.channel}`) : '', owner: ['issue', 'story'].includes(style.layout) && src.channel ? `© ${src.channel}` : '', stamp: script.stamp, zone: zoneOf(script), react: s.react || '', label: s.label || '', format: script.format || '' });
      await page.screenshot({ path: png, omitBackground: true });
      // 시간에 따라 켜지는 글자판: 번역 자막(흰 글씨) + 터지는 순간 반응 말풍선
      const timed = [];
      for (const [k, x] of [...(s.subs || []).map((x) => ({ ...x, layer: 'sub' })), ...(s.pops || []).map((x) => ({ ...x, layer: 'pop' }))].entries()) {
        const f = path.join(work, `text-${i + 1}-${x.layer}-${k + 1}.png`);
        await page.evaluate((d) => window.setup(d), { fonts, style, layer: x.layer, text: x.text, zone: zoneOf(script) });
        await page.screenshot({ path: f, omitBackground: true });
        timed.push({ file: f, at: x.at, end: x.end });
      }
      const len = (s.end - s.start).toFixed(2);
      const mosaic = s.cover?.length ? mosaicFilter(s.cover, sizes.get(src.n) || (sizes.set(src.n, await videoSize(file)), sizes.get(src.n))) : '';
      const audio = script.mute
        ? ['-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=44100:cl=stereo']
        : [];
      const fade = Math.max(0, s.end - s.start - 0.15).toFixed(2);
      const out = path.join(work, `scene-${String(i + 1).padStart(2, '0')}.mp4`);
      const ai = 2 + timed.length; // 무음 입력 번호(글자판 뒤)
      const vi = ai + (script.mute ? 1 : 0); // 해설 음성 입력 번호
      const orig = script.mute ? `[${ai}:a]anull` : `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100`;
      // 해설 장면: 원본 소리를 낮게 깔고(14%) 해설을 얹는다. 해설 없는 장면(결정적 순간)은 원본 소리 그대로
      const mix = voice
        ? `${orig},volume=0.14[bg];[${vi}:a]${tempo > 1 ? `atempo=${tempo.toFixed(3)},` : ''}aresample=44100,apad[nv];[bg][nv]amix=inputs=2:duration=first:normalize=0,afade=t=in:d=0.08,afade=t=out:st=${fade}:d=0.15[ao]`
        : `${orig}${script.mute ? '' : `,afade=t=in:d=0.08,afade=t=out:st=${fade}:d=0.15`}[ao]`;
      await ffmpeg(['-ss', String(s.start), '-to', String(s.end), '-i', file, '-i', png, ...timed.flatMap((x) => ['-i', x.file]), ...audio, ...(voice ? ['-i', voice.voice] : []),
        '-filter_complex', [
          ...(mosaic ? [mosaic] : []),
          `[${mosaic ? 'mv' : '0:v'}]${cropFilter(s.focus || [50, 40], vh)},fps=${FPS},pad=${W}:${H}:0:${top}:${style.layout === 'issue' ? 'white' : 'black'}[v]`,
          '[v][1:v]overlay=0:0[l0]',
          ...timed.map((x, k) => `[l${k}][${k + 2}:v]overlay=0:0:enable='between(t,${x.at},${x.end})'[l${k + 1}]`),
          `[l${timed.length}]format=yuv420p[vo]`,
          mix
        ].join(';'),
        '-map', '[vo]', '-map', '[ao]', '-t', len, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(FPS),
        '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', out], log);
      clips.push(out);
      log(`장면 ${i + 1}/${script.scenes.length}: 원본 ${s.src} ${s.start}~${s.end}초`);
    }
  } finally { await browser.close(); }
  const list = path.join(work, 'concat.txt');
  await fs.writeFile(list, clips.map((c) => `file '${c.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(dir, 'short.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], log);
  // 점검 그림: 1초마다 한 칸, 8칸씩 줄. 완성본을 한눈에 확인한다
  const seconds = await duration(out);
  await ffmpeg(['-i', out, '-vf', `fps=1,scale=216:-2,tile=8x${Math.max(1, Math.ceil(seconds / 8))}`, '-frames:v', '1', '-q:v', '4', path.join(dir, 'check.jpg')], log);
  log(`완성: ${out} (${seconds.toFixed(1)}초)`);
  return out;
}
