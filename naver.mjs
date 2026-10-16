// 네이버 쪽 작업 전부. 전용 크롬 프로필 하나를 백그라운드(headless)로 띄워 쓴다.
// 로그인은 처음 한 번만 창을 띄워 사람이 직접 한다 — 비밀번호를 코드가 다루지 않는다.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(HERE, 'data', 'chrome-profile');
const VENDOR = { html: path.join(HERE, 'vendor', 'html.js'), driver: path.join(HERE, 'vendor', 'driver.js') };
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// 프로필은 한 프로세스만 열 수 있다 → 모든 브라우저 작업을 한 줄로 세운다.
let queue = Promise.resolve();
let ctx = null;
let ctxHeadless = null;
let idleTimer = null;
// 네이버 로그인 쿠키(NID_SES 등)는 '로그인 상태 유지'를 안 켜면 세션 쿠키라 크롬을 닫으면 사라진다.
// 창을 닫았다 다시 열 때(로그인 창 → headless, 5분 쉬고 재시작) 메모리로 넘겨 준다. 디스크에는 안 쓴다.
// ponytail: 서버를 재시작하면 사라진다 — 그때는 '로그인 상태 유지'를 켜고 로그인하면 된다.
let carried = [];
async function closeCtx() {
  if (!ctx) return;
  const c = ctx; ctx = null;
  carried = (await c.cookies().catch(() => [])).filter((k) => k.expires === -1 && /naver\.com$/.test(k.domain));
  await c.close().catch(() => {});
}
const exclusive = (job) => { const run = queue.then(job, job); queue = run.catch(() => {}); return run; };

async function context(config, headless = config.headless !== false) {
  clearTimeout(idleTimer);
  if (ctx && ctxHeadless !== headless) await closeCtx();
  if (!ctx) {
    ctx = await chromium.launchPersistentContext(PROFILE, {
      executablePath: config.chromePath, headless, viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'], locale: 'ko-KR'
    });
    ctxHeadless = headless;
    const mine = ctx;
    mine.on('close', () => { if (ctx === mine) ctx = null; });
    if (carried.length) await ctx.addCookies(carried).catch(() => {});
  }
  return ctx;
}
// ponytail: 5분 쉬면 닫는다. 상시 띄워 둘 필요가 생기면 타이머를 빼면 된다.
const release = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => exclusive(closeCtx), 300_000); };

async function withPage(config, work, headless) {
  return exclusive(async () => {
    const page = await (await context(config, headless)).newPage();
    try { return await work(page); } finally { await page.close().catch(() => {}); release(); }
  });
}

// ---- 세션 ----
export async function session(config) {
  return withPage(config, async (page) => {
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
export async function login(config) {
  return exclusive(async () => {
    const page = await (await context(config, false)).newPage();
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
export async function hotKeywords(config) {
  return withPage(config, async (page) => {
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
    if (!home) throw new Error('어드바이저에 들어가지 못했습니다 — 대시보드에서 네이버 로그인을 먼저 해 주세요');
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

// ---- 화면 읽기 (리워드·숏텐츠) ----
export async function scrape(config, url, waitMs = 4000) {
  return withPage(config, async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await sleep(waitMs);
    const text = await page.evaluate(() => document.body.innerText);
    const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map((a) => ({ text: a.innerText.trim().slice(0, 60), href: a.href })).filter((l) => l.text));
    return { url: page.url(), title: await page.title(), text, links };
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
  let components = Html.fillImages(article.components, uploaded, place);
  if (center) components = Html.centerParagraphs(components);
  const uploadedIds = [...uploaded.values()].map((c) => c.id).filter(Boolean);
  const result = await call('APPLY', { components, title: title || article.title, keepExisting: false, skipTitleIfPresent: false, uploadedIds }, 60000);
  return { logs, components: result.components, images: `${uploaded.size}/${article.images.length}`, chars: article.stats.characters };
}

export async function saveDraft(config, postDir, log = () => {}) {
  if (!config.blogId) throw new Error('blogId가 없습니다. 대시보드에서 세션 확인을 먼저 하세요.');
  const post = await readPost(postDir);
  const [htmlJs, driverJs] = await Promise.all([fs.readFile(VENDOR.html, 'utf8'), fs.readFile(VENDOR.driver, 'utf8')]);
  return withPage(config, async (page) => {
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (/nid\.naver\.com/.test(page.url())) throw new Error('로그인이 풀렸습니다. 대시보드에서 다시 로그인하세요.');
    // SmartEditor가 올라온 프레임을 찾는다 (보통 #mainFrame)
    let frame = null;
    for (let i = 0; i < 60 && !frame; i += 1) {
      for (const f of page.frames()) {
        if (await f.evaluate(() => Boolean(window.SmartEditor?._editors && Object.keys(window.SmartEditor._editors).length)).catch(() => false)) { frame = f; break; }
      }
      if (!frame) await sleep(500);
    }
    if (!frame) throw new Error('에디터를 찾지 못했습니다');
    // "작성 중인 글이 있습니다" 복구 팝업 → 새로 쓰기(취소)
    await frame.locator('.se-popup-button-cancel').click({ timeout: 3000 }).catch(() => {});
    await frame.addScriptTag({ content: htmlJs });
    await frame.addScriptTag({ content: driverJs });
    log('에디터 준비됨 · 본문 주입 시작');
    const result = await frame.evaluate(injectInFrame, {
      html: post.html, images: post.images, title: post.meta.title, center: post.meta.category_code === 'B'
    });
    result.logs.forEach((line) => log(line));
    log(`주입 완료 · 컴포넌트 ${result.components}개 · 이미지 ${result.images} · ${result.chars}자`);
    await sleep(1500);
    // 임시저장 = 상단 "저장" 버튼 (발행 아님)
    const save = frame.locator('button').filter({ hasText: /^\s*저장\s*$/ }).first();
    await save.click({ timeout: 10_000 });
    await sleep(3000);
    log('임시저장 클릭 완료');
    return result;
  });
}
