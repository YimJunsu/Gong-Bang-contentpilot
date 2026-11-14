// 댓글 답방(반자동): 내 글에 댓글을 단 서로이웃의 최근 글에 답방 댓글을 단다. 보내기는 사람이 누른다.
// 이 파일은 브라우저·AI 없이 도는 부분만 — 저장소, 고를 대상, 보내기 제한, AI 초안 프롬프트와 결과 읽기.
// 네이버 화면을 읽고 쓰는 부분은 naver.mjs(myNewsComments·mutualBuddies·postComment), 순서는 server.mjs의 visit 작업.

export const LIMITS = {
  perRun: 10, // 한 번 '답방 준비'에서 초안을 만드는 최대 수
  perDay: 20, // 하루 보내기 최대 수
  gapSec: 30, // 보내기 사이 최소 간격
  sameAuthorDays: 7 // 같은 사람에게는 이 기간에 한 번만
};

export const emptyStore = () => ({ items: {}, buddies: { at: null, ids: [] }, lastPrepare: null });

const DAY = 86400_000;
const dayKey = (iso) => new Date(iso).toLocaleDateString('sv-SE');

// 내소식에서 읽은 댓글들을 저장소에 더한다. 이미 있는 댓글(id 같음)은 건드리지 않는다
export function mergeComments(store, comments, now = new Date().toISOString()) {
  let added = 0;
  for (const c of comments) {
    if (!c?.id || !c.author?.blogId || store.items[c.id]) continue;
    store.items[c.id] = { ...c, status: 'new', foundAt: now };
    added += 1;
  }
  return added;
}

// 초안을 만들 대상: 새 댓글 중 서로이웃이고, 내 블로그가 아니고, 최근에 그 사람에게 보냈거나 준비 중인 게 없는 것
export function pickTargets(store, { myBlogId, buddyIds, now = Date.now(), limit = LIMITS.perRun }) {
  const buddies = new Set(buddyIds);
  const recentAuthors = new Set(Object.values(store.items)
    .filter((it) => ['drafted', 'sent'].includes(it.status) && now - Date.parse(it.sentAt || it.draftedAt || it.foundAt) < LIMITS.sameAuthorDays * DAY)
    .map((it) => it.author.blogId));
  const out = [];
  for (const it of Object.values(store.items).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))) {
    if (out.length >= limit) break;
    if (it.status !== 'new') continue;
    const id = it.author.blogId;
    if (id === myBlogId) { it.status = 'skipped'; it.reason = '내 블로그'; continue; }
    if (!buddies.has(id)) { it.status = 'skipped'; it.reason = '서로이웃 아님'; continue; }
    if (recentAuthors.has(id)) { it.status = 'skipped'; it.reason = `최근 ${LIMITS.sameAuthorDays}일 안에 답방함`; continue; }
    recentAuthors.add(id);
    out.push(it);
  }
  return out;
}

// 보내기 전에 막을 것: 하루 상한, 간격, 상태
export function sendBlock(store, item, now = Date.now()) {
  if (!item) return '답방 항목이 없습니다';
  if (item.status === 'sent') return '이미 보낸 댓글입니다';
  if (!item.target?.url) return '답방할 글이 없습니다';
  const sent = Object.values(store.items).filter((it) => it.status === 'sent' && it.sentAt);
  const today = dayKey(new Date(now).toISOString());
  if (sent.filter((it) => dayKey(it.sentAt) === today).length >= LIMITS.perDay) return `오늘은 ${LIMITS.perDay}개까지 보냈습니다. 내일 다시 보내 주세요`;
  const last = Math.max(0, ...sent.map((it) => Date.parse(it.sentAt)));
  const wait = Math.ceil((last + LIMITS.gapSec * 1000 - now) / 1000);
  if (wait > 0) return `너무 빨리 보내고 있습니다. ${wait}초 뒤에 보내 주세요`;
  return '';
}

// AI 한 번에 여러 초안을 받는다. 결과는 JSON 하나
export function draftPrompt(targets) {
  return [
    '네이버 블로그 답방 댓글 초안을 쓴다. 아래 각 글은 내 글에 댓글을 남겨 준 서로이웃의 최근 글이다.',
    '규칙:',
    '- 글마다 2~3문장, 한국어, 블로그 이웃끼리 쓰는 다정한 말투(-요). 전체 120자 안팎.',
    '- 그 글의 구체적인 내용 하나(장소·메뉴·숫자·사진 속 장면·팁)를 집어 자연스럽게 반응한다. 글 제목만 보고 쓴 티가 나는 일반적인 칭찬("좋은 글 잘 보고 가요")은 쓰지 않는다.',
    '- 마지막에 들러 줘서 고맙다는 말을 짧게 붙인다(예: "들러 주셔서 감사해요!"). 매번 같은 문장으로 끝내지 않는다.',
    '- 광고·홍보 문구, 내 블로그 주소·링크, 이모지 남발(최대 1개), 과장된 감탄은 쓰지 않는다.',
    '- 글 내용이 부고·질병·사고·이별처럼 민감하거나, 내용을 읽을 수 없으면 쓰지 말고 skip을 true로, reason에 이유를 쓴다.',
    '- 파일은 만들지 말고, 아래 형식의 JSON 하나만 출력한다:',
    '{"drafts":[{"id":"입력의 id","text":"댓글","skip":false,"reason":""}]}',
    '',
    ...targets.flatMap((t) => [
      `=== id: ${t.id}`,
      `이웃: ${t.author.name}`,
      `내 글에 남긴 댓글: ${t.comment || '(없음)'}`,
      `이웃의 최근 글 제목: ${t.target?.title || ''}`,
      `이웃의 최근 글 내용(앞부분):\n${String(t.target?.text || '').slice(0, 1800)}`,
      ''
    ])
  ].join('\n');
}

// AI 결과를 저장소에 반영한다. 돌려준 id만, 빈 글은 넣지 않는다
export function applyDrafts(store, parsed, now = new Date().toISOString()) {
  let drafted = 0;
  for (const d of parsed?.drafts || []) {
    const it = store.items[d.id];
    if (!it || it.status !== 'preparing') continue;
    if (d.skip || !String(d.text || '').trim()) { it.status = 'skipped'; it.reason = d.reason || 'AI가 건너뜀'; continue; }
    it.draft = String(d.text).trim().slice(0, 300);
    it.status = 'drafted';
    it.draftedAt = now;
    drafted += 1;
  }
  return drafted;
}

// 이웃의 가장 최근 글: 블로그 RSS(로그인 필요 없음). 모바일 주소로 돌려준다
export async function latestPost(blogId) {
  if (!/^[\w-]+$/.test(blogId)) throw new Error('블로그 아이디가 이상합니다');
  const xml = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, { redirect: 'follow', signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`RSS ${r.status}`))));
  const item = xml.match(/<item>([\s\S]*?)<\/item>/)?.[1];
  if (!item) throw new Error('RSS에 글이 없음');
  const pick = (tag) => (item.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))?.[1] || '').trim();
  const link = pick('link');
  const m = link.match(/blog\.naver\.com\/([\w-]+)\/(\d+)/);
  if (!m) throw new Error('글 주소를 읽지 못함');
  return { title: pick('title'), url: `https://m.blog.naver.com/${m[1]}/${m[2]}`, blogId: m[1], logNo: m[2], at: pick('pubDate') };
}

