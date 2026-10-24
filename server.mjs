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
const state = readJson('state.json', { drafted: {} });
state.accounts ||= {}; // 계정 id → 마지막 세션 확인 결과
const saveState = () => writeJson('state.json', state);

// ---- 계정: 네이버(여러 개, 계정마다 크롬 프로필 폴더) · 인스타그램 · 스레드 ----
// 비밀번호·쿠키는 저장하지 않는다. 네이버 로그인은 사람이 직접 하고 크롬 프로필에 남는다. 인스타·스레드는 아직 이름·아이디만 적어 둔다.
const SERVICES = { naver: '네이버', instagram: '인스타그램', threads: '스레드' };
// 예전 버전(계정 하나, data/chrome-profile, config.blogId)을 첫 네이버 계정으로 옮긴다 — 다시 로그인하지 않아도 된다
if (!Array.isArray(config.accounts)) {
  config.accounts = [];
  if (existsSync(path.join(DATA, 'chrome-profile')) || config.blogId) {
    config.accounts.push({ id: 'naver-1', service: 'naver', name: config.blogId || '네이버 1', blogId: config.blogId || '', profile: 'chrome-profile' });
    config.defaultNaver = 'naver-1';
    if (state.session) state.accounts['naver-1'] = state.session;
  }
  delete config.blogId; delete state.session;
  saveConfig(); saveState();
}
const naverAccounts = () => config.accounts.filter((a) => a.service === 'naver');
const defaultNaverOf = () => naverAccounts().find((a) => a.id === config.defaultNaver) || naverAccounts()[0] || null;
// 고른 계정, 안 골랐으면 기본 계정. 고른 계정이 지워졌으면 다른 블로그에 저장하지 않게 멈춘다
function naverAccount(id) {
  const account = id ? naverAccounts().find((a) => a.id === id) : defaultNaverOf();
  if (id && !account) throw new Error('고른 네이버 계정이 없습니다. 설정 → 계정 관리를 확인하세요.');
  if (!account) throw new Error('네이버 계정이 없습니다. 설정 → 계정 관리에서 추가하세요.');
  return account;
}
// 작업 폴더: 네이버 계정에 folder가 있으면 그 폴더, 없으면 설정의 기본 작업 폴더(config.blogRoot).
// '기본' 계정을 바꾸면 대시보드·글 목록·추천·숏폼이 그 계정 폴더를 본다. 다른 계정 글은 그 계정 폴더에 그대로 있다.
// 고른 계정(없으면 기본 계정, 계정이 하나도 없으면 null). 고른 계정이 지워졌으면 멈춘다
function naverAccountOrNone(id) {
  if (!id) return defaultNaverOf();
  const account = naverAccounts().find((a) => a.id === id);
  if (!account) throw new Error('고른 네이버 계정이 없습니다. 설정 → 계정 관리를 확인하세요.');
  return account;
}
const rootOf = (account) => account?.folder || config.blogRoot || '';
const curRoot = () => rootOf(defaultNaverOf());
const allRoots = () => [...new Set([config.blogRoot, ...naverAccounts().map((a) => a.folder)].filter(Boolean))];
const rootOk = (root) => Boolean(root) && existsSync(root);
// 로그인이 필요 없는 화면 읽기용 프로필: 기본 계정 것을 쓰고, 계정이 없으면 따로 하나 둔다
const readerProfile = () => defaultNaverOf()?.profile || 'profiles/reader';
let loginFor = null; // 로그인 창이 열려 있는 계정 id — 화면을 새로 열어도 '로그인하는 중'을 보여 주려고
const defaultSession = () => { const a = defaultNaverOf(); return a ? state.accounts[a.id] || null : null; };
async function checkSession(account) {
  const s = { ...(await naver.session(config, account.profile)), checkedAt: new Date().toISOString() };
  state.accounts[account.id] = s;
  // 로그인한 계정의 '내 블로그'로 가서 읽은 주소가 맞는 값이다 → 비었거나 다르면 고친다(예전에 잘못 저장된 아이디로 임시저장이 실패했었다)
  if (s.blogId && account.blogId !== s.blogId) { account.blogId = s.blogId; saveConfig(); }
  saveState();
  return s;
}
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
async function newestPostSince(since, root) {
  let best = null;
  for (const { dir } of await scanPosts(root)) {
    const st = await fs.stat(dir).catch(() => null);
    if (st && st.birthtimeMs >= since && (!best || st.birthtimeMs > best.t)) best = { t: st.birthtimeMs, full: dir };
  }
  return best?.full || null;
}

// 다시 생성할 때 원래 작업하던 글 폴더: 결과 폴더 → 고치던 폴더 → (실패한 작업) 그 작업이 도는 동안 생긴 날짜 폴더가 딱 하나면 그것
// ponytail: 실패한 작업은 생성 시각으로 추정한다. 같은 시간에 글 작업이 둘 이상 돌아 후보가 여럿이면 못 고르고 새 폴더로 쓴다.
async function postDirOf(job, root) {
  for (const dir of [job.result?.postDir, job.input.reviseDir]) if (dir && insideRoot(dir) && existsSync(dir)) return dir;
  if (job.type !== 'write' || !rootOk(root)) return '';
  const from = Date.parse(job.startedAt) - 5000, to = Date.parse(job.endedAt || new Date().toISOString()) + 5000;
  const born = [];
  const look = async (dir, depth) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || /^[_.]/.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (/^\d{8}-/.test(e.name)) { const t = (await fs.stat(full)).birthtimeMs; if (t >= from && t <= to) born.push(full); }
      else if (depth < 2) await look(full, depth + 1);
    }
  };
  await look(root, 1);
  return born.length === 1 ? born[0] : '';
}

const hasRules = (root) => existsSync(path.join(root, 'AGENTS.md'));
// 블로그 작업 폴더가 없으면 AI가 엉뚱한 곳에 글을 쓰고 '게시물 폴더를 찾지 못했습니다'로 끝난다 → 시작 전에 막는다
function needRoot(root = curRoot()) {
  if (!rootOk(root)) throw new Error('블로그 작업 폴더가 지정되지 않았거나 없습니다. 설정 → 기본 작업 폴더(또는 계정 관리의 계정별 작업 폴더)를 먼저 지정하세요.');
  return root;
}
// 훅(후킹): 궁금하게 만들되 바로 답한다. 규칙 파일이 없는 블로그와 숏폼 대본에 쓴다(있으면 블로그 규칙이 우선)
const HOOK_RULES = [
  '- 제목: 짧은 메인 키워드를 앞에 두고 훅 1~2개(숫자·반전·타깃 콕·이득/손해·질문·첫 반응)를 붙인다. "정리·총정리·안내"로 끝나는 목차형 제목은 쓰지 않는다.',
  '- 도입 첫 문장: 결과 먼저 / 오해 깨기 / 구체적 숫자 / 막힌 장면 중 하나로 시작한다. "오늘은 ~을 알아보겠습니다" 같은 정형구는 쓰지 않는다.',
  '- 소제목: 일부(절반 이하)는 독자의 질문이나 의외의 사실로 쓰고, 그 바로 다음 문장에서 답한다. 섹션 끝에 다음이 궁금해지는 한 줄을 글당 1~2번 둘 수 있다.',
  '- 훅의 숫자·반전은 본문에서 사실로 확인돼야 한다. "충격·경악·99%가 모르는" 같은 근거 없는 과장, 답을 끝까지 미루는 예고는 쓰지 않는다.'
];
// 규칙 파일이 없는 블로그용 기본 형식. 글 목록이 읽을 수 있게 meta.json만은 꼭 남긴다
const DEFAULT_FORMAT = [
  '이 폴더에는 작성 규칙(AGENTS.md)이 없다. 다음 기본 형식으로 쓴다:',
  '- 폴더: <이 폴더>/<분류 폴더(지정됐으면)>/<YYYYMMDD>-<짧은 주제>/',
  '- 파일: <주제>.html(네이버 블로그에 붙일 본문, 제목은 <title>과 <h1>), assets/ (이미지는 webp), meta.json',
  '- meta.json: {"title","category_name","main_keyword","tags":[],"thumbnail":"assets 안 파일명","images":[],"created_at":"YYYY-MM-DD"}',
  '- 1인칭 블로그 말투, 소제목(h2) 3~5개, 공백 제외 1,200~2,000자, 마지막에 해시태그 10~20개. 확인 안 된 사실은 쓰지 않는다.',
  ...HOOK_RULES
].join('\n');

// 사용자 첨부는 역할이 둘이다: files = 내가 찍은 사진·영상(본문에 그대로), refs = 참고 자료(사실 확인용, 이미지는 새로 만든다)
const quote = (text) => `"""\n${text}\n"""`;

// 실제 이미지(외부 이미지) 규칙. 생성 이미지가 신뢰를 못 주는 곳(실제 제품·장소·화면·인물)에 쓴다.
// '출처만 남기면 된다'가 아니다 — 한국 저작권법 제28조(인용)·제37조(출처 명시)와 퍼블리시티권을 기준으로 안전한 것만 허용한다.
// 블로그 폴더 규칙(AGENTS.md)에 이미지 규칙이 따로 있으면 그쪽이 우선이다.
// 내 사진을 주면 auto(내 사진 중심), 안 주면 real(공식 사진·캡처 먼저) — 작업 입력에 imageMode가 따로 있으면 그것
const IMAGE_MODES = {
  auto: '이미지: 내 사진을 중심으로 규칙대로 만든다. 생성 이미지로는 독자가 믿기 어려운 곳(실제 제품·메뉴·장소·공식 화면)은 아래 "실제 이미지 규칙"에 맞는 실제 이미지를 쓸 수 있다.',
  real: '이미지: 내 사진이 없으니 실제 이미지 우선. 썸네일은 규칙대로 오덕이가 나오는 생성 이미지로 만들고(공식 이미지는 장면을 맞추는 참고로만), 본문 이미지는 공식 배포 이미지 → 공식 화면·공식 영상 장면 캡처 순으로 먼저 찾는다. 웹 검색으로 공식 홈페이지·공식몰·뉴스룸·공식 유튜브를 직접 찾아도 된다. 맞는 것이 없을 때만 생성한다.',
  generated: '이미지: 외부 이미지를 쓰지 않는다. 내 사진과 생성 이미지만 쓴다.'
};
const IMAGE_RULES = [
  '실제 이미지 규칙:',
  '- 쓸 수 있는 것: ① 공식 배포 이미지 — 기업·기관 뉴스룸/보도자료 사진, 소속사·방송사 보도용 사진, 공식 홈페이지·공식몰의 제품·메뉴·매장 이미지, 공공누리(출처표시) 자료 ② 인용 — 글의 내용을 설명·비평하는 데 꼭 필요한 화면(공식 앱·사이트 화면, 소개하는 공식 채널 영상의 썸네일·장면). 본문이 주이고 이미지는 보조여야 하며, 외부 인용 이미지는 글당 3장 이하(공식 영상 자체를 소개하는 글은 그 영상 장면 6장까지, 장면마다 본문 설명 2~3줄).',
  '- 쓰지 않는 것: 통신사·언론사 사진(연합뉴스·뉴스1·뉴시스·게티이미지·AP 등 기자 크레딧이나 워터마크가 있는 사진 — 출처를 적어도 무단 사용이다), 공식 계정이라도 개인 SNS(인스타그램 등) 게시물 사진, 공식 배포가 아닌 연예인·인물 사진(팬·파파라치 사진, 다른 블로그·커뮤니티에서 퍼온 사진), 스톡 사이트 워터마크 이미지, 출처를 알 수 없는 이미지. 실존 인물 얼굴은 썸네일에 쓰지 않는다(퍼블리시티권).',
  '- 정확성: 이미지 속 인물·상품·장면이 본문이 말하는 바로 그것이어야 한다(다른 상품·다른 회차·다른 사람 금지). 직접 열어 확인하고, 인물 이름은 공식 자료로 확인될 때만 캡션에 쓴다. 영상 장면은 본문 순서대로 놓고 캡션에 장면과 시점을 적는다.',
  '- 쓰는 방법: 원본 주소에서 직접 내려받아 assets에 넣고 규칙대로 webp로 바꾼다. 워터마크·로고를 지우거나 내용을 바꾸지 않는다(필요한 부분만 잘라 내기·축소는 된다).',
  '- 출처 표기(필수): 그 이미지의 figcaption 끝에 짧게 "사진: ○○ 공식 홈페이지", "출처: ○○ 뉴스룸", "출처: 유튜브 ○○ 채널" 처럼 적는다. 블로그 규칙이 HTML에 출처 영역을 두지 말라고 해도, 외부 이미지 캡션의 한 줄 출처는 예외로 둔다(법적 의무).',
  '- 검증 메모에 "이미지 출처" 표(파일명 · 원본 주소 · 실린 페이지 · 사용 근거: 공식 배포/인용)를 남기고, meta.json에 "image_sources": [{"file","url","page","basis"}]를 넣는다.',
  '- 판단이 애매하면 쓰지 말고 생성 이미지로 대신한다.'
].join('\n');
// 설정에서 '공식 유튜브 영상 장면 캡처'를 켰을 때만 AI에게 캡처 방법을 알려 준다(서버 /api/youtube/frames)
const captureHelp = (postHint) => [
  '공식 유튜브 영상 장면 캡처(설정에서 켜짐): 글에 공식 채널 영상의 장면이 필요하면 PowerShell에서 아래를 실행한다. 서버가 그 시점의 플레이어 화면만 PNG로 assets에 저장한다(영상 파일은 받지 않는다).',
  `  curl.exe -s -X POST -H "x-bh: 1" "http://127.0.0.1:${config.port}/api/youtube/frames?url=<영상 주소를 URL 인코딩>&t=12:30,33:10&dir=<URL 인코딩한 ${postHint}\\assets>"`,
  '  응답 JSON: { channel, title, frames: [{ at, file }] }. 채널명으로 공식 채널(본인·소속사·방송사·브랜드 공식 채널)인지 확인하고, 아니면 쓰지 않고 파일을 지운다.',
  '  시점은 영상 설명·챕터·댓글의 타임스탬프나 본문이 말하는 장면으로 고른다. 한 영상에서 6장 이하. 저장한 뒤 이미지를 직접 열어 본문 내용과 정확히 맞는지 확인하고, 안 맞으면 지운다. 캡션: "장면 설명 · 12분 30초" 다음 줄 "사진: ○○ 공식 유튜브 영상 화면". 규칙대로 webp로 바꾼다.'
].join('\n');
// 링크 카드·동영상: 임시저장할 때 주소를 에디터에 붙여넣어 네이버 카드·영상으로 바꾼다(vendor/driver.js PASTE_LINK)
const EMBED_HELP = [
  '링크 카드·동영상(네이버 에디터에 진짜 카드·영상으로 들어간다):',
  '- 링크 카드: <div class="oglink" data-url="https://공식몰·공식 페이지 주소"><a href="같은 주소">사이트 이름</a></div> — 글당 1~2개(공식몰·신청 페이지, 같은 묶음의 내 다른 글).',
  '- 동영상: <div class="embed" data-url="https://www.youtube.com/watch?v=영상ID"></div> — 글이 그 공식 영상을 소개할 때 1개. 영상 장면 캡처와 함께 써도 된다.',
  '- 블로그 규칙에 링크 개수 제한이 있으면 그것을 따른다.'
].join('\n');
const parseTime = (v) => {
  const parts = String(v).trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((sum, n) => sum * 60 + n, 0);
};
const youtubeId = (url) => String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/)?.[1] || '';
// reviseDir = 작업 로그의 '다시 생성 → 지금 글 고치기': 처음부터 쓰지 않고 그 폴더의 글을 고친다. feedback = 다시 생성할 때 적은 의견
// thumbNotes = 글 생성하기의 '썸네일 요청사항'. 비면 주제에 맞게 블로그 썸네일 규칙대로 정한다
function writePrompt({ root, topic, category, notes, thumbNotes, files = [], refs = [], linkTexts = [], sourceUrl, sourceText, feedback, reviseDir, rewrite, imageMode }) {
  const mode = IMAGE_MODES[imageMode] ? imageMode : files.length ? 'auto' : 'real';
  const candidates = mode === 'generated' ? [] : linkTexts.filter((l) => l.images?.length);
  return [
    hasRules(root)
      ? '이 폴더의 AGENTS.md와 거기서 읽으라고 한 규칙 파일을 모두 읽고, 그대로 따라 블로그 글 1편을 끝까지 완성하라.'
      : `블로그 글 1편을 끝까지 완성하라.\n${DEFAULT_FORMAT}`,
    reviseDir && rewrite ? `이미 쓴 글 폴더가 있다: ${reviseDir}\n같은 주제로 처음부터 다시 쓰되, 새 폴더를 만들지 말고 이 폴더에 덮어쓴다. HTML·meta.json·검증 메모는 새로 쓰고, 기존 이미지는 새 글에 맞으면 다시 써도 된다. 새 글에서 쓰지 않는 이미지 파일(assets 안 webp 등)은 지운다. 중복 확인에서 이 폴더 자신은 중복으로 보지 않는다.` : '',
    reviseDir && !rewrite ? `이미 쓴 글이 있다: ${reviseDir}\n처음부터 다시 쓰지 말고, 아래 수정 요청을 반영해 이 폴더의 글(HTML·meta.json·검증 메모)을 고쳐 완성하라. 요청과 관계없는 문단과 이미지는 그대로 둔다(바꿔야 할 때만 새로 만든다). 규칙과 검증기는 그대로 지킨다.` : '',
    feedback ? `수정 요청(이번에 꼭 반영한다):\n${feedback}` : '',
    `주제: ${topic}`,
    category ? `분류 폴더: ${category}` : '분류: 규칙에 따라 판단 (기존 분류 폴더 중 맞는 곳). 리뷰(직접 경험) 분류는 그 상품·메뉴·장소를 직접 겪은 사진·설명이 있을 때만 쓴다. 사진이 있어도 방법·예절·날씨·일정·가격·소식처럼 정보를 알려 주는 글이면 정보 분류다. 정한 분류와 이유 한 줄을 검증 메모에 남긴다.',
    notes ? `요청사항(그대로 따른다):\n${notes}` : '',
    String(thumbNotes || '').trim()
      ? `썸네일(대표 사진) 요청(블로그 썸네일 규칙 안에서 그대로 반영한다. 장면·소품·표정·글자를 요청대로 하고, 요청에 없는 부분만 규칙대로 정한다):\n${String(thumbNotes).trim()}`
      : reviseDir && !rewrite ? '' : '썸네일(대표 사진): 따로 요청이 없다. 주제와 본문 핵심에 맞는 장면·글자를 블로그 썸네일 규칙대로 정한다.', // 고쳐 쓰기면 기존 썸네일 유지
    files.length ? `내 사진·영상(내가 직접 찍은 것 — 직접 열어 보고 본문에 실제 사진으로 넣는다. 규칙대로 webp로 바꿔 assets에 둔다):\n${files.map((f) => `- ${f}`).join('\n')}` : '',
    refs.length ? `참고 자료(PDF·HTML·캡처 등 — 직접 열어 사실·숫자·일정을 확인하는 용도. 문장을 베끼지 않는다. 쓸 만한 이미지는 그대로 넣지 말고 규칙의 이미지 스타일로 새로 만든다):\n${refs.map((f) => `- ${f}`).join('\n')}` : '',
    ...linkTexts.map((l) => `참고 링크 ${l.url} — 공식 정보로 우선한다. 요청사항이 이 페이지의 이미지를 쓰라고 하면 이미지를 내려받아 assets에 넣고 출처는 검증 메모에 남긴다. 페이지 텍스트:\n${l.text ? quote(l.text) : '(서버가 읽지 못함 — 가능하면 직접 열어 확인한다)'}`),
    sourceText ? `참고 화면(네이버 숏텐츠 요약, ${sourceUrl}) 텍스트 — 주제의 맥락 파악용이다. 문장을 베끼지 말고, 사실은 원문·공식 자료로 다시 확인한다:\n"""\n${sourceText}\n"""` : '',
    '',
    IMAGE_MODES[mode],
    mode === 'generated' ? '' : IMAGE_RULES,
    mode !== 'generated' && config.videoCapture ? captureHelp(reviseDir || '<게시물 폴더>') : '',
    EMBED_HELP,
    candidates.length ? `참고 링크에서 찾은 이미지 후보(실제 이미지 규칙에 맞는 것만, 글과 장면이 맞을 때만 쓴다. 맞는 게 없으면 안 써도 된다):\n${candidates.map((l) => `[${l.url}]\n${l.images.map((im) => `- ${im.src} (${im.note})`).join('\n')}`).join('\n')}` : '',
    '',
    '- 비대화형 백그라운드 실행이다. 질문하지 말고 스스로 판단해 끝까지 진행한다.',
    reviseDir ? `- 폴더를 새로 만들지 않는다. POST_DIR은 ${reviseDir} 그대로다.` : '- 중복 주제가 있으면 새 관점으로 별도 작성한다.',
    '- 이미지 생성이 가능하면 규칙대로 생성한다. 불가능하면 이미지-재생성-프롬프트.txt를 남긴다.',
    '- 썸네일 등 이미지 속 글자는 이미지 생성으로 장면과 함께 만든다. 코드(PIL 등)로 글자를 얹지 않는다. 글자가 틀리면 다시 생성한다.',
    '- 규칙에 검증기(검사 스크립트)가 있으면 실행해 오류가 없을 때까지 고친다.',
    '- 맨 마지막 줄에 정확히 `POST_DIR=<게시물 폴더 절대경로>` 한 줄을 출력한다.'
  ].filter((line) => line !== '').join('\n');
}

// ---- 숏폼 ----
const SHORTS = () => path.join(curRoot(), 'shorts');
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
    '  훅 유형 중 하나를 고른다: 결과 먼저("월 14만 원에 산다고?"), 오해 깨기("맞벌이도 된다는 거 아셨어요?"), 타깃 콕("자취생이면 이거 꼭"), 손해 경고("이거 모르면 10만 원 날려요"). 주제를 나열하는 첫 문장("오늘은 ~ 알려드릴게요")은 쓰지 않는다. 첫 장면 하나만 봐도 무슨 영상인지 알 수 있어야 한다.',
    '  훅에서 꺼낸 숫자·주장은 다음 장면에서 바로 풀고, 자료에 없는 내용으로 과장하지 않는다.',
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
    // 다시 생성이면 원래 폴더에서(대본·영상은 새로 만든다), 처음이면 새 폴더
    const again = job.input.dir && inShorts(job.input.dir) && existsSync(job.input.dir);
    const dir = again ? job.input.dir : path.join(SHORTS(), `${today().replace(/-/g, '')}-${safeName(job.input.topic || '숏폼')}-${job.id.slice(-4)}`);
    if (again) await fs.rm(path.join(dir, 'script.json'), { force: true });
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
    const root = needRoot(rootOf(naverAccountOrNone(job.input.account)));
    const inPlace = Boolean(job.input.reviseDir) && existsSync(job.input.reviseDir);
    const revising = inPlace && !job.input.rewrite; // 고쳐 쓰기는 자료를 다시 읽지 않는다. 같은 폴더에 처음부터 다시 쓰기는 다시 읽는다
    if (inPlace) log(`${revising ? '고쳐 쓰기' : '같은 폴더에 처음부터 다시 쓰기'}: ${job.input.reviseDir}`);
    let sourceText = '';
    if (job.input.sourceUrl && !revising) {
      log('숏텐츠 요약 화면 읽는 중');
      sourceText = (await naver.scrape(config, readerProfile(), job.input.sourceUrl, 2500).catch((e) => { log(`  읽지 못함: ${e.message} — 주제만으로 씁니다`); return { text: '' }; })).text.slice(0, 8000);
    }
    // 참고 링크: 페이지 글자를 읽어 넘긴다 (최대 5개, 각 6,000자). 못 읽으면 주소만 넘겨 AI가 직접 열게 한다
    const linkTexts = [];
    for (const url of revising ? [] : (job.input.links || []).slice(0, 5)) {
      log(`참고 링크 읽는 중: ${url}`);
      const wantImages = job.input.imageMode !== 'generated';
      const page = await naver.scrape(config, readerProfile(), url, 2000, { withImages: wantImages }).catch((e) => { log(`  읽지 못함: ${e.message}`); return null; });
      // 유튜브: 영상 장면 캡처는 서버가 하지 않는다(영상 내려받기는 유튜브 약관 위반) → 공식 썸네일만 후보로. 장면이 필요하면 직접 캡처해 '내 사진'으로 넣는다.
      // 화면의 다른 이미지(댓글 첨부 등)는 남이 올린 것이라 후보에서 뺀다
      const yt = wantImages && youtubeId(url);
      const images = yt ? [] : page?.images || [];
      if (yt) images.unshift({ src: `https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`, note: `유튜브 영상 썸네일 · ${page?.title || ''}`.slice(0, 100) });
      if (images.length) log(`  이미지 후보 ${images.length}개`);
      linkTexts.push({ url, text: page?.text?.replace(/\n{3,}/g, '\n\n').slice(0, 6000) || '', images });
    }
    log(`${engine} 실행 · 주제: ${job.input.topic}`);
    const output = await runAI(config, engine, writePrompt({ ...job.input, reviseDir: inPlace ? job.input.reviseDir : '', root, sourceText, linkTexts }), { cwd: root, log });
    const postDir = output.match(POST_RE)?.[1]?.trim().replace(/^`|`$/g, '') || (inPlace ? job.input.reviseDir : await newestPostSince(since, root));
    if (!postDir || !existsSync(postDir)) throw new Error('게시물 폴더를 찾지 못했습니다');
    log(`게시물 폴더: ${postDir}`);
    if (inPlace && state.drafted[postDir]) { delete state.drafted[postDir]; saveState(); log('글이 바뀌어 임시저장 표시를 지웠습니다 — 다시 임시저장하세요'); }
    if (job.input.draft) await draft(postDir, log, job.input.account);
    return { postDir };
  },
  async draft(job, log) { await draft(job.input.postDir, log, job.input.account); return { postDir: job.input.postDir }; },
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
    const posts = await listPosts(curRoot());
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
    const parsed = lastJson(await runAI(config, engine, prompt, { cwd: curRoot(), log: () => {} }));
    if (!parsed) throw new Error('AI 결과에서 JSON을 찾지 못했습니다');
    const result = { at: new Date().toISOString(), ...parsed };
    writeJson('discover.json', result);
    log(`추천 ${parsed.picks?.length || 0}개`);
    return { picks: parsed.picks?.length || 0 };
  },
  async scrape(job, log) { log(`읽는 중: ${job.input.url}`); return naver.scrape(config, readerProfile(), job.input.url); }
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
  hotBusy ||= Promise.resolve().then(() => naver.hotKeywords(config, naverAccount().profile))
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
// 사이드바의 로그인 표시가 오래된 값이 되지 않게, 기본 계정 세션을 3시간마다(서버를 켰을 때도) 조용히 확인한다
const SESSION_EVERY = 3 * 3600_000;
async function keepFresh() {
  const account = defaultNaverOf();
  if (account && !loginFor) {
    const checked = Date.parse(state.accounts[account.id]?.checkedAt || 0) || 0;
    if (Date.now() - checked > SESSION_EVERY) await checkSession(account).catch(() => {});
  }
  const last = Date.parse(readJson('hotkeywords.json', {}).fetchedAt || 0) || 0;
  if (defaultSession()?.loggedIn && Date.now() - last > HOT_EVERY) refreshHot().catch(() => {});
}
setTimeout(keepFresh, 15_000);
setInterval(keepFresh, 10 * 60_000);

async function draft(postDir, log, accountId) {
  const account = naverAccount(accountId);
  log(`임시저장 시작 · ${account.name}${account.blogId ? ` (${account.blogId})` : ''}`);
  const result = await naver.saveDraft(config, account, postDir, log);
  state.drafted[postDir] = { at: new Date().toISOString(), account: account.name, ...result, logs: undefined };
  saveState();
}

// ---- 글 목록 ----
const IMAGE_TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const inside = (root, target) => { const rel = path.relative(path.resolve(root), path.resolve(target)); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
// 기본 작업 폴더와 계정별 작업 폴더 중 하나의 안쪽인지
const insideRoot = (target) => allRoots().some((root) => inside(root, target));
const PREVIEW_TYPES = { ...IMAGE_TYPES, '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' };

// 블로그마다 폴더 구조가 다르다 → 분류를 정해 두지 않고 찾는다.
// meta.json이 있는 폴더 = 글 하나. 블로그 폴더 바로 아래(분류 없음) 또는 한 단계 아래(그 폴더 이름이 분류)까지 본다.
// 오덕이는 A/B/C, 다른 블로그는 맛집/여행 같은 폴더가 그대로 분류가 된다.
const SKIP_DIRS = new Set(['shorts', 'tmp', 'node_modules', 'output', 'assets', 'docs', 'model', 'sticker']);
const skipDir = (name) => name.startsWith('.') || name.startsWith('_') || SKIP_DIRS.has(name.toLowerCase());
const readMeta = (dir) => fs.readFile(path.join(dir, 'meta.json'), 'utf8').then(parseJson).catch(() => null);
const dirsIn = async (dir) => (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && !skipDir(d.name)).map((d) => d.name);

async function scanPosts(root = curRoot()) {
  const found = [];
  if (!rootOk(root)) return found;
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

async function listPosts(root = curRoot()) {
  const posts = [];
  for (const { dir, cat, meta } of await scanPosts(root)) {
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
const jsonBody = async (req) => JSON.parse((await body(req)).toString() || '{}');

// 영구 삭제 대신 휴지통으로. 경로는 환경 변수로 넘긴다 — 명령줄에 끼워 넣지 않아 특수문자가 있어도 안전하다
const toRecycleBin = (target) => new Promise((resolve, reject) => {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:BH_TARGET, 'OnlyErrorDialogs', 'SendToRecycleBin')"],
  { env: { ...process.env, BH_TARGET: target }, windowsHide: true });
  let err = '';
  ps.stderr.on('data', (c) => { err += c; });
  ps.on('error', reject);
  ps.on('close', (code) => (code === 0 && !existsSync(target) ? resolve() : reject(new Error(`휴지통으로 옮기지 못했습니다 ${err.trim().split('\n')[0] || ''}`))));
});

const routes = {
  'GET /api/state': async () => {
    const root = curRoot();
    return {
      config, session: defaultSession(), accounts: state.accounts, loggingIn: loginFor, discover: readJson('discover.json', null), today: today(),
      rootOk: rootOk(root), root, hasRules: rootOk(root) && hasRules(root), categories: rootOk(root) ? categoriesOf(await listPosts(root)) : []
    };
  },
  // 네이버 계정 세션 확인 / 로그인 창. id가 없으면 기본 계정
  'POST /api/session': async (req) => checkSession(naverAccount((await jsonBody(req)).id)),
  'POST /api/login': async (req) => {
    const account = naverAccount((await jsonBody(req)).id);
    loginFor = account.id;
    try {
      const result = await naver.login(config, account.profile);
      return { ...result, session: await checkSession(account) };
    } finally { loginFor = null; }
  },
  // 계정 추가·수정. 네이버는 계정마다 새 크롬 프로필 폴더를 받는다(로그인은 로그인 창에서 따로)
  'POST /api/accounts': async (req) => {
    const input = await jsonBody(req);
    const name = String(input.name || '').trim().slice(0, 30);
    const blogId = String(input.blogId || '').trim();
    const handle = String(input.handle || '').trim().replace(/^@/, '');
    const folder = String(input.folder || '').trim().replace(/[\\/]+$/, '');
    if (folder && (!path.isAbsolute(folder) || !existsSync(folder))) throw new Error(`작업 폴더를 찾을 수 없습니다: ${folder}`);
    if (!name) throw new Error('계정 이름을 적어 주세요');
    if (!/^[\w-]*$/.test(blogId)) throw new Error('블로그 아이디는 영문·숫자·-·_만 씁니다');
    if (!/^[\w.]*$/.test(handle)) throw new Error('아이디는 영문·숫자·.·_만 씁니다 (@는 빼도 됩니다)');
    let account = config.accounts.find((a) => a.id === input.id);
    if (!account) {
      if (!SERVICES[input.service]) throw new Error('알 수 없는 서비스입니다');
      let n = 1;
      while (config.accounts.some((a) => a.id === `${input.service}-${n}`)) n += 1;
      account = { id: `${input.service}-${n}`, service: input.service };
      if (account.service === 'naver') account.profile = `profiles/${account.id}`;
      config.accounts.push(account);
    }
    account.name = name;
    if (account.service === 'naver') Object.assign(account, { blogId, folder }); else account.handle = handle;
    if (account.service === 'naver' && naverAccounts().length === 1) config.defaultNaver = account.id;
    saveConfig();
    return config.accounts;
  },
  'POST /api/accounts/default': async (req) => {
    config.defaultNaver = naverAccount((await jsonBody(req)).id).id;
    saveConfig();
    return { defaultNaver: config.defaultNaver };
  },
  // 계정 삭제: 네이버는 그 계정의 크롬 프로필(로그인 기록)까지 휴지통으로 보낸다
  'POST /api/accounts/delete': async (req) => {
    const { id } = await jsonBody(req);
    const account = config.accounts.find((a) => a.id === id);
    if (!account) throw new Error('계정이 없습니다');
    if (account.profile) {
      await naver.forget(account.profile);
      const dir = naver.profileDir(account.profile);
      if (existsSync(dir)) await toRecycleBin(dir);
    }
    config.accounts = config.accounts.filter((a) => a !== account);
    if (config.defaultNaver === id) config.defaultNaver = naverAccounts()[0]?.id || '';
    delete state.accounts[id];
    saveConfig(); saveState();
    return config.accounts;
  },
  // 계정은 위 /api/accounts로만 바꾼다
  'POST /api/config': async (req) => { const { accounts, defaultNaver, ...rest } = await jsonBody(req); config = { ...config, ...rest }; saveConfig(); scheduleShortents(); return config; },
  // 숏텐츠 목록: 지금 목록 먼저(순위순), 그다음 최근에 보였던 것. 비슷한 글·글쓰기 작업 상태를 붙인다
  'GET /api/shortents': async () => {
    const st = readJson('shortents.json', { items: {} });
    const posts = await listPosts();
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
    return { lastFetch: st.lastFetch || null, lastError: st.lastError || null, intervalMin: minutes, busy: Boolean(shortentsBusy),
      nextFetch: minutes && st.lastFetch ? new Date(Date.parse(st.lastFetch) + minutes * 60_000).toISOString() : null, items };
  },
  // 핫 키워드: 주제별 목록 + 키워드마다 비슷한 글·글쓰기 작업 상태
  'GET /api/hotkeywords': async () => {
    const st = readJson('hotkeywords.json', {});
    const posts = await listPosts();
    const jobOf = (q) => { const job = st.jobs?.[q] && jobs.find((j) => j.id === st.jobs[q]); return job ? { id: job.id, status: job.status } : null; };
    return {
      date: st.date || null, fetchedAt: st.fetchedAt || null, lastError: st.lastError || null, loggedIn: Boolean(defaultSession()?.loggedIn), busy: Boolean(hotBusy),
      categories: (st.categories || []).map((c) => ({ ...c, items: c.items.map((k) => ({ ...k, similar: similarPost(k.query, posts), job: jobOf(k.query) })) }))
    };
  },
  'POST /api/hotkeywords/refresh': async () => { const st = await refreshHot(); return { date: st.date, count: st.categories.length }; },
  'POST /api/shortents/refresh': async () => { const st = await refreshShortents(); return { lastFetch: st.lastFetch, count: st.current.length }; },
  // 공식 유튜브 영상 장면 캡처: AI가 글을 쓰다가 부른다(설정에서 켰을 때만). 저장은 작업 폴더 안 assets만
  'POST /api/youtube/frames': async (req, res, url) => {
    if (!config.videoCapture) return send(res, 403, { error: '설정 → 이미지에서 "공식 유튜브 영상 장면 캡처"가 꺼져 있습니다' });
    const video = url.searchParams.get('url') || '';
    const id = youtubeId(video);
    if (!id) throw new Error('유튜브 영상 주소가 아닙니다');
    const seconds = [...new Set((url.searchParams.get('t') || '').split(',').map(parseTime).filter((n) => n != null))].slice(0, 6);
    if (!seconds.length) throw new Error('t에 시점을 주세요 (예: 12:30,33:10)');
    const dir = path.resolve(url.searchParams.get('dir') || '');
    if (!insideRoot(dir) || path.basename(dir) !== 'assets') throw new Error('저장 위치는 작업 폴더 안 글 폴더의 assets여야 합니다');
    await fs.mkdir(dir, { recursive: true });
    const meta = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const label = (s) => `${Math.floor(s / 60)}분${String(s % 60).padStart(2, '0')}초`;
    const frames = await naver.youtubeFrames(config, readerProfile(), id, seconds, dir, (s) => `영상화면_${id}_${label(s)}.png`);
    return { channel: meta.author_name || '', title: meta.title || '', video: `https://www.youtube.com/watch?v=${id}`, frames: frames.map((f) => ({ ...f, file: f.file ? path.basename(f.file) : undefined, label: label(f.at) })) };
  },
  // 글 목록·분류: account를 주면 그 계정의 작업 폴더, 없으면 기본 계정 폴더
  'GET /api/posts': async (req, res, url) => listPosts(rootOf(naverAccountOrNone(url.searchParams.get('account')))),
  'GET /api/folder': async (req, res, url) => {
    const root = rootOf(naverAccountOrNone(url.searchParams.get('account')));
    return { root, rootOk: rootOk(root), hasRules: rootOk(root) && hasRules(root), categories: rootOk(root) ? categoriesOf(await listPosts(root)) : [] };
  },
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
    const isPost = (await Promise.all(allRoots().map((root) => scanPosts(root)))).flat().some((p) => path.resolve(p.dir) === target);
    if (!isPost) throw new Error('글 목록에 있는 글 폴더만 지울 수 있습니다');
    await toRecycleBin(target);
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
    if (type === 'write') needRoot(rootOf(naverAccountOrNone(input.account)));
    if (['shorts', 'render', 'discover'].includes(type)) needRoot();
    return startJob(type, input, jobTypes[type]);
  },
  // 첨부: 파일 하나를 원본 바이트로 받는다. 저장 위치는 블로그 루트 tmp (AI가 읽을 수 있는 곳)
  'POST /api/upload': async (req, res, url) => {
    const root = needRoot(rootOf(naverAccountOrNone(url.searchParams.get('account'))));
    const name = path.basename(url.searchParams.get('name') || 'file').replace(/[\\/:*?"<>|]/g, '_');
    const dir = path.join(root, 'tmp', 'contentpilot', url.searchParams.get('batch') || stamp());
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
    // 글 미리보기: /api/postfile/<글 폴더(base64url)>/<폴더 안 파일>. 폴더만 주면 HTML을 연다.
    // 경로 모양이라 HTML 속 상대 경로(assets/…)가 그대로 풀린다. 작업 폴더 안 글 폴더(meta.json 있음)의 파일만, 스크립트는 막는다
    const postFile = url.pathname.match(/^\/api\/postfile\/([\w-]+)\/(.*)$/);
    if (req.method === 'GET' && postFile) {
      const dir = path.resolve(Buffer.from(postFile[1], 'base64url').toString('utf8'));
      if (!insideRoot(dir) || !existsSync(path.join(dir, 'meta.json'))) return send(res, 403, { error: 'forbidden' });
      let rel = decodeURIComponent(postFile[2]);
      if (!rel) rel = (await fs.readdir(dir)).find((n) => /\.html?$/i.test(n)) || '';
      const file = path.resolve(dir, rel);
      const type = PREVIEW_TYPES[path.extname(file).toLowerCase()];
      if (!rel || !inside(dir, file) || !type || !existsSync(file)) return send(res, 404, { error: 'not found' });
      res.setHeader('Content-Security-Policy', "script-src 'none'; object-src 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return send(res, 200, await fs.readFile(file), type);
    }
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
      // 글: feedback = 이번에 반영할 의견, how=revise면 만든 글을 고쳐 쓰고 아니면 처음부터. draft = 끝나면 임시저장할지
      const { mode, feedback, how, draft: wantDraft } = JSON.parse((await body(req)).toString() || '{}');
      const dir = job.result?.dir || job.input.dir;
      let input = job.input;
      // 다시 생성은 원래 작업 폴더에서 한다(결과 폴더가 둘 생겨 헷갈리지 않게). 폴더가 없을 때만 새로 만든다
      if (job.type === 'write') {
        const { feedback: _f, reviseDir: _r, rewrite: _w, ...base } = job.input;
        const note = String(feedback || '').trim().slice(0, 4000);
        if (how === 'revise' && !note) return send(res, 400, { error: '고쳐 쓰려면 무엇을 고칠지 적어 주세요' });
        const reviseDir = await postDirOf(job, rootOf(naverAccountOrNone(job.input.account)));
        const rewrite = Boolean(reviseDir) && !(how === 'revise' && job.status === 'done');
        input = { ...base, ...(note ? { feedback: note } : {}), ...(reviseDir ? { reviseDir } : {}), ...(rewrite ? { rewrite } : {}), ...(typeof wantDraft === 'boolean' ? { draft: wantDraft } : {}) };
      }
      if (job.type === 'shorts' && dir && inShorts(dir) && existsSync(dir)) input = { ...job.input, dir };
      const again = mode === 'render' && dir ? startJob('render', { dir }, jobTypes.render) : startJob(job.type, input, jobTypes[job.type]);
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
server.listen(config.port, '127.0.0.1', () => console.log(`contentpilot: http://localhost:${config.port}${dev ? ' (dev)' : ''}`));
