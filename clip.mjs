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
import { ffmpeg, duration, FONT_CHOICES } from './video.mjs';
import { clipStyleOf, KIND_DEFAULTS } from './title-styles.mjs';

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
export async function download(config, url, outBase, log) {
  await ytdlp(config, [url, '--no-playlist', '-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
    '--merge-output-format', 'mp4', '--ffmpeg-location', ffmpegPath, '-o', `${outBase}.%(ext)s`], log);
  return `${outBase}.mp4`;
}

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
export const notCompilation = (v) => !COMPILATION.test(`${v.title} ${v.channel}`);

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
    '아래 후보 중 이 인물·화제가 화면에 가장 잘, 가장 많이 나오는 영상 1~2개를 고른다. 공식 채널(방송사·소속사·음악 채널)을 우선하고, 같은 무대가 여럿이면 화질 좋은 것 하나만.',
    '파일은 만들지 말고 JSON만 출력한다: {"picks":[{"id":"영상 id","why":"한 줄 이유"}]}',
    '후보:',
    ...found.map((v) => `- id=${v.id} | ${v.channel} | ${v.duration}초 | 조회 ${v.views} | ${v.title}`)
  ].filter(Boolean).join('\n');
}
export function scriptPrompt({ topic, notes = '', mute = false, seconds = [15, 40], kind = 'celeb' }, sources) {
  const viral = kind === 'viral';
  return [
    '세로(9:16) 유튜브 쇼츠를 만든다. 아래 원본 영상에서 구간을 골라 이어 붙이고, 위에 훅 제목·아래에 자막을 얹는다. 결과는 이 폴더의 script.json 하나다.',
    viral ? `분야·키워드: ${topic} (해외 재밌는 영상 — 한국 시청자에게 소개한다)` : `인물·화제: ${topic}`,
    notes ? `메모(따른다): ${notes}` : '',
    '',
    '원본 영상 (장면 모음 그림을 직접 열어 본다. 칸마다 왼쪽 위 노란 글자가 원본 시각(초)이고, 한 칸 = 2초):',
    ...sources.map((s) => [
      `[${s.n}] ${s.title} | ${s.channel} | ${s.duration}초`,
      ...s.sheets.map((f) => `  그림: ${f}`),
      s.hot?.length ? `  많이 다시 본 구간(초): ${s.hot.map(([a, b]) => `${a}-${b}`).join(', ')}` : ''
    ].filter(Boolean).join('\n')),
    '',
    'script.json 형식:',
    '{"title":["윗줄(14자 이내)","아랫줄(14자 이내, *강조* 1곳)"],"scenes":[{"src":1,"start":12,"end":17.5,"focus":[50,40],"caption":"큰 자막(16자 이내)","sub":"작은 자막(22자 이내) 또는 빈 문자열"}],"description":"업로드 설명 2~3줄(출처는 자동으로 붙으니 쓰지 않는다)","hashtags":["#태그"],"sound":"어울리는 음악 분위기 한 줄"}',
    viral
      ? `- 구간 1~4개, 하나에 3~20초, 합쳐서 ${seconds[0]}~${seconds[1]}초. 원본 길이 안에서. 웃기거나 놀라운 순간 하나를 앞뒤 맥락과 함께 보여 준다(기다림 → 터지는 순간 → 반응). 원본의 자막·워터마크는 그대로 둔다.`
      : `- 구간 3~6개, 하나에 3~8초, 합쳐서 ${seconds[0]}~${seconds[1]}초. 원본 길이 안에서. 인물이 화면에 크게, 표정·동작이 살아 있는 구간을 고른다(장면 전환·자막·광고 화면 피함).`,
    viral
      ? '- 제목 두 줄은 영상 내내 위에 고정되는 훅. 첫째 줄(작게)은 기대를 까는 상황("드럼 배틀 끝난 줄 알았는데", "내향인이라면 제일 피하고 싶은"), 둘째 줄(크게, 스티커)은 커뮤니티 말투로 터뜨린다: ~함/~임/~됨/~각/~ㄷㄷ 끝맺음, 12자 안팎("밴드 통째로 난입함", "보험사 기절각", "이건 반칙이지"). 결과를 다 말하지 말고 "뭔데?" 궁금하게. 설명문·존댓말·"~하는 순간" 같은 밋밋한 말 금지. "*별표*"는 한 곳만 강조.'
      : '- 첫 구간이 가장 강한 장면(훅). 제목 두 줄은 영상 내내 위에 고정되는 훅, 팬 커뮤니티 제목 말투: 첫째 줄은 궁금증·배경("이 얼굴로 별명이", "3년 만에 디즈니에서 다시 부른", "긴 생머리 vs 중단발 뭐가 답?"), 둘째 줄은 반전·결론 + 인물 이름("수원왕발가락인 *리브*..", "결론은 뭐든 됨 *카리나*"). 인물 이름(그룹·멤버)은 *별표*로 감싸고(노란 밑줄), 끝은 ".." 또는 "?"로 여운. 각 줄 18자 이내.',
    '- focus: 세로로 자를 때 중심 [가로%, 세로%]. 원본에서 인물 얼굴·몸 중심 위치. 기본 [50,40].',
    viral
      ? '- caption은 옆에서 같이 보는 친구의 반응(말풍선): 반말, 짧게(12자 안팎), 감탄·드립 위주. 예: "오 지린다;", "아니 표정 봐ㅋㅋㅋ", "이게 생방이라고?", "ㄹㅇ 미쳤네", "형님 여기서 왜 웃음", "잠깐만 다시 봐". ㅋㅋ·;·?! 허용. 외국어 대사는 이 말투로 핵심만 옮긴다("이거 말고 없냐고ㅋㅋ"). 장면 해설("무대가 다시 분주해져요")·존댓말·뉴스 말투 금지. *별표* 1곳은 분홍 강조. sub는 대부분 빈 문자열, 꼭 필요할 때만 짧은 상황 보충. 욕설·외모 비하·성적 표현 금지. 원본이 누구 것인지 지어내지 않는다.'
      : '- caption은 팬 댓글 같은 한 줄("이 직캠 댓글 1위", "크리스마스 공주들 그 자체", "워너원 때 춤선부터"), sub는 그 아래 작은 보충(그 댓글 내용·포인트, 선택). 반말·팬 말투, 짧게. 외모 품평·성적 표현 금지.',
    mute ? '- 원본 소리는 끄고 업로드 때 음악을 고른다. sound에 어울리는 음악 분위기를 쓴다.' : '- 원본 소리를 그대로 쓴다. sound에는 원본 소리를 끌 때 쓸 음악 분위기를 쓴다.',
    RULES,
    '- 질문하지 말고 끝까지 진행한다. 이 폴더 밖 파일을 수정하지 않는다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter((l) => l !== '').join('\n');
}
export function pickIds(result, found) {
  const byId = new Map(found.map((v) => [v.id, v]));
  const picks = (Array.isArray(result?.picks) ? result.picks : []).map((p) => byId.get(p?.id)).filter(Boolean);
  if (!picks.length) throw new Error('AI가 원본 영상을 고르지 못했습니다. 영상 주소를 직접 넣어 주세요');
  return [...new Set(picks)].slice(0, 2);
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
    return { src: src.n, start, end, focus, caption: String(s.caption || '').trim(), sub: String(s.sub || '').trim() };
  });
  if (total > 60) throw new Error(`전체 길이가 너무 깁니다(${total.toFixed(0)}초, 60초까지)`);
  return { ...script, layout: 'clip', title: script.title.slice(0, 2).map(String), scenes: clean, hashtags: Array.isArray(script.hashtags) ? script.hashtags : [] };
}
// 설명란: AI 설명 + 출처(원본 주소)는 코드가 붙인다
export const withCredits = (description, sources) =>
  `${String(description || '').replace(/\n*출처[\s\S]*$/, '').trim()}\n\n출처\n${sources.map((s) => `${s.channel} ${s.url}`).join('\n')}`.trim();

// ---- 렌더: 장면마다 글자판(투명 PNG)을 한 번 찍고, ffmpeg로 원본 구간을 세로로 잘라 얹는다 ----
// 글자는 장면 안에서 바뀌지 않으므로 프레임 캡처(숏폼 무대)보다 훨씬 빠르다. 소리는 원본 그대로(체감 음량만 맞춤).
const CLIP_PAGE = pathToFileURL(path.join(HERE, 'assets', 'clip.html')).href;
// vh: 영상 칸 높이(형식마다 위 띠 높이가 달라 영상 칸도 달라진다)
export const cropFilter = ([fx, fy], vh = VH) => {
  const R = (W / vh).toFixed(5);
  return `crop='min(iw,ih*${R})':'min(ih,iw/${R})':'max(0,min(iw-ow,iw*${fx / 100}-ow/2))':'max(0,min(ih-oh,ih*${fy / 100}-oh/2))',scale=${W}:${vh},setsar=1`;
};
export async function renderClip(dir, script, { chromePath, log = () => {} } = {}) {
  const work = path.join(dir, 'build');
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  // 글꼴: 고른 것(titleFont) → 예전 대본의 font → 탭 기본값. 색 조합: clipStyle(title-styles.mjs CLIP_STYLES)
  const face = FONT_CHOICES[script.titleFont] || FONT_CHOICES[script.font] || FONT_CHOICES[(KIND_DEFAULTS[script.kind] || KIND_DEFAULTS.celeb).font] || FONT_CHOICES.blackhan;
  const style = clipStyleOf(script);
  const top = style.top || TOP;
  const fonts = { T: pathToFileURL(path.join(FONTS, face.file)).href, B: pathToFileURL(path.join(FONTS, 'Pretendard-ExtraBold.otf')).href, R: pathToFileURL(path.join(FONTS, FONT_CHOICES.ssurround.file)).href };
  const sources = new Map((script.sources || []).map((s) => [s.n, s]));
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--allow-file-access-from-files'] });
  const clips = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.goto(CLIP_PAGE);
    for (const [i, s] of script.scenes.entries()) {
      const src = sources.get(s.src);
      if (!src) throw new Error(`장면 ${i + 1}: 원본 ${s.src}가 없습니다`);
      const file = path.resolve(dir, src.file);
      const png = path.join(work, `text-${i + 1}.png`);
      await page.evaluate((d) => window.setup(d), { fonts, style, title: script.title || [], caption: s.caption, sub: s.sub, credit: src.channel ? `출처: ${src.channel}` : '' });
      await page.screenshot({ path: png, omitBackground: true });
      const len = (s.end - s.start).toFixed(2);
      const audio = script.mute
        ? ['-f', 'lavfi', '-t', len, '-i', 'anullsrc=r=44100:cl=stereo']
        : [];
      const fade = Math.max(0, s.end - s.start - 0.15).toFixed(2);
      const out = path.join(work, `scene-${String(i + 1).padStart(2, '0')}.mp4`);
      await ffmpeg(['-ss', String(s.start), '-to', String(s.end), '-i', file, '-i', png, ...audio,
        '-filter_complex', [
          `[0:v]${cropFilter(s.focus || [50, 40], H - top)},fps=${FPS},pad=${W}:${H}:0:${top}:black[v]`,
          '[v][1:v]overlay=0:0,format=yuv420p[vo]',
          script.mute ? '[2:a]anull[ao]' : `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,afade=t=in:d=0.08,afade=t=out:st=${fade}:d=0.15[ao]`
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
