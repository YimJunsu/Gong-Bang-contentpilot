// 쇼츠 자동화(docs/숏폼-통합-설계.md 3장): 분야를 고르고 '지금 만들기' → 요즘 뜨는 영상을 찾아 클립 숏폼(①②)으로 만든다. 업로드는 사람이.
// 찾는 곳: YouTube API 키가 있으면 공식 인기 차트(videos.list chart=mostPopular), 없거나 실패하면 yt-dlp '이번 주 업로드' 검색.
// 한 번 쓴 영상은 data/autoshorts.json에 남겨 다시 쓰지 않는다.
import { notCompilation } from './clip.mjs';

// kind: viral = ② 해외 재밌는 영상(원작자 채널만), celeb = ① 연예인 핫(인증 채널만)
export const AUTO_CATS = {
  comedy: { name: '코미디·몰카', kind: 'viral', query: 'funny prank caught on camera', region: 'US', ytCat: 23 },
  animals: { name: '동물', kind: 'viral', query: 'dog cat funny reaction', region: 'US', ytCat: 15 },
  sports: { name: '스포츠 명장면', kind: 'viral', query: 'unbelievable sports moment', region: 'US', ytCat: 17 },
  talkshow: { name: '해외 토크쇼', kind: 'viral', query: 'late night show funny moment', region: 'US', ytCat: 24 },
  music: { name: '공연 해프닝', kind: 'viral', query: 'concert crowd unexpected moment', region: 'US', ytCat: 10 },
  kpop: { name: 'K-POP 무대', kind: 'celeb', query: '직캠 무대', region: 'KR', ytCat: 10 },
  variety: { name: '예능 클립', kind: 'celeb', query: '예능 레전드 장면', region: 'KR', ytCat: 24 }
};

const MIN_SEC = 15, MAX_SEC = 15 * 60;
const MIN_VIRAL_VIEWS = 10000; // 조회 389회짜리가 뽑힌 적 있음(2026-11-25). 모자라면 findFresh가 전체 기간 검색으로 넘어간다
// 정치·시사·사건사고는 자동으로 만들지 않는다(말 위주 + 논란). 토크쇼 독백(monologue)도 말 위주라 뺀다
export const SENSITIVE = /trump|biden|harris|obama|election|midterm|congress|senate|politic|republican|democrat|president|\bwar\b|ukraine|israel|gaza|shooting|killed|police|news|monologue|daily show|last week tonight|gop|maga|governor|gone wrong|\bhood\b|\bfight|robbery|\bguns?\b|vote|voter|campaign|대통령|정치|선거|국회|탄핵|뉴스|사건|사고|사망/i;
const iso = (d) => { const m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

// YouTube 공식 인기 차트. 키가 틀렸거나 그 분야 차트가 없으면 오류 → 부르는 쪽이 검색으로 넘어간다
export async function trendingApi(key, cat, n = 30) {
  const u = new URL('https://www.googleapis.com/youtube/v3/videos');
  Object.entries({ part: 'snippet,contentDetails,statistics', chart: 'mostPopular', regionCode: cat.region, videoCategoryId: String(cat.ytCat), maxResults: String(n), key }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `YouTube API ${res.status}`);
  return (data.items || []).map((v) => ({
    id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: v.snippet?.title || '', channel: v.snippet?.channelTitle || '',
    duration: iso(v.contentDetails?.duration), views: Number(v.statistics?.viewCount || 0), verified: true // 인기 차트는 유튜브가 고른 것
  }));
}

// ② 재밌는 영상이 아닌 뮤직비디오·공연 실황(넓혀 찾을 때 조회수로 맨 위에 온다)
const MUSIC_VIDEO = /\bM\/?V\b|music video|official (video|audio|mv)|lyrics?\b|\blive (in|at|from)\b|full concert|non[- ]?stop|nursery|toons?\b/i;
// 후보 거르기 + 조회수 순. used = 이미 쓴 영상 id
export function pickFresh(list, cat, used, n) {
  const seen = new Set();
  return list
    .filter((v) => v?.id && !used.has(v.id) && !seen.has(v.id) && seen.add(v.id))
    .filter((v) => v.duration >= MIN_SEC && v.duration <= MAX_SEC)
    .filter((v) => !SENSITIVE.test(`${v.title} ${v.channel}`))
    .filter((v) => (cat.kind === 'viral' ? notCompilation(v) && !MUSIC_VIDEO.test(v.title) && (v.views || 0) >= MIN_VIRAL_VIEWS : v.verified))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, n);
}

// 이번 주 업로드 검색 주소(yt-dlp가 그대로 읽는다). sp=EgIIAw== : 업로드 날짜 '이번 주'
export const monthSearchUrl = (query) => weekSearchUrl(query).replace('EgIIAw', 'EgIIBA');
export const yearSearchUrl = (query) => weekSearchUrl(query).replace('EgIIAw', 'EgIIBQ');
export const weekSearchUrl = (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIIAw%253D%253D`;
