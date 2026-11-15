// 댓글 답방에서 네이버 화면을 읽고 쓰는 부분. 모두 naver.usePage가 넘겨준 page(전용 프로필, 대기열 한 줄) 위에서 돈다.
// server.mjs는 이 파일을 부를 때마다 새로 읽는다(nvVisits) — 네이버 화면 구조가 바뀌어 고쳐야 할 때 서버를 다시 켜지 않아도 된다.
// (로그인 상태 유지가 꺼져 있으면 서버를 다시 켤 때 로그인이 풀리기 때문)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 내소식의 댓글 알림 → [{ id, at, author:{name, blogId}, comment, myPost:{title, url} }] ----
// 내소식 화면이 부르는 news-list API를 같은 로그인으로 직접 부른다(2026-11-15 실측: items[].commcastCategoryType
// = BLOG_COMMENT(내 글 댓글) / BLOG_COMMENT_REPLY(내 댓글의 답글) / BLOG_SYMPATHY / BUDDY_*, writerId = 작성자 블로그 아이디)
export async function myNewsComments(page, blogId) {
  await page.goto('https://m.blog.naver.com/News.naver', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  // 로그인이 안 돼 있으면 내소식 대신 탐색 화면으로 넘어간다
  if (!/News\.naver/.test(page.url())) throw new Error('네이버 로그인이 필요합니다. 설정 → 계정 관리에서 다시 로그인해 주세요');
  // 블로그 아이디를 안 받았으면 화면의 로그인 정보(current-user)에서 읽는다
  if (!blogId) blogId = await page.evaluate(async () => (await (await fetch('/api/current-user', { credentials: 'include' })).json())?.result?.userId || '');
  if (!blogId) throw new Error('내 블로그 아이디를 알 수 없습니다');
  const items = await page.evaluate(async (id) => {
    const r = await fetch(`/api/blogs/${id}/news-list?isMrBlogView=false&isUnread=false`, { credentials: 'include' });
    if (!r.ok) throw new Error(`내소식 목록을 못 읽음(${r.status})`);
    return (await r.json())?.result?.newsListView?.items || [];
  }, blogId);
  return items.filter((i) => i.commcastCategoryType === 'BLOG_COMMENT' && i.writerId && i.writerId !== blogId)
    .map((i) => ({
      id: String(i.commentNo ?? i.createKeyString),
      at: new Date(i.createTime).toISOString(),
      author: { name: i.writerNickname || i.writerId, blogId: i.writerId },
      comment: String(i.content || '').slice(0, 300),
      myPost: { title: i.title || '', url: String(i.url || '').replace(/^http:/, 'https:') }
    }));
}

// ---- 서로이웃 블로그 아이디 목록 (이웃 관리 화면, 쪽마다 currentPage) ----
// 줄 구조(2026-11-15 실측): <td class="type"><span class="both">서로이웃</span> … <a href="https://blog.naver.com/아이디">
export async function mutualBuddies(page, blogId) {
  const ids = new Set();
  let prev = '';
  for (let p = 1; p <= 40; p += 1) {
    await page.goto(`https://admin.blog.naver.com/BuddyListManage.naver?blogId=${blogId}&currentPage=${p}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const rows = await page.evaluate(() => [...document.querySelectorAll('tr')].map((tr) => ({
      both: Boolean(tr.querySelector('td.type .both')),
      href: tr.querySelector('td.buddy a[href*="blog.naver.com/"]')?.href || ''
    })).filter((r) => r.href));
    const key = rows.map((r) => r.href).join(' ');
    if (!rows.length || key === prev) break; // 마지막 쪽을 지났다
    prev = key;
    for (const r of rows) {
      const m = r.both && r.href.match(/blog\.naver\.com\/([\w-]+)/);
      if (m && m[1] !== blogId) ids.add(m[1]);
    }
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
  out.newsApi = await page.evaluate(async (id) => {
    const r = await fetch(`/api/blogs/${id}/news-list?isMrBlogView=false&isUnread=false`, { credentials: 'include' });
    const j = await r.json();
    const items = j?.result?.newsListView?.items || [];
    return { keys: Object.keys(j?.result?.newsListView || {}), types: [...new Set(items.map((i) => i.commcastCategoryType))], comment: items.filter((i) => /COMMENT|REPLY/.test(i.commcastCategoryType)).slice(0, 3), total: items.length };
  }, blogId);
  out.newsDom = await page.evaluate(() => [...document.querySelectorAll('li')].filter((li) => /댓글을 남겼습니다/.test(li.innerText)).slice(0, 3).map((li) => li.outerHTML.slice(0, 2500)));
  page.removeAllListeners('response');
  await page.goto(`https://admin.blog.naver.com/BuddyListManage.naver?blogId=${blogId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
  await sleep(1500);
  out.buddy = await page.evaluate(() => ({
    row: [...document.querySelectorAll('tr')].find((tr) => /서로이웃/.test(tr.innerText) && !/이웃전체/.test(tr.innerText))?.outerHTML.slice(0, 3000),
    goPage: typeof window.goPage === 'function' ? window.goPage.toString().slice(0, 800) : null,
    forms: [...document.forms].map((f) => ({ name: f.name, action: f.action, inputs: [...f.elements].map((e) => `${e.name}=${e.value}`).slice(0, 15) })),
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
