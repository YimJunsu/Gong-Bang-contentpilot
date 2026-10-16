// localhost:5999 — 관리 페이지 + 작업 API. 무거운 일(AI·브라우저)은 전부 백그라운드 작업으로 돈다.
import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAI, lastJson } from './ai.mjs';
import * as naver from './naver.mjs';
import next from 'next';
import { renderShort, FONT_CHOICES } from './video.mjs';
import { fetchShortents, updateStore, similarPost } from './shortents.mjs';
import { notify } from './notify.mjs';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const LOGS = path.join(DATA, 'logs');
mkdirSync(LOGS, { recursive: true });

const CONFIG_FILE = path.join(HERE, 'config.json');
// 맨 앞 BOM(U+FEFF)을 떼고 파싱한다. 메모장·PowerShell로 저장한 파일 앞에 붙는다 (2026-10-16 meta.json 실측)
const parseJson = (text) => JSON.parse(String(text).replace(/^\uFEFF/, ''));
if (!existsSync(CONFIG_FILE)) writeFileSync(CONFIG_FILE, readFileSync(path.join(HERE, 'config.example.json')));
// 새로 생긴 설정 키(tts 등)는 예시 파일 기본값으로 채운다
let config = { ...parseJson(readFileSync(path.join(HERE, 'config.example.json'), 'utf8')), ...parseJson(readFileSync(CONFIG_FILE, 'utf8')) };
const saveConfig = () => writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

const readJson = (file, fallback) => { try { return JSON.parse(readFileSync(path.join(DATA, file), 'utf8')); } catch { return fallback; } };
const writeJson = (file, value) => writeFileSync(path.join(DATA, file), JSON.stringify(value, null, 2));
const state = readJson('state.json', { session: null, drafted: {} });
const saveState = () => writeJson('state.json', state);
const jobs = readJson('jobs.json', []).map((j) => (j.status === 'running' ? { ...j, status: 'failed', error: '서버 재시작으로 중단됨' } : j));
const saveJobs = () => writeJson('jobs.json', jobs.slice(0, 200));

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const today = () => new Date().toLocaleDateString('sv-SE');

// ---- 작업 ----
function removeJob(job) {
  jobs.splice(jobs.indexOf(job), 1);
  rmSync(path.join(LOGS, `${job.id}.log`), { force: true });
  saveJobs();
}

function startJob(type, input, work) {
  const job = { id: `${stamp()}-${Math.random().toString(36).slice(2, 6)}`, type, input, status: 'running', startedAt: new Date().toISOString() };
  jobs.unshift(job); saveJobs();
  const logFile = path.join(LOGS, `${job.id}.log`);
  const log = (line) => appendFileSync(logFile, `[${new Date().toLocaleTimeString('ko-KR')}] ${line}\n`);
  work(job, log)
    .then((result) => Object.assign(job, { status: 'done', result }))
    .catch((error) => { log(`오류: ${error.message}`); Object.assign(job, { status: 'failed', error: error.message }); })
    .finally(() => { job.endedAt = new Date().toISOString(); saveJobs(); announce(job); });
  return job;
}

// 끝난 작업을 Windows 알림으로 알린다 (설정에서 끌 수 있다). 누르면 작업 로그가 열린다
const JOB_NAMES = { write: '글 생성', draft: '임시저장', discover: '수집·추천', shorts: '숏폼 생성', render: '숏폼 렌더링' };
function announce(job) {
  if (config.notify === false || !JOB_NAMES[job.type]) return;
  const what = job.input.topic || path.basename(job.input.postDir || job.input.dir || '') || '';
  const minutes = Math.max(1, Math.round((Date.parse(job.endedAt) - Date.parse(job.startedAt)) / 60000));
  const title = `${JOB_NAMES[job.type]} ${job.status === 'done' ? '완료' : '실패'}${what ? ` · ${what}` : ''}`;
  const body = job.status === 'done'
    ? (job.type === 'discover' ? `추천 주제 ${job.result?.picks ?? 0}개 · ` : '') + `${minutes}분 걸림. 눌러서 결과 보기`
    : String(job.error || '').slice(0, 120);
  notify(title, body, `http://localhost:${config.port}/?tab=${job.type === 'discover' ? 'home' : 'jobs'}`);
}

const POST_RE = /^POST_DIR=(.+)$/m;
async function newestPostSince(since) {
  let best = null;
  for (const { dir } of await scanPosts()) {
    const st = await fs.stat(dir).catch(() => null);
    if (st && st.birthtimeMs >= since && (!best || st.birthtimeMs > best.t)) best = { t: st.birthtimeMs, full: dir };
  }
  return best?.full || null;
}

const hasRules = () => existsSync(path.join(config.blogRoot, 'AGENTS.md'));
// 규칙 파일이 없는 블로그용 기본 형식. 글 목록이 읽을 수 있게 meta.json만은 꼭 남긴다
const DEFAULT_FORMAT = [
  '이 폴더에는 작성 규칙(AGENTS.md)이 없다. 다음 기본 형식으로 쓴다:',
  '- 폴더: <이 폴더>/<분류 폴더(지정됐으면)>/<YYYYMMDD>-<짧은 주제>/',
  '- 파일: <주제>.html(네이버 블로그에 붙일 본문, 제목은 <title>과 <h1>), assets/ (이미지는 webp), meta.json',
  '- meta.json: {"title","category_name","main_keyword","tags":[],"thumbnail":"assets 안 파일명","images":[],"created_at":"YYYY-MM-DD"}',
  '- 1인칭 블로그 말투, 소제목(h2) 3~5개, 공백 제외 1,200~2,000자, 마지막에 해시태그 10~20개. 확인 안 된 사실은 쓰지 않는다.'
].join('\n');

// 사용자 첨부는 역할이 둘이다: files = 내가 찍은 사진·영상(본문에 그대로), refs = 참고 자료(사실 확인용, 이미지는 새로 만든다)
const quote = (text) => `"""\n${text}\n"""`;
function writePrompt({ topic, category, notes, files = [], refs = [], linkTexts = [], sourceUrl, sourceText }) {
  return [
    hasRules()
      ? '이 폴더의 AGENTS.md와 거기서 읽으라고 한 규칙 파일을 모두 읽고, 그대로 따라 블로그 글 1편을 끝까지 완성하라.'
      : `블로그 글 1편을 끝까지 완성하라.\n${DEFAULT_FORMAT}`,
    `주제: ${topic}`,
    category ? `분류 폴더: ${category}` : '분류: 규칙에 따라 판단 (기존 분류 폴더 중 맞는 곳)',
    notes ? `요청사항(그대로 따른다):\n${notes}` : '',
    files.length ? `내 사진·영상(내가 직접 찍은 것 — 직접 열어 보고 본문에 실제 사진으로 넣는다. 규칙대로 webp로 바꿔 assets에 둔다):\n${files.map((f) => `- ${f}`).join('\n')}` : '',
    refs.length ? `참고 자료(PDF·HTML·캡처 등 — 직접 열어 사실·숫자·일정을 확인하는 용도. 문장을 베끼지 않는다. 쓸 만한 이미지는 그대로 넣지 말고 규칙의 이미지 스타일로 새로 만든다):\n${refs.map((f) => `- ${f}`).join('\n')}` : '',
    ...linkTexts.map((l) => `참고 링크 ${l.url} — 공식 정보로 우선한다. 요청사항이 이 페이지의 이미지를 쓰라고 하면 이미지를 내려받아 assets에 넣고 출처는 검증 메모에 남긴다. 페이지 텍스트:\n${l.text ? quote(l.text) : '(서버가 읽지 못함 — 가능하면 직접 열어 확인한다)'}`),
    sourceText ? `참고 화면(네이버 숏텐츠 요약, ${sourceUrl}) 텍스트 — 주제의 맥락 파악용이다. 문장을 베끼지 말고, 사실은 원문·공식 자료로 다시 확인한다:\n"""\n${sourceText}\n"""` : '',
    '',
    '- 비대화형 백그라운드 실행이다. 질문하지 말고 스스로 판단해 끝까지 진행한다.',
    '- 중복 주제가 있으면 새 관점으로 별도 작성한다.',
    '- 이미지 생성이 가능하면 규칙대로 생성한다. 불가능하면 이미지-재생성-프롬프트.txt를 남긴다.',
    '- 규칙에 검증기(검사 스크립트)가 있으면 실행해 오류가 없을 때까지 고친다.',
    '- 맨 마지막 줄에 정확히 `POST_DIR=<게시물 폴더 절대경로>` 한 줄을 출력한다.'
  ].filter((line) => line !== '').join('\n');
}

// ---- 숏폼 ----
const SHORTS = () => path.join(config.blogRoot, 'shorts');
const safeName = (v) => String(v).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '').slice(0, 40) || 'short';
const inShorts = (dir) => { const rel = path.relative(SHORTS(), path.resolve(dir)); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); };
const ttsOptions = () => ({ ...(config.tts || {}), chromePath: config.chromePath });

function shortsPrompt({ topic, notes, files }) {
  return [
    '세로형(9:16) 정보 숏폼 영상 대본을 만든다. 결과는 이 폴더의 script.json 파일 하나다.',
    topic ? `주제: ${topic}` : '주제: 자료를 보고 정하라',
    notes ? `메모: ${notes}` : '',
    files.length ? `자료 (media/ 폴더, 직접 열어 내용을 파악하라):\n${files.map((f) => `- media/${f}`).join('\n')}` : '자료 없음',
    '',
    'script.json 형식:',
    '{"title":["윗줄(10자 이내)","아랫줄(12자 이내, *강조*)"],"badge":"짧은 라벨 또는 빈 문자열","scenes":[{"media":"media/파일명 또는 null","stamp":"도장 문구 또는 빈 문자열","lines":[{"text":"읽을 문장, *강조 구절*","tone":"normal"}]}],"description":"업로드 설명 2~3줄","hashtags":["#태그"]}',
    '- 장면 4~8개, 전체 낭독 30~50초. 첫 장면은 3초 안에 핵심(금액·날짜·대상)을 말하는 훅.',
    '- lines는 한 장면 1~3문장, 구어체 한국어. 숫자는 읽기 쉽게(14만 6,700원). 마지막 장면은 저장·확인 유도.',
    '- tone은 문장마다 normal(보통) / emphasis(힘줘서 강조) / angry(열받은 듯 빠르고 세게) / whisper(비밀 말하듯 작게) / excited(신나게) 중 하나.',
    '  예능 숏폼처럼 섞어 리듬을 만든다: 훅은 angry·excited, 핵심 숫자는 emphasis, 꿀팁·단점은 whisper. 다만 전체의 절반 이상은 normal로 둔다.',
    '- 문장 속 핵심 숫자·단어는 *별표*로 감싼다(자막에서 노란색). 한 문장에 1개.',
    '- stamp는 장면에 크게 찍히는 짧은 문구(8자 이내, 예: "*월 14만원*", "마감 D-1"). 전체 장면의 절반 이하에만 넣는다.',
    '- (선택) 장면 "enter": 등장 전환 slide / zoomblur / drop / glitch / flip / wipe / spin / pop. 비우면 장면마다 돌아가며 쓴다.',
    '- (선택) 장면 "focus": [가로%, 세로%] 줌인할 때 당겨 볼 지점(사진 속 가격표·얼굴 등). 기본 [50,45].',
    '- (선택) 문장 "move": punch(확 줌인) / zoomout(원래대로) / pan(옆으로 밀기) / shake(흔들기) / bounce(통통) / none. 비우면 tone에 맞춰 자동.',
    '- title 두 줄은 영상 내내 위에 고정된다. 가장 중요한 숫자나 이득을 *별표*로 강조.',
    '- 자료에 없는 숫자·날짜·조건을 지어내지 마라.',
    '- media는 media/ 안 파일만. PDF는 핵심 페이지를 PNG로 media/에 저장해 쓴다. 영상 파일은 그대로 써도 된다.',
    '- 맞는 자료가 없는 장면은 이미지 생성이 가능하면 9:16 또는 1:1 이미지를 media/에 만들어 쓰고, 불가능하면 null.',
    '- 질문하지 말고 끝까지 진행한다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter((l) => l !== '').join('\n');
}

const jobTypes = {
  async shorts(job, log) {
    const dir = path.join(SHORTS(), `${today().replace(/-/g, '')}-${safeName(job.input.topic || '숏폼')}-${job.id.slice(-4)}`);
    const media = path.join(dir, 'media');
    await fs.mkdir(media, { recursive: true });
    for (const f of job.input.files || []) await fs.copyFile(f, path.join(media, path.basename(f)));
    job.result = { dir }; saveJobs();
    const engine = job.input.engine || config.engine;
    log(`${engine}로 대본 작성 · ${dir}`);
    const output = await runAI(config, engine, shortsPrompt({ ...job.input, files: (job.input.files || []).map((f) => path.basename(f)) }), { cwd: dir, log });
    let script = parseJson(await fs.readFile(path.join(dir, 'script.json'), 'utf8').catch(() => 'null'));
    if (!script) { script = lastJson(output); if (script) await fs.writeFile(path.join(dir, 'script.json'), JSON.stringify(script, null, 2)); }
    if (!script?.scenes?.length) throw new Error('script.json을 만들지 못했습니다');
    if (job.input.font) script.font = job.input.font;
    log(`대본 장면 ${script.scenes.length}개 → 렌더링`);
    return { dir, video: await renderShort(dir, script, { tts: ttsOptions(), log }) };
  },
  async render(job, log) {
    if (!inShorts(job.input.dir)) throw new Error('숏폼 폴더가 아닙니다');
    const script = parseJson(await fs.readFile(path.join(job.input.dir, 'script.json'), 'utf8'));
    return { dir: job.input.dir, video: await renderShort(job.input.dir, script, { tts: ttsOptions(), log }) };
  },
  async write(job, log) {
    const since = Date.now() - 5000;
    const engine = job.input.engine || config.engine;
    if (job.input.shortentsId) await linkShortents(job.input.shortentsId, job.id);
    if (job.input.hotKeyword) await linkHot(job.input.hotKeyword, job.id);
    let sourceText = '';
    if (job.input.sourceUrl) {
      log('숏텐츠 요약 화면 읽는 중');
      sourceText = (await naver.scrape(config, job.input.sourceUrl, 2500).catch((e) => { log(`  읽지 못함: ${e.message} — 주제만으로 씁니다`); return { text: '' }; })).text.slice(0, 8000);
    }
    // 참고 링크: 페이지 글자를 읽어 넘긴다 (최대 5개, 각 6,000자). 못 읽으면 주소만 넘겨 AI가 직접 열게 한다
    const linkTexts = [];
    for (const url of (job.input.links || []).slice(0, 5)) {
      log(`참고 링크 읽는 중: ${url}`);
      const page = await naver.scrape(config, url, 2000).catch((e) => { log(`  읽지 못함: ${e.message}`); return null; });
      linkTexts.push({ url, text: page?.text?.replace(/\n{3,}/g, '\n\n').slice(0, 6000) || '' });
    }
    log(`${engine} 실행 · 주제: ${job.input.topic}`);
    const output = await runAI(config, engine, writePrompt({ ...job.input, sourceText, linkTexts }), { cwd: config.blogRoot, log });
    const postDir = output.match(POST_RE)?.[1]?.trim().replace(/^`|`$/g, '') || await newestPostSince(since);
    if (!postDir || !existsSync(postDir)) throw new Error('게시물 폴더를 찾지 못했습니다');
    log(`게시물 폴더: ${postDir}`);
    if (job.input.draft) await draft(postDir, log);
    return { postDir };
  },
  async draft(job, log) { await draft(job.input.postDir, log); return { postDir: job.input.postDir }; },
  async discover(job, log) {
    const out = {};
    log('핫 키워드(어드바이저 주제별 인기유입검색어) 받는 중');
    const hot = await refreshHot().catch((e) => { log(`  받지 못함: ${e.message} — 저장된 것을 씁니다`); return readJson('hotkeywords.json', null); });
    if (hot?.categories?.length) {
      out.reward = hot.categories.map((c) => `[${c.category}] ${c.items.map((k) => `${k.query}${k.change == null ? '(new)' : k.change > 0 ? `(+${k.change})` : ''}`).join(', ')}`).join('\n');
      log(`  ${hot.date} 기준 ${hot.categories.length}개 주제`);
    }
    const st = await refreshShortents().catch(() => readJson('shortents.json', null));
    const now = (st?.current || []).map((id) => st.items[id]).filter(Boolean);
    if (now.length) { out.shortents = now.map((x) => `${x.rank}. [${x.category}] ${x.title}`).join('\n'); log(`숏텐츠 ${now.length}개`); }
    if (!out.reward && !out.shortents) throw new Error('핫 키워드도 숏텐츠도 받지 못했습니다');
    writeJson('discover-raw.json', { at: new Date().toISOString(), ...out });
    const engine = job.input.engine || config.engine;
    log(`${engine}로 추천 정리 중`);
    // 블로그마다 분류·기록 방식이 달라서, 분류 목록과 이미 쓴 글 제목을 직접 넘긴다
    const posts = await listPosts();
    const cats = categoriesOf(posts).filter((c) => c.id);
    const prompt = [
      '아래는 네이버 크리에이터 어드바이저의 주제별 인기유입검색어(어제 기준, 괄호는 순위 변동·new는 새로 등장)와 숏텐츠 목록이다.',
      '이 폴더에 AGENTS.md가 있으면 블로그 성격과 분류 기준을 참고하라. 아래 "이미 쓴 글"과 겹치는 주제는 빼라.',
      '파일은 수정하지 말고, 결과를 JSON 하나로만 출력하라:',
      `{"reward":[{"keyword":"","note":""}],"shortents":[{"topic":"","note":""}],"picks":[{"topic":"","category":"${cats.length ? cats.map((c) => c.id).join('|') : ''}","main_keyword":"","why":"","angle":""}]}`,
      cats.length ? `category는 다음 분류 폴더 중 하나: ${cats.map((c) => c.name).join(', ')}` : 'category는 빈 문자열로 둔다.',
      'picks는 지금 올리기 좋은 순서로 5~10개. 화면에 없는 숫자를 지어내지 마라.',
      '', '=== 이미 쓴 글 (최근 80편) ===', ...posts.slice(0, 80).map((p) => `- ${p.title}`),
      '', '=== 핫 키워드 ===', out.reward || '(없음)', '', '=== 숏텐츠 ===', out.shortents || '(없음)'
    ].join('\n');
    const parsed = lastJson(await runAI(config, engine, prompt, { cwd: config.blogRoot, log: () => {} }));
    if (!parsed) throw new Error('AI 결과에서 JSON을 찾지 못했습니다');
    const result = { at: new Date().toISOString(), ...parsed };
    writeJson('discover.json', result);
    log(`추천 ${parsed.picks?.length || 0}개`);
    return { picks: parsed.picks?.length || 0 };
  },
  async scrape(job, log) { log(`읽는 중: ${job.input.url}`); return naver.scrape(config, job.input.url); }
};

// ---- 숏텐츠: 자동 조회(기본 30분) + 저장 ----
const SHORTENTS_FILE = path.join(DATA, 'shortents.json');
let shortentsBusy = null;
function refreshShortents() {
  // 동시에 두 번 부르면 한 번만 받는다
  shortentsBusy ||= fetchShortents()
    .then(async (items) => {
      const st = await updateStore(SHORTENTS_FILE, items);
      if (items.errors?.length) { st.lastError = `일부 분류를 받지 못함: ${items.errors.join(', ')}`; writeJson('shortents.json', st); }
      return st;
    })
    .catch((error) => { const st = readJson('shortents.json', { items: {} }); st.lastError = error.message; writeJson('shortents.json', st); throw error; })
    .finally(() => { shortentsBusy = null; });
  return shortentsBusy;
}
async function linkShortents(id, jobId) {
  const st = readJson('shortents.json', null);
  if (st?.items?.[id]) { st.items[id].jobId = jobId; writeJson('shortents.json', st); }
}
const shortentsMinutes = () => Math.max(0, Number(config.shortentsIntervalMin ?? 30) || 0);
let shortentsTimer = null;
function scheduleShortents() {
  clearTimeout(shortentsTimer);
  const minutes = shortentsMinutes();
  if (!minutes) return; // 0 = 자동 조회 끔
  const last = Date.parse(readJson('shortents.json', {}).lastFetch || 0) || 0;
  const wait = Math.max(5_000, last + minutes * 60_000 - Date.now()); // 서버를 켰을 때 오래됐으면 곧바로
  shortentsTimer = setTimeout(() => { refreshShortents().catch(() => {}).finally(scheduleShortents); }, wait);
}
scheduleShortents();

// ---- 핫 키워드: 어드바이저 주제별 인기유입검색어. 하루 단위 데이터라 6시간마다 한 번 받는다(로그인돼 있을 때만) ----
let hotBusy = null;
function refreshHot() {
  hotBusy ||= naver.hotKeywords(config)
    .then((fresh) => {
      const old = readJson('hotkeywords.json', {});
      const st = { ...fresh, fetchedAt: new Date().toISOString(), jobs: old.jobs || {}, lastError: null };
      writeJson('hotkeywords.json', st);
      return st;
    })
    .catch((error) => { writeJson('hotkeywords.json', { ...readJson('hotkeywords.json', {}), lastError: error.message }); throw error; })
    .finally(() => { hotBusy = null; });
  return hotBusy;
}
async function linkHot(query, jobId) {
  const st = readJson('hotkeywords.json', null);
  if (st) { st.jobs = { ...st.jobs, [query]: jobId }; writeJson('hotkeywords.json', st); }
}
const HOT_EVERY = 6 * 3600_000;
setInterval(() => {
  const last = Date.parse(readJson('hotkeywords.json', {}).fetchedAt || 0) || 0;
  if (state.session?.loggedIn && Date.now() - last > HOT_EVERY) refreshHot().catch(() => {});
}, 10 * 60_000);

async function draft(postDir, log) {
  log('임시저장 시작');
  const result = await naver.saveDraft(config, postDir, log);
  state.drafted[postDir] = { at: new Date().toISOString(), ...result, logs: undefined };
  saveState();
}

// ---- 글 목록 ----
const IMAGE_TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const insideRoot = (target) => { const rel = path.relative(path.resolve(config.blogRoot), path.resolve(target)); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };

// 블로그마다 폴더 구조가 다르다 → 분류를 정해 두지 않고 찾는다.
// meta.json이 있는 폴더 = 글 하나. 블로그 폴더 바로 아래(분류 없음) 또는 한 단계 아래(그 폴더 이름이 분류)까지 본다.
// 오덕이는 A/B/C, 다른 블로그는 맛집/여행 같은 폴더가 그대로 분류가 된다.
const SKIP_DIRS = new Set(['shorts', 'tmp', 'node_modules', 'output', 'assets', 'docs', 'model', 'sticker']);
const skipDir = (name) => name.startsWith('.') || name.startsWith('_') || SKIP_DIRS.has(name.toLowerCase());
const readMeta = (dir) => fs.readFile(path.join(dir, 'meta.json'), 'utf8').then(parseJson).catch(() => null);
const dirsIn = async (dir) => (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && !skipDir(d.name)).map((d) => d.name);

async function scanPosts() {
  const found = [];
  const root = config.blogRoot;
  for (const top of await dirsIn(root)) {
    const topDir = path.join(root, top);
    const meta = await readMeta(topDir);
    if (meta) { found.push({ dir: topDir, cat: '', meta }); continue; }
    for (const name of await dirsIn(topDir)) {
      const dir = path.join(topDir, name);
      const m = await readMeta(dir);
      if (m) found.push({ dir, cat: top, meta: m });
    }
  }
  return found;
}

async function listPosts() {
  const posts = [];
  for (const { dir, cat, meta } of await scanPosts()) {
    const name = path.basename(dir);
    const stat = await fs.stat(dir).catch(() => null);
    const datePrefix = name.match(/^(\d{4})(\d{2})(\d{2})/);
    let thumb = meta.thumbnail ? path.join(dir, 'assets', meta.thumbnail) : null;
    if (!thumb) { // meta에 없으면 assets 안 첫 이미지
      const first = (await fs.readdir(path.join(dir, 'assets')).catch(() => [])).find((f) => IMAGE_TYPES[path.extname(f).toLowerCase()]);
      if (first) thumb = path.join(dir, 'assets', first);
    }
    posts.push({
      path: dir, cat, name, title: meta.title || name, keyword: meta.main_keyword || '', catName: meta.category_name || '',
      created: meta.created_at || (datePrefix ? `${datePrefix[1]}-${datePrefix[2]}-${datePrefix[3]}` : stat?.birthtime.toISOString().slice(0, 10)),
      tags: (meta.tags || []).length, images: (meta.images || []).length, thumb,
      drafted: state.drafted[dir]?.at || null
    });
  }
  return posts.sort((a, b) => String(b.created).localeCompare(String(a.created)) || b.name.localeCompare(a.name));
}

// 분류 = 글이 들어 있는 폴더. 이름은 글 meta의 분류명 중 가장 많은 것, 없으면 폴더 이름
function categoriesOf(posts) {
  const map = new Map();
  for (const p of posts) {
    const c = map.get(p.cat) || { id: p.cat, count: 0, names: {} };
    c.count += 1;
    if (p.catName) c.names[p.catName] = (c.names[p.catName] || 0) + 1;
    map.set(p.cat, c);
  }
  return [...map.values()].map((c) => {
    const best = Object.entries(c.names).sort((a, b) => b[1] - a[1])[0]?.[0];
    // 화면에는 사람이 붙인 분류명만 보인다. 폴더 이름(오덕이의 A·B·C 같은 기호)은 분류명이 없을 때만 쓴다
    return { id: c.id, name: c.id ? best || c.id : '분류 없음', count: c.count };
  }).sort((a, b) => a.id.localeCompare(b.id, 'ko'));
}

// ---- HTTP ----
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const body = async (req) => { const parts = []; for await (const c of req) parts.push(c); return Buffer.concat(parts); };

const routes = {
  'GET /api/state': async () => {
    const rootOk = Boolean(config.blogRoot) && existsSync(config.blogRoot);
    return {
      config, session: state.session, discover: readJson('discover.json', null), today: today(),
      rootOk, hasRules: rootOk && hasRules(), categories: rootOk ? categoriesOf(await listPosts()) : []
    };
  },
  'POST /api/session': async () => {
    state.session = { ...(await naver.session(config)), checkedAt: new Date().toISOString() };
    if (state.session.blogId && !config.blogId) { config.blogId = state.session.blogId; saveConfig(); }
    saveState(); return state.session;
  },
  'POST /api/login': async () => {
    const result = await naver.login(config);
    state.session = { ...(await naver.session(config)), checkedAt: new Date().toISOString() };
    if (state.session.blogId && !config.blogId) { config.blogId = state.session.blogId; saveConfig(); }
    saveState(); return { ...result, session: state.session };
  },
  'POST /api/config': async (req) => { config = { ...config, ...JSON.parse(await body(req)) }; saveConfig(); scheduleShortents(); return config; },
  // 숏텐츠 목록: 지금 목록 먼저(순위순), 그다음 최근에 보였던 것. 비슷한 글·글쓰기 작업 상태를 붙인다
  'GET /api/shortents': async () => {
    const st = readJson('shortents.json', { items: {} });
    const posts = config.blogRoot && existsSync(config.blogRoot) ? await listPosts() : [];
    const current = new Set(st.current || []);
    const items = Object.values(st.items || {}).map((x) => {
      const job = x.jobId ? jobs.find((j) => j.id === x.jobId) : null;
      return {
        ...x, isCurrent: current.has(x.gdid), isNew: x.firstSeen === st.lastFetch && st.lastFetch !== st.firstFetch,
        similar: similarPost(x.title, posts),
        job: job ? { id: job.id, status: job.status, postDir: job.result?.postDir || null } : null
      };
    }).sort((a, b) => (b.isCurrent - a.isCurrent) || (a.isCurrent ? a.rank - b.rank : Date.parse(b.lastSeen) - Date.parse(a.lastSeen)));
    const minutes = shortentsMinutes();
    return { lastFetch: st.lastFetch || null, lastError: st.lastError || null, intervalMin: minutes,
      nextFetch: minutes && st.lastFetch ? new Date(Date.parse(st.lastFetch) + minutes * 60_000).toISOString() : null, items };
  },
  // 핫 키워드: 주제별 목록 + 키워드마다 비슷한 글·글쓰기 작업 상태
  'GET /api/hotkeywords': async () => {
    const st = readJson('hotkeywords.json', {});
    const posts = config.blogRoot && existsSync(config.blogRoot) ? await listPosts() : [];
    const jobOf = (q) => { const job = st.jobs?.[q] && jobs.find((j) => j.id === st.jobs[q]); return job ? { id: job.id, status: job.status } : null; };
    return {
      date: st.date || null, fetchedAt: st.fetchedAt || null, lastError: st.lastError || null, loggedIn: Boolean(state.session?.loggedIn),
      categories: (st.categories || []).map((c) => ({ ...c, items: c.items.map((k) => ({ ...k, similar: similarPost(k.query, posts), job: jobOf(k.query) })) }))
    };
  },
  'POST /api/hotkeywords/refresh': async () => { const st = await refreshHot(); return { date: st.date, count: st.categories.length }; },
  'POST /api/shortents/refresh': async () => { const st = await refreshShortents(); return { lastFetch: st.lastFetch, count: st.current.length }; },
  'GET /api/posts': listPosts,
  // 썸네일 등 블로그 폴더 안 이미지만 내준다
  'GET /api/image': async (req, res, url) => {
    const file = path.resolve(url.searchParams.get('path') || '');
    const ext = path.extname(file).toLowerCase();
    if (!insideRoot(file) || !IMAGE_TYPES[ext]) return send(res, 403, { error: 'forbidden' });
    send(res, 200, await fs.readFile(file), IMAGE_TYPES[ext]);
  },
  // 탐색기로 글·숏폼 폴더 열기 (블로그 폴더 안만)
  'POST /api/open': async (req) => {
    const target = path.resolve(JSON.parse(await body(req)).path || '');
    if (!insideRoot(target) || !existsSync(target)) throw new Error('블로그 폴더 안의 경로만 열 수 있습니다');
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  },
  // 글 삭제: 글 목록에 있는 글 폴더만, 영구 삭제가 아니라 휴지통으로 보낸다 (실수해도 되살릴 수 있게)
  'POST /api/posts/delete': async (req) => {
    const target = path.resolve(JSON.parse(await body(req)).path || '');
    const isPost = (await scanPosts()).some((p) => path.resolve(p.dir) === target);
    if (!isPost) throw new Error('글 목록에 있는 글 폴더만 지울 수 있습니다');
    // 경로는 환경 변수로 넘긴다 — 명령줄에 끼워 넣지 않아 특수문자가 있어도 안전하다
    await new Promise((resolve, reject) => {
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:BH_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')"],
      { env: { ...process.env, BH_TARGET: target }, windowsHide: true });
      let err = '';
      ps.stderr.on('data', (c) => { err += c; });
      ps.on('error', reject);
      ps.on('close', (code) => (code === 0 && !existsSync(target) ? resolve() : reject(new Error(`휴지통으로 옮기지 못했습니다 ${err.trim().split('\n')[0] || ''}`))));
    });
    delete state.drafted[target];
    saveState();
    return { ok: true };
  },
  // 숏폼 제목 글꼴 미리보기용
  'GET /api/font': async (req, res, url) => {
    const face = FONT_CHOICES[url.searchParams.get('name')];
    if (!face) return send(res, 404, { error: 'not found' });
    res.setHeader('Cache-Control', 'max-age=86400');
    send(res, 200, await fs.readFile(path.join(HERE, 'assets', 'fonts', face.file)), 'font/ttf');
  },
  'GET /api/shorts': async () => {
    const out = [];
    for (const name of await fs.readdir(SHORTS()).catch(() => [])) {
      const dir = path.join(SHORTS(), name);
      const script = await fs.readFile(path.join(dir, 'script.json'), 'utf8').then(parseJson).catch(() => null);
      const video = await fs.stat(path.join(dir, 'short.mp4')).catch(() => null);
      out.push({ dir, name, script, video: video ? video.mtime : null });
    }
    return out.sort((a, b) => b.name.localeCompare(a.name));
  },
  'POST /api/shorts/script': async (req) => {
    const { dir, script } = JSON.parse(await body(req));
    if (!inShorts(dir)) throw new Error('숏폼 폴더가 아닙니다');
    if (!Array.isArray(script?.scenes)) throw new Error('scenes 배열이 필요합니다');
    await fs.writeFile(path.join(dir, 'script.json'), JSON.stringify(script, null, 2));
    return { ok: true };
  },
  // 미리보기용 mp4 스트리밍 (Range 지원 — 브라우저 video 태그가 탐색할 수 있게). shorts 폴더 밖은 거절.
  'GET /api/shorts/video': async (req, res, url) => {
    const dir = url.searchParams.get('dir') || '';
    if (!inShorts(dir)) return send(res, 403, { error: 'forbidden' });
    const file = path.join(dir, 'short.mp4');
    const { size } = await fs.stat(file);
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (!range) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' }); return createReadStream(file).pipe(res); }
    const start = Number(range[1] || 0), end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start, end }).pipe(res);
  },
  'GET /api/jobs': async () => jobs.slice(0, 50),
  // 끝난 작업(완료·실패) 기록을 한꺼번에 지운다. 진행 중은 남긴다
  'POST /api/jobs/clear': async () => { jobs.filter((j) => j.status !== 'running').forEach(removeJob); return { ok: true }; },
  'POST /api/jobs': async (req) => {
    const { type, ...input } = JSON.parse(await body(req));
    if (!jobTypes[type]) throw new Error(`알 수 없는 작업: ${type}`);
    if (type === 'write' && !String(input.topic || '').trim()) throw new Error('주제가 비었습니다');
    return startJob(type, input, jobTypes[type]);
  },
  // 첨부: 파일 하나를 원본 바이트로 받는다. 저장 위치는 블로그 루트 tmp (AI가 읽을 수 있는 곳)
  'POST /api/upload': async (req, res, url) => {
    const name = path.basename(url.searchParams.get('name') || 'file').replace(/[\\/:*?"<>|]/g, '_');
    const dir = path.join(config.blogRoot, 'tmp', 'bloghelper', url.searchParams.get('batch') || stamp());
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.writeFile(file, await body(req));
    return { path: file };
  }
};

// 화면은 Next(React). /api만 여기서 처리하고 나머지는 Next에 넘긴다 — 포트 하나, 작업 상태는 이 프로세스에 유지.
const dev = process.argv.includes('--dev');
const ui = next({ dev, dir: HERE, hostname: 'localhost', port: config.port });
const uiHandle = ui.getRequestHandler();
await ui.prepare();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // AI를 권한 우회로 돌리는 서버다. 다른 사이트가 이 포트로 요청을 쏘지 못하게 막는다:
  // Host 검사 = DNS 리바인딩 차단, 커스텀 헤더 = 교차 출처 POST는 사전요청에서 막힘(CSRF 차단).
  const hostOk = new RegExp(`^(localhost|127\\.0\\.0\\.1):${config.port}$`).test(req.headers.host || '');
  if (!hostOk) return send(res, 403, { error: 'forbidden' });
  if (!url.pathname.startsWith('/api/')) return uiHandle(req, res);
  if (req.method !== 'GET' && req.headers['x-bh'] !== '1') return send(res, 403, { error: 'forbidden' });
  try {
    const jobLog = url.pathname.match(/^\/api\/jobs\/([\w-]+)\/log$/);
    if (req.method === 'GET' && jobLog) {
      return send(res, 200, await fs.readFile(path.join(LOGS, `${jobLog[1]}.log`), 'utf8').catch(() => ''), 'text/plain; charset=utf-8');
    }
    // 작업 하나 지우기 / 다시 하기
    const jobAct = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/retry)?$/);
    if (jobAct && (req.method === 'DELETE' || (req.method === 'POST' && jobAct[2]))) {
      const job = jobs.find((j) => j.id === jobAct[1]);
      if (!job) return send(res, 404, { error: '작업이 없습니다' });
      if (req.method === 'DELETE') {
        if (job.status === 'running') return send(res, 409, { error: '진행 중인 작업은 지울 수 없습니다' });
        removeJob(job);
        return send(res, 200, { ok: true });
      }
      // mode=render: 숏폼 대본은 두고 영상만 다시 (음성은 저장된 것 재사용) / 그 외: 같은 입력으로 처음부터
      const { mode } = JSON.parse((await body(req)).toString() || '{}');
      const dir = job.result?.dir || job.input.dir;
      const again = mode === 'render' && dir ? startJob('render', { dir }, jobTypes.render) : startJob(job.type, job.input, jobTypes[job.type]);
      return send(res, 200, again);
    }
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return send(res, 404, { error: 'not found' });
    const result = await route(req, res, url);
    if (!res.headersSent) send(res, 200, result ?? {});
  } catch (error) {
    if (!res.headersSent) send(res, 500, { error: error.message });
  }
});
if (dev) server.on('upgrade', ui.getUpgradeHandler()); // 개발 모드 핫리로드
server.listen(config.port, '127.0.0.1', () => console.log(`bloghelper: http://localhost:${config.port}${dev ? ' (dev)' : ''}`));
