// 댓글 답방에서 네이버 화면을 읽고 쓰는 부분. 모두 naver.usePage가 넘겨준 page(전용 프로필, 대기열 한 줄) 위에서 돈다.
// server.mjs는 이 파일을 부를 때마다 새로 읽는다(nvVisits) — 네이버 화면 구조가 바뀌어 고쳐야 할 때 서버를 다시 켜지 않아도 된다.
// (로그인 상태 유지가 꺼져 있으면 서버를 다시 켤 때 로그인이 풀리기 때문)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// JSON 안에서 조건에 맞는 객체를 모두 찾는다
function walk(value, test, out = []) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, test, out));
  else if (value && typeof value === 'object') { if (test(value)) out.push(value); Object.values(value).forEach((v) => walk(v, test, out)); }
  return out;
}
const firstKey = (o, keys) => keys.map((k) => o[k]).find((v) => v != null && v !== '');

// ---- 내소식의 댓글 알림 → [{ id, at, author:{name, blogId}, comment, myPost:{title, logNo} }] ----
// 화면이 받는 JSON을 가로채 읽는다(링크가 전부 '#'라 화면 글자만으로는 작성자 블로그를 알 수 없다)
export async function myNewsComments(page) {
  const bodies = [];
  page.on('response', async (r) => {
    if (!/json/.test(r.headers()['content-type'] || '') || !/news|noti|alarm|activity/i.test(r.url())) return;
    const json = await r.json().catch(() => null);
    if (json) bodies.push({ url: r.url(), json });
  });
  await page.goto('https://m.blog.naver.com/News.naver', { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  await sleep(1500);
  const items = walk(bodies.map((b) => b.json), (o) => {
    const kind = String(firstKey(o, ['type', 'newsType', 'category', 'activityType', 'noticeType']) || '');
    const author = firstKey(o, ['senderBlogId', 'actorBlogId', 'fromBlogId', 'writerBlogId', 'blogId']);
    const text = firstKey(o, ['contents', 'content', 'commentContents', 'message', 'text']);
    return /comment/i.test(kind) && !/reply/i.test(kind) && author && text;
  });
  return items.map((o) => ({
    id: String(firstKey(o, ['commentNo', 'commentId', 'newsNo', 'id', 'seq']) || `${firstKey(o, ['senderBlogId', 'actorBlogId', 'fromBlogId', 'writerBlogId', 'blogId'])}-${firstKey(o, ['addDate', 'regDate', 'createdAt', 'date'])}`),
    at: String(firstKey(o, ['addDate', 'regDate', 'createdAt', 'date']) || ''),
    author: { name: String(firstKey(o, ['senderNickName', 'actorNickName', 'nickName', 'nickname', 'name']) || ''), blogId: String(firstKey(o, ['senderBlogId', 'actorBlogId', 'fromBlogId', 'writerBlogId', 'blogId'])) },
    comment: String(firstKey(o, ['contents', 'content', 'commentContents', 'message', 'text']) || '').slice(0, 300),
    myPost: { title: String(firstKey(o, ['postTitle', 'title', 'logTitle']) || ''), logNo: String(firstKey(o, ['logNo', 'postNo']) || '') }
  }));
}

// ---- 서로이웃 블로그 아이디 목록 (이웃 관리 화면, 여러 쪽) ----
export async function mutualBuddies(page, blogId) {
  const ids = new Set();
  for (let p = 1; p <= 30; p += 1) {
    await page.goto(`https://admin.blog.naver.com/BuddyListManage.naver?blogId=${blogId}&currentPage=${p}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(800);
    const rows = await page.evaluate(() => [...document.querySelectorAll('tr')].filter((tr) => /서로이웃/.test(tr.innerText) && !/이웃전체/.test(tr.innerText))
      .map((tr) => [...tr.querySelectorAll('a[href]')].map((a) => a.href).join(' ')));
    const before = ids.size;
    for (const hrefs of rows) {
      const m = hrefs.match(/blog\.naver\.com\/(?:PostList\.naver\?blogId=)?([\w-]+)/) || hrefs.match(/[?&]blogId=([\w-]+)/);
      if (m && m[1] !== blogId) ids.add(m[1]);
    }
    if (ids.size === before) break; // 더 쪽이 없다
  }
  return [...ids];
}

// ---- 답방 댓글 달기: 모바일 댓글 화면에서 입력 → 등록 → 내 댓글이 보이는지 확인 ----
export async function postComment(page, postUrl, text) {
  const m = postUrl.match(/blog\.naver\.com\/([\w-]+)\/(\d+)/);
  if (!m) throw new Error('글 주소가 이상합니다');
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${m[1]}&logNo=${m[2]}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  const box = page.locator('.u_cbox_text, textarea.u_cbox_text, [contenteditable="true"].u_cbox_text_mention').first();
  await box.waitFor({ timeout: 15_000 }).catch(() => { throw new Error('댓글 입력창을 찾지 못했습니다(댓글이 막힌 글이거나 화면이 바뀜)'); });
  await box.click();
  await page.keyboard.type(text, { delay: 25 });
  await page.locator('.u_cbox_btn_upload').first().click({ timeout: 10_000 });
  // 등록됐는지: 방금 쓴 글이 목록에 보일 때까지
  const head = text.slice(0, 12);
  for (let i = 0; i < 20; i += 1) {
    if (await page.evaluate((h) => [...document.querySelectorAll('.u_cbox_contents')].some((e) => e.innerText.includes(h)), head)) return { ok: true };
    await sleep(500);
  }
  throw new Error('등록 버튼은 눌렀지만 댓글이 목록에 보이지 않습니다. 직접 확인해 주세요');
}

// ---- 조사용(읽기만): 화면 구조를 data/visit-probe.json에 남긴다 ----
export async function probe(page, { blogId, postUrl } = {}) {
  const out = { news: [], newsDom: [], buddy: null, comment: null };
  page.on('response', async (r) => {
    if (!/json/.test(r.headers()['content-type'] || '')) return;
    if (/jackpotlog|ab-test|popular-keywords|place-list/.test(r.url())) return;
    out.news.push({ url: r.url(), body: (await r.text().catch(() => '')).slice(0, 4000) });
  });
  await page.goto('https://m.blog.naver.com/News.naver', { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
  await sleep(2000);
  out.newsUrl = page.url();
  out.newsDom = await page.evaluate(() => [...document.querySelectorAll('li')].filter((li) => /댓글을 남겼습니다/.test(li.innerText)).slice(0, 3).map((li) => li.outerHTML.slice(0, 2500)));
  page.removeAllListeners('response');
  await page.goto(`https://admin.blog.naver.com/BuddyListManage.naver?blogId=${blogId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  await sleep(1500);
  out.buddy = await page.evaluate(() => ({
    row: [...document.querySelectorAll('tr')].find((tr) => /서로이웃/.test(tr.innerText) && !/이웃전체/.test(tr.innerText))?.outerHTML.slice(0, 3000),
    paging: [...document.querySelectorAll('a')].filter((a) => /^\s*\d+\s*$/.test(a.innerText)).slice(0, 6).map((a) => ({ text: a.innerText.trim(), href: a.getAttribute('href'), onclick: a.getAttribute('onclick') }))
  }));
  if (postUrl) {
    const m = postUrl.match(/blog\.naver\.com\/([\w-]+)\/(\d+)/);
    await page.goto(`https://m.blog.naver.com/CommentList.naver?blogId=${m[1]}&logNo=${m[2]}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
    await sleep(1500);
    out.comment = await page.evaluate(() => ({
      url: location.href,
      inputs: [...document.querySelectorAll('textarea, [contenteditable="true"], button, .u_cbox_btn_upload')].slice(0, 15).map((e) => e.outerHTML.slice(0, 400)),
      write: document.querySelector('.u_cbox_write_wrap, .u_cbox_write')?.outerHTML.slice(0, 3000) || null
    }));
  }
  return out;
}
