// 네이버 쪽 작업 전부. 네이버 계정마다 전용 크롬 프로필(data/ 아래 폴더)을 하나씩 두고 백그라운드(headless)로 띄워 쓴다.
// 로그인은 처음 한 번만 창을 띄워 사람이 직접 한다 — 비밀번호를 코드가 다루지 않는다.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
// profile = data/ 아래 폴더 이름 (계정의 profile 값). 밖으로 나가는 경로는 막는다
export function profileDir(profile) {
  const dir = path.resolve(DATA, String(profile || ''));
  const rel = path.relative(DATA, dir);
  if (!profile || !rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('프로필 경로가 잘못됐습니다');
  return dir;
}
const VENDOR = { html: path.join(HERE, 'vendor', 'html.js'), driver: path.join(HERE, 'vendor', 'driver.js') };
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// 프로필은 한 프로세스만 열 수 있다 → 모든 브라우저 작업을 한 줄로 세운다. 다른 계정 프로필이 오면 닫고 다시 연다.
let queue = Promise.resolve();
let ctx = null;
let ctxHeadless = null;
let ctxProfile = null;
let idleTimer = null;
// 네이버 로그인 쿠키(NID_SES 등)는 '로그인 상태 유지'를 안 켜면 세션 쿠키라 크롬을 닫으면 사라진다.
// 창을 닫았다 다시 열 때(로그인 창 → headless, 5분 쉬고 재시작) 메모리로 넘겨 준다. 디스크에는 안 쓴다.
// ponytail: 서버를 재시작하면 사라진다 — 그때는 '로그인 상태 유지'를 켜고 로그인하면 된다.
const carried = new Map(); // 프로필 → 세션 쿠키
async function closeCtx() {
  if (!ctx) return;
  const c = ctx; ctx = null;
  carried.set(ctxProfile, (await c.cookies().catch(() => [])).filter((k) => k.expires === -1 && /naver\.com$/.test(k.domain)));
  await c.close().catch(() => {});
}
const exclusive = (job) => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };
// 계정을 지우기 전에: 그 프로필이 열려 있으면 닫고, 넘겨 줄 쿠키도 버린다
export const forget = (profile) => exclusive(async () => { if (ctx && ctxProfile === profile) await closeCtx(); carried.delete(profile); });

async function context(config, profile, headless = config.headless !== false) {
  clearTimeout(idleTimer);
  if (ctx && (ctxHeadless !== headless || ctxProfile !== profile)) await closeCtx();
  if (!ctx) {
    ctx = await chromium.launchPersistentContext(profileDir(profile), {
      executablePath: config.chromePath, headless, viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'], locale: 'ko-KR'
    });
    ctxHeadless = headless;
    ctxProfile = profile;
    const mine = ctx;
    mine.on('close', () => { if (ctx === mine) ctx = null; });
    if (carried.get(profile)?.length) await ctx.addCookies(carried.get(profile)).catch(() => {});
  }
  return ctx;
}
// ponytail: 5분 쉬면 닫는다. 상시 띄워 둘 필요가 생기면 타이머를 빼면 된다.
const release = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => exclusive(closeCtx), 300_000); };

async function withPage(config, profile, work, headless) {
  return exclusive(async () => {
    const page = await (await context(config, profile, headless)).newPage();
    try { return await work(page); } finally { await page.close().catch(() => {}); release(); }
  });
}

// ---- 세션 ----
export async function session(config, profile) {
  return withPage(config, profile, async (page) => {
    const cookies = await page.context().cookies('https://nid.naver.com');
    const loggedIn = cookies.some((c) => c.name === 'NID_AUT') && cookies.some((c) => c.name === 'NID_SES');
    if (!loggedIn) return { loggedIn: false };
    // 내 블로그 주소로 보내 주는 경로에서 blogId를 읽는다
    await page.goto('https://blog.naver.com/MyBlog.naver', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const blogId = new URL(page.url()).pathname.split('/').filter(Boolean)[0] || '';
    return { loggedIn: true, blogId: /^[\w-]+$/.test(blogId) && blogId !== 'MyBlog.naver' ? blogId : '' };
  });
}

// 창을 띄우고 사람이 로그인할 때까지(최대 5분) 쿠키를 지켜본다.
export async function login(config, profile) {
  return exclusive(async () => {
    const page = await (await context(config, profile, false)).newPage();
    await page.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com%2F');
    const deadline = Date.now() + 300_000;
    try {
      while (Date.now() < deadline) {
        const cookies = await page.context().cookies('https://nid.naver.com');
        // 두 쿠키가 다 생기고 로그인 화면을 벗어난 뒤에 닫는다(리디렉트 도중에 닫으면 덜 저장된다)
        if (cookies.some((c) => c.name === 'NID_AUT') && cookies.some((c) => c.name === 'NID_SES') && !page.url().includes('nidlogin')) {
          await sleep(1500);
          return { loggedIn: true };
        }
        await sleep(1500);
      }
      return { loggedIn: false, error: '5분 안에 로그인이 끝나지 않았습니다' };
    } finally {
      await closeCtx(); // 다음 작업은 다시 headless로
    }
  });
}

// ---- 핫 키워드: 어드바이저 트렌드 > 주제별 인기유입검색어 (어제 기준) ----
// 화면이 직접 부르는 /api/v6/trend/category 응답을 받아 쓴다. 이 API는 화면 JS가 서명 헤더를 붙여야 해서
// 따로 부를 수 없다 → 화면을 열고, 주제를 3개씩 보여 주는 슬라이드를 넘겨 나머지 주제도 불러오게 한다.
// rankChange: 0 = 변동 없음, 양수 = 오름, 음수 = 내림, null = 새로 등장
export async function hotKeywords(config, profile) {
  return withPage(config, profile, async (page) => {
    const got = new Map();
    let date = '';
    page.on('response', async (r) => {
      if (!r.url().includes('/api/v6/trend/category?')) return;
      const body = await r.json().catch(() => null);
      date ||= new URL(r.url()).searchParams.get('date') || '';
      for (const { category, queryList } of body?.data || []) got.set(category, queryList || []);
    });
    await page.goto('https://creator-advisor.naver.com/', { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    const home = page.url().match(/^(https:\/\/creator-advisor\.naver\.com\/naver_blog\/[^/?#]+)/)?.[1];
    if (!home) throw new Error('어드바이저에 들어가지 못했습니다 — 설정 → 계정 관리에서 기본 네이버 계정에 로그인해 주세요');
    await page.goto(`${home}/trends`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    const swiper = '.u_ni_search_swiper';
    await page.locator(swiper).first().scrollIntoViewIfNeeded({ timeout: 15_000 }).catch(() => {});
    await sleep(1500);
    const slides = await page.evaluate((s) => document.querySelectorAll(`${s} .swiper-slide`).length, swiper);
    for (let i = 3; i < slides; i += 3) {
      await page.evaluate(([s, i]) => document.querySelector(s)?.swiper?.slideTo(i, 0), [swiper, i]);
      await sleep(1200);
    }
    await sleep(1500);
    if (!got.size) throw new Error('주제별 인기유입검색어를 받지 못했습니다 — 어드바이저 화면 구성이 바뀌었을 수 있습니다');
    return {
      date, channel: home.split('/').pop(), slides,
      categories: [...got].map(([category, list]) => ({
        category, items: list.map(({ query, rank, rankChange }) => ({ query, rank, change: rankChange ?? null }))
      }))
    };
  });
}

// ---- 화면 읽기 (리워드·숏텐츠). 로그인이 필요 없어서 기본 계정 프로필을 쓴다 ----
// withImages: 글에 쓸 만한 이미지 후보(대표 이미지 og:image + 화면의 큰 이미지)도 모은다. 쓸지 말지는 AI가 이미지 규칙으로 판단한다
export async function scrape(config, profile, url, waitMs = 4000, { withImages = false } = {}) {
  return withPage(config, profile, async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await sleep(waitMs);
    const text = await page.evaluate(() => document.body.innerText);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map((a) => ({ text: a.innerText.trim().slice(0, 60), href: a.href })).filter((l) => l.text));
    let images = [];
    if (withImages) {
      // 스크롤해야 불러오는 이미지가 많다 → 몇 화면 내려 본 뒤 모은다
      for (let i = 0; i < 6; i += 1) { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); await sleep(350); }
      images = await page.evaluate(() => {
        const abs = (u) => { try { return new URL(u, location.href).href; } catch { return ''; } };
        const meta = (sel) => document.querySelector(sel)?.content || '';
        const out = [];
        const og = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
        if (og) out.push({ src: abs(og), note: `대표 이미지 · ${meta('meta[property="og:title"]') || document.title}`.slice(0, 100) });
        for (const img of document.images) {
          const src = abs(img.currentSrc || img.src);
          if (img.naturalWidth < 400 || img.naturalHeight < 250 || !/^https?:/.test(src)) continue;
          if (/logo|icon|sprite|banner|badge|avatar|profile|tracking|pixel|\/ads?\//i.test(src)) continue;
          const caption = img.closest('figure')?.querySelector('figcaption')?.innerText || img.alt || img.title || '';
          out.push({ src, note: `${img.naturalWidth}×${img.naturalHeight}${caption.trim() ? ` · ${caption.trim().slice(0, 80)}` : ''}` });
        }
        const seen = new Set();
        return out.filter((x) => !seen.has(x.src) && seen.add(x.src)).slice(0, 12);
      });
    }
    return { url: page.url(), title: await page.title(), text, links, images };
  });
}

// ---- 공식 유튜브 영상 장면 캡처 (설정에서 켰을 때만, 서버 /api/youtube/frames가 부른다) ----
// 영상 파일은 받지 않는다. 브라우저로 영상 페이지를 열어 지정 시점으로 넘긴 뒤 플레이어 화면만 PNG로 찍는다.
// 플레이어 위 글자·버튼은 숨기고, 광고가 붙으면 끝날 때까지 기다린다(건너뛰기가 보이면 누른다).
const PLAYER_CLEAN = '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-ce-element,.ytp-pause-overlay,.ytp-paid-content-overlay,.ytp-spinner,.ytp-cued-thumbnail-overlay,.ytp-large-play-button,.ytp-watermark,.iv-branding,.ytp-autonav-endscreen-countdown-overlay,.ytp-tooltip,.ytp-cards-button,.ytp-cards-teaser,.ytp-iv-player-content,.ytp-overlay-top-right,.ytp-player-content{display:none!important}';
export async function youtubeFrames(config, profile, videoId, seconds, outDir, name = (s) => `영상화면_${s}.png`) {
  return withPage(config, profile, async (page) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForSelector('#movie_player video', { timeout: 30_000 });
    await page.addStyleTag({ content: PLAYER_CLEAN });
    const frames = [];
    for (const sec of seconds) {
      for (let i = 0; i < 90; i += 1) {
        const ad = await page.evaluate(() => document.querySelector('#movie_player')?.classList.contains('ad-showing'));
        if (!ad) break;
        await page.locator('.ytp-skip-ad-button, .ytp-ad-skip-button-modern').first().click({ timeout: 500 }).catch(() => {});
        await sleep(500);
      }
      const at = await page.evaluate(async (t) => {
        const v = document.querySelector('#movie_player video');
        v.muted = true;
        await v.play().catch(() => {});
        v.pause();
        if (Number.isFinite(v.duration) && t > v.duration) return null; // 영상보다 긴 시점
        await new Promise((done) => { const end = () => { v.removeEventListener('seeked', end); done(); }; v.addEventListener('seeked', end); v.currentTime = t; setTimeout(done, 8000); });
        return Math.round(v.currentTime);
      }, sec);
      if (at == null) { frames.push({ at: sec, error: '영상 길이를 넘는 시점' }); continue; }
      await sleep(800);
      const file = path.join(outDir, name(sec));
      await page.locator('#movie_player video').screenshot({ path: file });
      frames.push({ at, file });
    }
    return frames;
  });
}

// ---- 글 폴더 → 에디터 → 임시저장 ----
async function readPost(postDir) {
  const names = await fs.readdir(postDir);
  const htmlName = names.find((n) => /\.html?$/i.test(n));
  if (!htmlName) throw new Error(`HTML 없음: ${postDir}`);
  const html = await fs.readFile(path.join(postDir, htmlName), 'utf8');
  const meta = JSON.parse((await fs.readFile(path.join(postDir, 'meta.json'), 'utf8').catch(() => '{}')).replace(/^\uFEFF/, '')); // BOM 제거
  const images = {};
  const assets = path.join(postDir, 'assets');
  for (const name of await fs.readdir(assets).catch(() => [])) {
    const mime = MIME[path.extname(name).toLowerCase()];
    if (mime) images[name] = `data:${mime};base64,${(await fs.readFile(path.join(assets, name))).toString('base64')}`;
  }
  return { html, meta, images };
}

// 에디터 프레임 안에서 도는 코드. 확장 패널(panel.js insert)과 같은 순서다.
async function injectInFrame({ html, images, title, center }) {
  const call = (action, payload, timeout) => new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random()}`;
    const timer = setTimeout(() => { removeEventListener('message', on); reject(new Error(`TIMEOUT:${action}`)); }, timeout);
    function on(event) {
      if (event.data?.ns !== 'nbh-drv-res' || event.data.id !== id) return;
      clearTimeout(timer); removeEventListener('message', on);
      event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error));
    }
    addEventListener('message', on);
    postMessage({ ns: 'nbh-drv', id, action, payload }, '*');
  });
  const Html = globalThis.NBHHtml;
  const logs = [];
  // <style>을 인라인으로 내려야 색·크기가 산다 (panel.js renderWithComputedStyles)
  const styled = await new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-9999px;width:760px;height:600px';
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      let out = html;
      try { if (Html.inlineComputedStyles(frame.contentDocument)) out = frame.contentDocument.documentElement.outerHTML; } catch { /* 원본 */ }
      frame.remove(); resolve(out);
    };
    frame.addEventListener('load', finish, { once: true });
    setTimeout(finish, 2000);
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
  const article = Html.parseArticle(styled, (v) => new DOMParser().parseFromString(v, 'text/html'));
  if (!article.ok) throw new Error(`HTML 파싱 실패: ${article.error}`);
  await call('CLEAR', {}, 20000);

  const toPng = (dataUrl) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); resolve(c.toDataURL('image/png')); };
    img.onerror = reject; img.src = dataUrl;
  });
  const uploaded = new Map();
  for (const image of article.images) {
    const dataUrl = images[image.fileName];
    if (!dataUrl) { logs.push(`이미지 없음(자리표시로 대체): ${image.fileName}`); continue; }
    try {
      let component;
      try { component = await call('UPLOAD_IMAGE', { dataUrl, fileName: image.fileName }, 200000); } catch (error) {
        if (!/\.webp$/i.test(image.fileName)) throw error;
        component = await call('UPLOAD_IMAGE', { dataUrl: await toPng(dataUrl), fileName: image.fileName.replace(/\.webp$/i, '.png') }, 200000);
      }
      uploaded.set(image.token, component);
      logs.push(`업로드: ${image.fileName}`);
    } catch (error) { logs.push(`업로드 실패: ${image.fileName} ${error.message}`); }
  }
  let place = null;
  if (article.hasPlaceSlot) {
    try { place = (await call('INSERT_PLACE', { placeId: article.placeId, name: article.placeName }, 60000)).component; } catch (error) { logs.push(`장소 건너뜀: ${error.message}`); }
  }
  // 링크 카드·동영상: 주소를 붙여넣어 네이버가 만든 컴포넌트로 바꾼다
  const embedded = new Map();
  const createdIds = [];
  for (const { url, kind } of article.embeds || []) {
    if (embedded.has(url)) continue;
    try {
      const component = await call('PASTE_LINK', { url }, 40000);
      embedded.set(url, component);
      if (component.id) createdIds.push(component.id);
      logs.push(`${kind === 'video' ? '동영상' : '링크 카드'}: ${url}`);
    } catch (error) { logs.push(`${kind === 'video' ? '동영상' : '링크 카드'} 실패(주소 글자로 남김): ${url} ${error.message}`); }
  }
  let components = Html.fillImages(article.components, uploaded, place, embedded);
  if (center) components = Html.centerParagraphs(components);
  const uploadedIds = [...[...uploaded.values()].map((c) => c.id), ...createdIds].filter(Boolean);
  const result = await call('APPLY', { components, title: title || article.title, keepExisting: false, skipTitleIfPresent: false, uploadedIds }, 60000);
  return { logs, components: result.components, images: `${uploaded.size}/${article.images.length}`, embeds: `${embedded.size}/${(article.embeds || []).length}`, chars: article.stats.characters };
}

// account = 설정의 네이버 계정 { name, profile, blogId }
export async function saveDraft(config, account, postDir, log = () => {}) {
  if (!account?.blogId) throw new Error(`${account?.name || '네이버 계정'}의 블로그 아이디가 없습니다. 설정 → 계정 관리에서 세션 확인을 하거나 직접 적어 주세요.`);
  const post = await readPost(postDir);
  const [htmlJs, driverJs] = await Promise.all([fs.readFile(VENDOR.html, 'utf8'), fs.readFile(VENDOR.driver, 'utf8')]);
  return withPage(config, account.profile, async (page) => {
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(`https://blog.naver.com/${account.blogId}?Redirect=Write`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (/nid\.naver\.com/.test(page.url())) throw new Error(`${account.name} 로그인이 풀렸습니다. 설정 → 계정 관리에서 다시 로그인하세요.`);
    // SmartEditor가 올라온 프레임을 찾는다 (보통 #mainFrame)
    let frame = null;
    for (let i = 0; i < 60 && !frame; i += 1) {
      for (const f of page.frames()) {
        if (await f.evaluate(() => Boolean(window.SmartEditor?._editors && Object.keys(window.SmartEditor._editors).length)).catch(() => false)) { frame = f; break; }
      }
      if (!frame) await sleep(500);
    }
    if (!frame) {
      // 블로그 아이디가 틀리면 네이버가 '해당 블로그가 없습니다' 화면을 띄워 에디터가 안 나온다
      if (await page.getByText('해당 블로그가 없습니다').count().catch(() => 0)) {
        throw new Error(`블로그 아이디 '${account.blogId}'로는 블로그가 없습니다. 설정 → 계정 관리에서 세션 확인을 누르면 맞는 아이디로 고쳐집니다.`);
      }
      throw new Error('에디터를 찾지 못했습니다');
    }
    // "작성 중인 글이 있습니다" 복구 팝업 → 새로 쓰기(취소)
    await frame.locator('.se-popup-button-cancel').click({ timeout: 3000 }).catch(() => {});
    await frame.addScriptTag({ content: htmlJs });
    await frame.addScriptTag({ content: driverJs });
    log('에디터 준비됨 · 본문 주입 시작');
    const result = await frame.evaluate(injectInFrame, {
      html: post.html, images: post.images, title: post.meta.title, center: post.meta.category_code === 'B'
    });
    result.logs.forEach((line) => log(line));
    log(`주입 완료 · 컴포넌트 ${result.components}개 · 이미지 ${result.images}${result.embeds !== '0/0' ? ` · 링크·영상 ${result.embeds}` : ''} · ${result.chars}자`);
    await sleep(1500);
    // 임시저장 = 상단 "저장" 버튼 (발행 아님)
    const save = frame.locator('button').filter({ hasText: /^\s*저장\s*$/ }).first();
    await save.click({ timeout: 10_000 });
    await sleep(3000);
    log('임시저장 클릭 완료');
    return result;
  });
}
