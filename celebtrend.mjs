// ① 연예인 빈 칸: '요즘 갑자기 검색이 늘어난' 연예·방송 화제를 찾아 유튜브 검색어로 바꾼다(2026-11-22 사용자 요청: 무대만 말고 예능도, 대중이 궁금해할 것).
// 재료: 네이버 크리에이터 어드바이저 핫 키워드(스타·연예인·방송·드라마·음악·영화) + 구글 트렌드 한국 급상승 검색어(RSS, 로그인 불필요).
// AI는 그중 공식 영상(방송사 예능 클립·무대·인터뷰)으로 보여 줄 수 있는 화제를 고르고, 의혹·사건은 고르지 않는다.

export const GOOGLE_TRENDS_KR = 'https://trends.google.com/trending/rss?geo=KR';
const ENT = /스타|연예|방송|드라마|음악|영화|공연/;

const unxml = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (s, name) => unxml((s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1]);

// 구글 트렌드 RSS → [{title, traffic, news:[제목...]}]
export function parseGoogleTrends(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => ({
    title: tag(it, 'title'),
    traffic: tag(it, 'ht:approx_traffic'),
    news: [...it.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)].map((m) => unxml(m[1])).slice(0, 2)
  })).filter((x) => x.title);
}

export async function googleTrends(timeout = 15000) {
  const res = await fetch(GOOGLE_TRENDS_KR, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`구글 트렌드 ${res.status}`);
  return parseGoogleTrends(await res.text());
}

// 네이버 핫 키워드 중 연예·방송 분야만. 새로 들어온 것(change null)·많이 오른 것을 앞으로
export function celebKeywords(hot, n = 40) {
  const score = (k) => (k.change === null || k.change === undefined ? 60 : Math.max(0, k.change)) + (30 - Math.min(30, k.rank || 30));
  const seen = new Set();
  return (hot?.categories || []).filter((c) => ENT.test(c.category || ''))
    .flatMap((c) => (c.items || []).map((k) => ({ category: c.category, query: String(k.query || '').trim(), change: k.change, rank: k.rank, s: score(k) })))
    .filter((k) => k.query && !seen.has(k.query) && seen.add(k.query))
    .sort((a, b) => b.s - a.s).slice(0, n);
}

export function celebPickPrompt(naver = [], google = [], avoid = []) {
  return [
    '너는 한국 유튜브 쇼츠 채널 기획자다. 아래는 요즘 한국에서 검색이 갑자기 늘어난 말들이다.',
    '여기서 연예인·방송인·아이돌·배우·예능 프로그램과 관련되고, 대중이 "이 사람 요즘 왜 이렇게 뜨지?" 하고 궁금해할 만한 화제를 최대 4개 고른다. 화제성이 큰 순서로.',
    '- 무대만이 아니라 예능 출연 장면·인터뷰·티저·직캠 등 유튜브 공식 채널(방송사·소속사·예능 채널) 영상으로 보여 줄 수 있어야 한다.',
    '- 고르지 않는다: 사건·사고·범죄·사망·투병·소송·정치, 스포츠 경기 결과, 상품·맛집.',
    '- 열애설·폭로·임신설 같은 사생활 의혹은 그 자체를 다루지 않는다. 그 인물이 요즘 나온 예능·무대 영상을 찾는 검색어로 바꿀 수는 있다(의혹은 why에도 사실처럼 쓰지 않는다).',
    avoid.length ? `- 최근에 이미 만든 화제는 피한다: ${avoid.slice(0, 20).join(', ')}` : '',
    '- query: 유튜브 검색어. 인물·프로그램 이름 + 예능|무대|인터뷰|직캠|비하인드 중 어울리는 말, 한국어 20자 이내.',
    '- why: 지금 왜 뜨는지 한 줄. 아래 목록에 있는 사실만 쓰고 지어내지 않는다.',
    '파일은 만들지 말고 JSON만 출력한다: {"picks":[{"name":"인물 또는 프로그램","query":"유튜브 검색어","why":"한 줄"}]}',
    '',
    '[네이버 블로그 급상승 검색어 (분야 | 검색어 | 순위 변동, new=새로 진입)]',
    ...naver.map((k) => `- ${k.category} | ${k.query} | ${k.change === null || k.change === undefined ? 'new' : k.change}`),
    '',
    '[구글 한국 급상승 검색어 (검색어 | 검색량 | 관련 기사 제목)]',
    ...google.map((g) => `- ${g.title} | ${g.traffic || '-'} | ${g.news.join(' / ')}`)
  ].filter((l) => l !== '').join('\n');
}

export function normalizeCelebPicks(result, n = 4) {
  const seen = new Set();
  return (Array.isArray(result?.picks) ? result.picks : [])
    .map((p) => ({ name: String(p?.name || '').trim().slice(0, 30), query: String(p?.query || '').trim().slice(0, 40), why: String(p?.why || '').trim().slice(0, 120) }))
    .filter((p) => p.query && !seen.has(p.query) && seen.add(p.query))
    .slice(0, n);
}

// ① 주제 모음('관객 난입 레전드', '무대 실수 레전드'): 제목 검색만으로는 장면이 확실한 공식 영상이 2개 남짓(2026-11-22) →
// AI가 그 주제로 널리 알려진 장면을 인물별 유튜브 검색어로 먼저 꼽고, 검색어마다 공식 영상을 찾는다
export const isThemeTopic = (topic) => /레전드|모음|top\s*\d|순간들|특집/i.test(String(topic || ''));
export function themeQueriesPrompt(topic, notes = '') {
  return [
    `너는 한국 유튜브 쇼츠 기획자다. 주제: "${topic}"${notes ? ` (메모: ${notes})` : ''}`,
    '이 주제로 TOP 모음 쇼츠를 만든다. 이 주제에 딱 맞는, 한국에서 널리 알려진 연예인·아이돌·방송 장면을 6개 꼽는다(서로 다른 인물).',
    '- 실제로 있었던 장면만. 확실하지 않으면 꼽지 않는다(지어내지 않는다).',
    '- 사건·사고·부상·범죄·사망·사생활 의혹은 꼽지 않는다. 웃기거나 귀엽거나 대처가 멋진 장면 위주.',
    '- query: 그 장면 공식 영상(방송사·소속사)을 찾을 유튜브 검색어, 인물 이름 + 장면 핵심어, 20자 이내.',
    '파일은 만들지 말고 JSON만 출력한다: {"picks":[{"name":"인물","query":"유튜브 검색어","why":"어떤 장면인지 한 줄"}]}'
  ].join('\n');
}
