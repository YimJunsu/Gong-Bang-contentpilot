// 공개 목록 메타데이터만 모은다. 화면 조회와 외부 요청은 분리한다.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export const SOURCES = [
  { id: 'dinnerqueen', name: '디너의여왕', baseUrl: 'https://dinnerqueen.net', listPath: '/taste', termsPath: '/policy?ver=service', available: true },
  { id: 'gangnam', name: '강남맛집', baseUrl: 'https://강남맛집.net', listPath: '/cp/', termsPath: '/doc/use.html', available: true },
  { id: 'seoulouba', name: '서울오빠', baseUrl: 'https://www.seoulouba.co.kr', available: false, reason: 'robots.txt에서 공고 경로 수집을 제한합니다. 원본 사이트에서 확인하세요.' },
  { id: 'revu', name: '레뷰', baseUrl: 'https://www.revu.net', available: false, reason: '공개 목록·운영정책 확인 전입니다. 원본 사이트에서 확인하세요.' },
  { id: 'reviewnote', name: '리뷰노트', baseUrl: 'https://www.reviewnote.co.kr', available: false, reason: '운영정책 제6조에서 자동 수집을 제한합니다. 원본 사이트에서 확인하세요.' }
];
export const CATEGORIES = { FOOD: '맛집', CAFE: '카페', BEAUTY: '뷰티', LIFE: '생활', TRAVEL: '여행', KIDS: '육아', PET: '반려', DIGITAL: '디지털', ETC: '기타' };
export const TYPES = { VISIT: '방문', DELIVERY: '배송', REPORTER: '기자단', ETC: '기타' };
export const SIDOS = ['서울', '경기', '인천', '강원', '충북', '충남', '대전', '세종', '전북', '전남', '광주', '경북', '경남', '대구', '울산', '부산', '제주'];
const SIDO_ALIASES = { 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 강원특별자치도: '강원', 제주특별자치도: '제주' };
const SEOUL_GUS = '강남 강동 강북 강서 관악 광진 구로 금천 노원 도봉 동대문 동작 마포 서대문 서초 성동 성북 송파 양천 영등포 용산 은평 종로 중 중랑'.split(' ');
const METRO_GUS = { 서울: SEOUL_GUS.join(' '), 인천: '중 동 미추홀 연수 남동 부평 계양 서 영종 제물포 검단', 대구: '중 동 서 남 북 수성 달서', 대전: '동 중 서 유성 대덕', 광주: '동 서 남 북 광산', 울산: '중 남 동 북', 부산: '중 서 동 영도 부산진 동래 남 북 해운대 사하 금정 강서 연제 수영 사상' };
const GUNS = {
  경기: '가평 양평 연천', 인천: '강화 옹진', 부산: '기장', 대구: '달성 군위', 울산: '울주',
  강원: '홍천 횡성 영월 평창 정선 철원 화천 양구 인제 고성 양양', 충북: '보은 옥천 영동 증평 진천 괴산 음성 단양',
  충남: '금산 부여 서천 청양 홍성 예산 태안', 전북: '완주 진안 무주 장수 임실 순창 고창 부안',
  전남: '담양 곡성 구례 고흥 보성 화순 장흥 강진 해남 영암 무안 함평 영광 장성 완도 진도 신안',
  경북: '의성 청송 영양 영덕 청도 고령 성주 칠곡 예천 봉화 울진 울릉', 경남: '의령 함안 창녕 고성 남해 하동 산청 함양 거창 합천'
};
const CITIES = '수원 성남 고양 용인 부천 안산 안양 남양주 화성 평택 의정부 시흥 파주 광명 김포 군포 이천 양주 오산 구리 안성 포천 의왕 하남 과천 춘천 원주 강릉 동해 태백 속초 삼척 청주 충주 제천 천안 공주 보령 아산 서산 논산 계룡 당진 전주 군산 익산 정읍 남원 김제 목포 여수 순천 나주 광양 포항 경주 김천 안동 구미 영주 영천 상주 문경 경산 창원 진주 통영 사천 김해 밀양 거제 양산 서귀포'.split(' ');
const STATIONS = { 강남역: ['서울', '강남구'], 역삼역: ['서울', '강남구'], 선릉역: ['서울', '강남구'], 홍대입구역: ['서울', '마포구'], 합정역: ['서울', '마포구'], 잠실역: ['서울', '송파구'], 건대입구역: ['서울', '광진구'] };
const EVERY = 180 * 60_000;
const USER_AGENT = 'ContentPilot/0.2 (+https://github.com/YimJunsu/Gong-Bang-contentpilot)';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const clean = (html = '') => String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
  const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, (s) => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[s]).replace(/\s+/g, ' ').trim();
const attr = (html, name) => clean(html.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] || '');
const elementText = (html, tag, cls) => clean(html.match(new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
const number = (s) => s == null || s === '' ? null : Number(String(s).replace(/,/g, ''));
const daysLeft = (text) => /오늘|D\s*-?\s*day|D\s*-\s*0/i.test(text) ? 0 : number(text.match(/(\d+)\s*일\s*(?:남음|남았)/)?.[1] ?? text.match(/D\s*-\s*(\d+)/i)?.[1]);
const isClosed = (text) => /선정\s*중|모집\s*종료|신청\s*마감|모집\s*마감|종료된/.test(text) && !/오늘|D\s*-\s*0/i.test(text);
const webUrl = (value, base) => { try { const u = new URL(value, base); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const kstDay = (now) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
const dDay = (end, now) => end ? Math.round((Date.parse(`${kstDay(Date.parse(end))}T00:00:00+09:00`) - Date.parse(`${kstDay(now)}T00:00:00+09:00`)) / 86400_000) : null;

export function parseDinner(html) {
  const blocks = String(html).replace(/<!--[\s\S]*?-->/g, '').split(/<div\b[^>]*class=["']qz-dq-card campaign\b[^"']*["'][^>]*>/i).slice(1);
  return blocks.flatMap((tail) => {
    let depth = 1, end = tail.length;
    for (const tag of tail.matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += tag[0][1] === '/' ? -1 : 1;
      if (!depth) { end = tag.index; break; }
    }
    const block = tail.slice(0, end);
    const link = block.match(/<a\b[^>]*href=["'](?:https:\/\/dinnerqueen\.net)?\/taste\/(\d+)["'][^>]*>/i);
    if (!link || /qz_b_(?:reels|clip|insta|youtube)|\[(?:릴스|클립|인스타|유튜브)\]/i.test(block)) return [];
    const text = clean(block);
    const counts = text.match(/신청\s*([\d,]+)\s*\/\s*(?:모집\s*)?([\d,]+)/);
    const title = attr(block.match(/<img\b[^>]*>/i)?.[0] || '', 'alt') || attr(link[0], 'title').replace(/\s*신청하기$/, '');
    return [{ externalId: link[1], title, detailUrl: `/taste/${link[1]}`, thumbnailUrl: attr(block.match(/<img\b[^>]*>/i)?.[0] || '', 'src'),
      type: /기자단/.test(text) ? 'REPORTER' : /qz_b_pandora_box|>\s*배송\s*</.test(block) ? 'DELIVERY' : 'VISIT',
      categoryRaw: elementText(block, 'div', 'qz-dq-card__badge-row'), reward: elementText(block, 'p', 'color-placeholder'),
      recruitCount: number(counts?.[2]), applicantCount: number(counts?.[1]), dDay: daysLeft(elementText(block, 'p', 'dday')), closed: isClosed(elementText(block, 'p', 'dday')),
      point: number(text.match(/([\d,]+)\s*(?:P|포인트)\b/i)?.[1]) || 0 }];
  });
}

export function parseGangnam(html) {
  return [...String(html).matchAll(/<li\b[^>]*class=["'][^"']*\blist_item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)].flatMap(([block]) => {
    if (!/<em\b[^>]*class=["']blog["']/i.test(block)) return [];
    const id = block.match(/\/cp\/\?id=(\d+)/)?.[1];
    if (!id) return [];
    const text = clean(block);
    const counts = text.match(/신청\s*([\d,]+)\s*\/\s*모집\s*([\d,]+)/);
    const typeText = elementText(block, 'em', 'type');
    return [{ externalId: id, title: elementText(block, 'dt', 'tit'), detailUrl: `/cp/?id=${id}`, thumbnailUrl: attr(block.match(/<img\b[^>]*>/i)?.[0] || '', 'src'),
      type: /배송/.test(typeText) ? 'DELIVERY' : /기자단/.test(typeText) ? 'REPORTER' : /방문|포장/.test(typeText) ? 'VISIT' : 'ETC',
      categoryRaw: '', reward: elementText(block, 'dd', 'sub_tit'), recruitCount: number(counts?.[2]), applicantCount: number(counts?.[1]),
      dDay: daysLeft(elementText(block, 'em', 'day_c') || elementText(block, 'span', 'dday')), closed: isClosed(elementText(block, 'em', 'day_c') || elementText(block, 'span', 'dday')), point: number(text.match(/([\d,]+)\s*(?:P|포인트)\b/i)?.[1]) || 0 }];
  });
}

function regionOf(raw, type) {
  if (type === 'DELIVERY') return { sido: null, sigungu: null, raw: raw || '' };
  const text = String(raw || '').trim();
  const station = STATIONS[text];
  if (station) return { sido: station[0], sigungu: station[1], raw: text };
  const replaced = Object.entries(SIDO_ALIASES).reduce((s, [from, to]) => s.replace(from, to), text).replace(/특별자치시|특별시|광역시|특별자치도/g, '');
  const sido = SIDOS.find((s) => new RegExp(`(?:^|[\\s/])${s}(?:도|시)?(?:$|[\\s/])`).test(replaced)) || null;
  const parts = replaced.replace(/\//g, ' ').split(/\s+/).filter(Boolean);
  let sigungu = parts.slice(sido ? 1 : 0).find((s) => /[시군구]$/.test(s)) || null;
  if (!sigungu && sido) { const gu = (METRO_GUS[sido] || '').split(' ').find((s) => s && parts.slice(1).includes(s)); if (gu) sigungu = `${gu}구`; }
  if (!sigungu && sido) { const gun = (GUNS[sido] || '').split(' ').find((s) => s && parts.slice(1).includes(s)); if (gun) sigungu = `${gun}군`; }
  if (!sigungu) { const city = [...CITIES, ...(sido === '경기' ? ['광주', '여주'] : []), ...(sido === '제주' ? ['제주'] : [])].find((s) => parts.slice(sido ? 1 : 0).includes(s)); if (city) sigungu = `${city}시`; }
  return { sido, sigungu, raw: text };
}
function categoryOf(text, fallback = 'ETC') {
  for (const [id, pattern] of [
    ['CAFE', /카페|커피|디저트|베이커리|휘낭시에/], ['BEAUTY', /뷰티|헤어|미용|네일|피부|왁싱|화장품|에스테틱/],
    ['TRAVEL', /여행|숙박|펜션|호텔|리조트|캠핑/], ['KIDS', /육아|유아|아기|키즈/], ['PET', /반려|강아지|고양이|펫|사료/],
    ['DIGITAL', /디지털|가전|키보드|이어폰|닌텐도/], ['LIFE', /생활|청소|세제|도서|공연|운동|필라테스/], ['FOOD', /맛집|식품|식사|파스타|고기|치킨|횟집|칼국수|식당|과메기|음식/]
  ]) if (pattern.test(text)) return id;
  return fallback;
}
export function normalizeCampaign(sourceId, raw, now = Date.now()) {
  const source = SOURCES.find((s) => s.id === sourceId);
  if (!source) throw new Error('사이트가 없습니다');
  const title = clean(raw.title).slice(0, 300);
  const type = TYPES[raw.type] ? raw.type : 'ETC';
  const regionRaw = raw.regionRaw ?? title.match(/^\[([^\]]+)\]/)?.[1] ?? '';
  let applyEndAt = null;
  if (raw.applyEndAt && Number.isFinite(Date.parse(raw.applyEndAt))) applyEndAt = new Date(raw.applyEndAt).toISOString();
  else if (raw.dDay != null && Number.isFinite(Number(raw.dDay))) applyEndAt = new Date(Date.parse(`${kstDay(now)}T23:59:59.999+09:00`) + Number(raw.dDay) * 86400_000).toISOString();
  const detailUrl = webUrl(raw.detailUrl, source.baseUrl);
  const campaign = { id: `${sourceId}-${raw.externalId || hash(detailUrl).slice(0, 24)}`, externalId: String(raw.externalId || hash(detailUrl)), sourceId,
    title, detailUrl, thumbnailUrl: raw.thumbnailUrl ? webUrl(raw.thumbnailUrl, source.baseUrl) : '', channel: 'BLOG', type,
    category: categoryOf(`${raw.categoryRaw || ''} ${title} ${clean(raw.reward)}`, sourceId === 'dinnerqueen' && type === 'VISIT' ? 'FOOD' : 'ETC'),
    region: regionOf(regionRaw, type), reward: clean(raw.reward).slice(0, 300), point: Math.max(0, Number(raw.point) || 0),
    recruitCount: number(raw.recruitCount), applicantCount: number(raw.applicantCount), applyEndAt,
    status: raw.closed || (applyEndAt && Date.parse(applyEndAt) < now) ? 'CLOSED' : 'OPEN' };
  if (!title) throw new Error('제목이 없는 공고입니다');
  safeDetailUrl(campaign);
  campaign.contentHash = hash(JSON.stringify(campaign));
  return campaign;
}

export function safeDetailUrl(campaign) {
  const source = SOURCES.find((s) => s.id === campaign.sourceId);
  try {
    const u = new URL(campaign.detailUrl);
    if (!source || u.protocol !== 'https:' || u.host !== new URL(source.baseUrl).host || u.username || u.password) throw new Error();
    if (source.id === 'dinnerqueen' && !/^\/taste\/\d+$/.test(u.pathname)) throw new Error();
    if (source.id === 'gangnam' && !(u.pathname === '/cp/' && /^\d+$/.test(u.searchParams.get('id') || ''))) throw new Error();
    return u.href;
  } catch { throw new Error('원본 주소를 확인할 수 없습니다'); }
}

// 가장 구체적인 User-agent 그룹, 가장 긴 경로 규칙, 동률이면 Allow를 따른다.
export function allowedByRobots(text, pathname) {
  const groups = [];
  let group = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.replace(/#.*$/, '').trim().match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') {
      if (!group || group.rules.length) { group = { agents: [], rules: [] }; groups.push(group); }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key) && value) group.rules.push({ allow: key === 'allow', path: value });
  }
  const score = (g) => Math.max(-1, ...g.agents.map((a) => a === '*' ? 0 : 'contentpilot'.includes(a) ? a.length : -1));
  const best = Math.max(-1, ...groups.map(score));
  const rules = groups.filter((g) => best >= 0 && score(g) === best).flatMap((g) => g.rules).filter((r) => {
    const pattern = r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try { return new RegExp(`^${pattern}`).test(pathname); } catch { return false; }
  }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return !rules.length || rules[0].allow;
}

const values = (params, key) => (params.get(key) || '').split(',').filter(Boolean);
const boundedInt = (value, fallback, min, max) => value != null && value !== '' && Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.floor(Number(value)))) : fallback;
const visibleItems = (store) => Object.values(store.items).filter((c) => !store.sources[c.sourceId]?.hidden);
export function queryCampaigns(store, params = new URLSearchParams(), now = Date.now()) {
  const q = (params.get('q') || '').trim().slice(0, 200).toLocaleLowerCase('ko');
  const closed = params.get('includeClosed') === 'true';
  const endWithin = params.has('endWithin') ? boundedInt(params.get('endWithin'), null, 0, 365) : null;
  const items = visibleItems(store).map((c) => {
    const source = SOURCES.find((s) => s.id === c.sourceId);
    const status = c.status === 'GONE' ? 'GONE' : c.applyEndAt && Date.parse(c.applyEndAt) < now ? 'CLOSED' : c.status;
    return { ...c, status, source: { id: source.id, name: source.name }, dDay: dDay(c.applyEndAt, now),
      competition: c.recruitCount > 0 && c.applicantCount != null ? c.applicantCount / c.recruitCount : null,
      bookmarked: store.bookmarks.includes(c.id), goUrl: `/api/campaigns/${c.id}/go` };
  }).filter((c) => (closed || c.status === 'OPEN') && (!q || `${c.title} ${c.reward} ${c.region.raw}`.toLocaleLowerCase('ko').includes(q))
    && (!params.get('channel') || params.get('channel') === c.channel)
    && ['source', 'type', 'category', 'sido', 'sigungu'].every((k) => {
      const selected = values(params, k);
      return !selected.length || selected.includes(k === 'source' ? c.sourceId : ['sido', 'sigungu'].includes(k) ? c.region[k] : c[k]);
    }) && (endWithin == null || (c.dDay != null && c.dDay >= 0 && c.dDay <= endWithin))
    && (params.get('hasPoint') !== 'true' || c.point > 0) && (params.get('bookmarked') !== 'true' || c.bookmarked));
  const sort = params.get('sort');
  const date = (s, fallback) => s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : fallback;
  items.sort((a, b) => {
    let diff;
    if (sort === 'latest') diff = date(b.firstSeenAt, 0) - date(a.firstSeenAt, 0);
    else if (sort === 'competition') diff = (a.competition ?? Infinity) - (b.competition ?? Infinity);
    else if (sort === 'recruit') diff = (b.recruitCount ?? -1) - (a.recruitCount ?? -1);
    else diff = date(a.applyEndAt, Infinity) - date(b.applyEndAt, Infinity);
    return (Number.isNaN(diff) ? 0 : diff) || a.id.localeCompare(b.id);
  });
  const page = boundedInt(params.get('page'), 0, 0, 1_000_000), size = boundedInt(params.get('size'), 24, 1, 100);
  const lastUpdatedAt = Object.values(store.sources).map((s) => s.lastSuccessAt).filter(Boolean).sort().at(-1) || null;
  return { content: items.slice(page * size, (page + 1) * size), page, size, totalElements: items.length, lastUpdatedAt };
}

export function createCampaignService(file, { fetcher = fetch, pause = sleep, now = Date.now, onAlert = () => {} } = {}) {
  let store;
  try { store = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error(`체험단 저장 파일을 읽지 못했습니다: ${error.message}`); }
  store ||= { items: {}, sources: {}, bookmarks: [], logs: [] };
  for (const c of Object.values(store.items)) {
    if (c.region?.raw && !c.region.sigungu) c.region = regionOf(c.region.raw, c.type);
  }
  let busy = null;
  let activeSource = null;
  const cache = new Map();
  const save = () => {
    cache.clear();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(store));
    renameSync(`${file}.tmp`, file);
  };
  const sources = () => SOURCES.map((s) => {
    const st = store.sources[s.id] || {};
    return { ...s, ...st, enabled: s.available && st.enabled !== false, busy: activeSource === s.id,
      count: Object.values(store.items).filter((c) => c.sourceId === s.id && c.status === 'OPEN' && (!c.applyEndAt || Date.parse(c.applyEndAt) >= now())).length,
      delayed: Boolean(st.lastError) || (st.lastSuccessAt && now() - Date.parse(st.lastSuccessAt) > EVERY * 2),
      reason: s.reason || st.lastError || '', checkedAt: st.robotsCheckedAt || '2026-11-04', intervalMin: 180 };
  });
  const sourceState = (id) => store.sources[id] ||= {};
  async function collect(source) {
    const st = sourceState(source.id);
    const startedAt = new Date(now()).toISOString();
    st.lastAttemptAt = startedAt;
    activeSource = source.id;
    const log = { sourceId: source.id, startedAt, fetched: 0, inserted: 0, updated: 0, result: 'FAIL' };
    let lastRequest = null;
    let robots = '';
    const stop = (message) => { const e = new Error(message); e.stop = true; return e; };
    const checkEnabled = () => {
      if (st.enabled === false) { const e = new Error('사용자가 수집을 중지했습니다'); e.cancelled = true; throw e; }
    };
    async function request(relative, options = {}, isRobots = false) {
      const url = new URL(relative, source.baseUrl);
      if (url.origin !== new URL(source.baseUrl).origin) throw stop('수집 주소의 도메인이 다릅니다');
      if (!isRobots && !allowedByRobots(robots, url.pathname + url.search)) throw stop('robots.txt에서 수집을 제한한 경로입니다');
      for (let attempt = 0; attempt < 3; attempt++) {
        checkEnabled();
        if (lastRequest != null) await pause(Math.max(0, 2000 + Math.random() * 3000 - (now() - lastRequest)));
        checkEnabled();
        lastRequest = now();
        try {
          const res = await fetcher(url.href, { ...options, headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) }, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
          if ([401, 403, 429].includes(res.status)) throw stop(`HTTP ${res.status}: 사이트에서 접근을 제한하여 수집을 중지했습니다`);
          if (isRobots && res.status === 404) return '';
          if (!res.ok) throw new Error(`HTTP ${res.status}: 목록을 읽지 못했습니다`);
          // 본문 읽기도 fetch에 전달한 15초 신호의 적용을 받는다.
          const text = await res.text();
          if (text.length > 5_000_000) throw new Error('목록 응답이 너무 큽니다');
          if (/cf-chl-|captcha|접근이 차단|비정상적인 접근/i.test(text)) throw stop('사이트의 접근 제한 안내를 확인하여 수집을 중지했습니다');
          return text;
        } catch (error) {
          if (error.stop || attempt === 2) throw error;
          await pause(2000 * 2 ** attempt);
        }
      }
    }
    try {
      robots = await request('/robots.txt', {}, true);
      st.robotsCheckedAt = new Date(now()).toISOString();
      if (!allowedByRobots(robots, source.listPath)) throw stop('robots.txt에서 목록 수집을 제한합니다');
      const terms = clean(await request(source.termsPath));
      if (/자동화된\s*(?:수단|방식).{0,160}(?:수집.{0,60}(?:제한|금지)|하여서는\s*안)/.test(terms) || /(?:크롤링|스크래핑).{0,200}(?:금지|하여서는\s*안)/.test(terms)) throw stop('이용약관에서 자동 수집을 제한합니다');
      st.termsCheckedAt = new Date(now()).toISOString();
      const found = new Map();
      let complete = false;
      for (let page = 1; page <= 30; page++) {
        checkEnabled();
        let html, hasNext = true;
        if (source.id === 'dinnerqueen') {
          if (page === 1) html = await request('/taste?order=new&sns%5B%5D=blog');
          else {
            const response = JSON.parse(await request(`/taste/taste_list?ct=&area1=${encodeURIComponent('전국')}&area2=${encodeURIComponent('전체')}&page=${page}&order=new&sns%5B%5D=blog`, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' } }));
            html = response.layout;
            hasNext = Boolean(response.has_next);
            if (typeof html !== 'string') throw new Error('목록 응답 구조가 변경되었습니다');
          }
        } else html = await request(page === 1 ? '/cp/?sst=wr_datetime&sod=desc&channel=blog' : `/theme/go/_list_cmp_tpl.php?sst=wr_datetime&sod=desc&channel=blog&rpage=${page - 1}&row_num=28`);
        const raw = source.id === 'dinnerqueen' ? parseDinner(html) : parseGangnam(html);
        if (!raw.length) {
          if (page === 1) throw new Error('공고를 찾지 못했습니다. 목록 구조를 확인해야 합니다');
          if (!hasNext || /조회된 캠페인이 없습니다|검색 결과가 없습니다/.test(html) || !html.trim()) { complete = true; break; }
          throw new Error('빈 목록의 종료 여부를 확인하지 못했습니다');
        }
        let added = 0;
        for (const item of raw) {
          const c = normalizeCampaign(source.id, item, now());
          if (!found.has(c.id)) added++;
          found.set(c.id, c);
        }
        if (!hasNext) { complete = true; break; }
        if (!added) break; // 목록 반복 시 중단. 전체 조회로 간주하지 않는다.
      }
      log.fetched = found.size;
      if (st.lastFetched > 0 && found.size < st.lastFetched * 0.3) {
        log.result = 'PARTIAL';
        throw new Error('직전보다 공고가 70% 이상 줄어 기존 데이터를 보존했습니다');
      }
      const seenAt = new Date(now()).toISOString();
      for (const item of found.values()) {
        const old = store.items[item.id];
        if (old) log.updated += old.contentHash !== item.contentHash ? 1 : 0;
        else log.inserted++;
        store.items[item.id] = { ...old, ...item, firstSeenAt: old?.firstSeenAt || seenAt, lastSeenAt: seenAt, missingSince: null };
      }
      // ponytail: 상한 30페이지의 부분 스캔은 GONE 판정에서 제외. 전체 동기화가 필요해지면 별도 순회 작업으로 확장한다.
      if (complete) for (const c of Object.values(store.items)) {
        if (c.sourceId !== source.id || found.has(c.id)) continue;
        c.missingSince ||= seenAt;
        if (now() - Date.parse(c.missingSince) >= 86400_000) c.status = 'GONE';
      }
      Object.assign(st, { lastSuccessAt: seenAt, lastFetched: found.size, lastError: null, failures: 0, complete, pageLimit: !complete });
      log.result = 'SUCCESS';
    } catch (error) {
      if (!error.cancelled) { st.lastError = error.message; st.failures = (st.failures || 0) + 1; }
      else log.result = 'PARTIAL';
      if (error.stop) st.enabled = false;
      log.error = error.message;
      if (!error.cancelled && st.failures === 3) { try { onAlert(`${source.name}: 3회 연속 수집하지 못했습니다. 체험단 정보 조회에서 상태를 확인하세요.`); } catch { /* 알림 실패가 저장을 막지 않게 한다 */ } }
    } finally {
      log.finishedAt = new Date(now()).toISOString();
      store.logs.unshift(log);
      store.logs = store.logs.slice(0, 100);
      activeSource = null;
      save();
    }
  }
  function refresh(id, dueOnly = false) {
    if (id && !SOURCES.some(s => s.id === id)) throw new Error('사이트가 없습니다');
    if (busy) return busy;
    const selected = sources().filter((s) => (!id || s.id === id) && s.enabled && (!s.lastAttemptAt || now() - Date.parse(s.lastAttemptAt) >= (dueOnly ? EVERY : 60_000)));
    busy = (async () => { for (const source of selected) if (sourceState(source.id).enabled !== false) await collect(source); })().finally(() => { busy = null; });
    return busy;
  }
  return {
    sources, refresh,
    get busy() { return Boolean(busy); },
    list: (params = new URLSearchParams()) => {
      const key = params.toString(), cached = cache.get(key);
      if (!cached || now() - cached.at >= 30_000) {
        if (cache.size >= 128) cache.clear();
        cache.set(key, { at: now(), value: queryCampaigns(store, params, now()) });
      }
      return { ...cache.get(key).value, busy: Boolean(busy) };
    },
    filters: () => {
      const items = visibleItems(store).filter((c) => c.status === 'OPEN' && (!c.applyEndAt || Date.parse(c.applyEndAt) >= now()));
      return { sources: sources(), categories: Object.entries(CATEGORIES).map(([id, name]) => ({ id, name, count: items.filter(c => c.category === id).length })),
        regions: SIDOS.map((name) => ({ name, count: items.filter(c => c.region.sido === name).length,
          districts: [...new Set(items.filter(c => c.region.sido === name).map(c => c.region.sigungu).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')) })), types: TYPES };
    },
    status: () => ({ sources: sources(), logs: store.logs.slice(0, 30), busy: Boolean(busy), intervalMin: 180 }),
    toggle(id, enabled) {
      const source = SOURCES.find((s) => s.id === id);
      if (!source?.available) throw new Error('현재 수집을 지원하지 않는 사이트입니다');
      if (typeof enabled !== 'boolean') throw new Error('수집 설정을 확인하세요');
      Object.assign(sourceState(id), { enabled, hidden: !enabled });
      save();
      return { ok: true };
    },
    bookmark(id, enabled) {
      if (!store.items[id]) throw new Error('공고가 없습니다');
      store.bookmarks = store.bookmarks.filter((x) => x !== id);
      if (enabled) store.bookmarks.push(id);
      save();
      return { bookmarked: enabled };
    },
    go(id) {
      const c = store.items[id];
      if (!c || store.sources[c.sourceId]?.hidden) return null;
      const url = safeDetailUrl(c);
      c.clicks = (c.clicks || 0) + 1;
      save();
      return url;
    }
  };
}
