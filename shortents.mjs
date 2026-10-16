// 숏텐츠: 네이버 모바일 검색창 아래 '숏텐츠' 목록을 받아 쌓아 둔다.
//
// 2026-10-16 실측: 검색 화면 스크립트(search-3.x.js)의 extraKeywordApiUrl이 아래 주소다. 로그인 없이 JSON을 준다.
//   응답 { contents: [{ title, category, imageUrl, linkUrl, gdid, rank }] } — 한 번에 4개.
//   shortents_page 1~5에 서로 다른 20개, 6부터는 같은 것이 되풀이된다. 네이버 안내상 1시간 단위로 갱신.
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://s.search.naver.com/n/rkeyword/search.naver?ssc=m.recentkeyword.search&display_keyword=0';
const HEADERS = {
  referer: 'https://m.search.naver.com/',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
};
const PAGES = 5;
const KEEP_MS = 48 * 3600_000; // 이틀 지난 항목은 지운다

// 분류별 숏텐츠: PC 검색 결과에 '숏텐츠 | 부동산' 같은 상자가 함께 내려온다(HTML 안에 그대로, 로그인 불필요).
// 링크마다 query=주제, x_shortents={"category","gdid"}. 분류마다 5개. (2026-10-16 실측: 아래 검색어 → 괄호 안 분류)
export const CATEGORY_SEEDS = [
  ['연예', '엔터 종합'], ['부동산', '부동산'], ['주식', '증권'], ['여행', '여행맛집 종합'], ['요리', '리빙푸드 종합'],
  ['패션', '패션뷰티 종합'], ['자동차', '카테크 종합'], ['야구', '스포츠 종합'], ['영화', '영화'], ['드라마', '드라마']
];
const PC_HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36', 'accept-language': 'ko-KR' };
// 숫자 문자 참조(&#x27; &#39;)까지 푼다 — 요약 문장에 &#x27; 가 그대로 보이던 문제(2026-10-16)
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const textOf = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseCategoryHtml(html) {
  const items = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href="\?([^"]*x_shortents=[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const params = new URLSearchParams(decode(m[1]));
    let meta = {};
    try { meta = JSON.parse(params.get('x_shortents') || '{}'); } catch { continue; }
    const title = params.get('query');
    if (!meta.gdid || !title) continue;
    const prev = items.get(meta.gdid);
    // 같은 주제가 여러 링크(제목·사진)로 나온다 → 사진·설명이 있는 쪽을 합친다
    const img = m[2].match(/<img[^>]+src="([^"]+)"/)?.[1];
    const rest = textOf(m[2]).replace(title, '').trim();
    items.set(meta.gdid, {
      gdid: meta.gdid, title, category: meta.category,
      linkUrl: `https://search.naver.com/search.naver?${decode(m[1])}`,
      imageUrl: prev?.imageUrl || (img ? decode(img) : null),
      desc: prev?.desc || rest || null,
      rank: prev?.rank ?? items.size + 1
    });
  }
  return [...items.values()];
}

async function fetchGlobal() {
  const items = new Map();
  let shown = [];
  for (let page = 1; page <= PAGES; page += 1) {
    const url = `${API}&shortents_page=${page}&shortents_list=${encodeURIComponent(shown.join(','))}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`숏텐츠 응답 ${res.status}`);
    const list = (await res.json()).contents || [];
    shown = list.map((x) => x.gdid);
    for (const x of list) if (x.gdid && !items.has(x.gdid)) items.set(x.gdid, { ...x, imageUrl: x.imageUrl?.replace('type=f52_52', 'type=f160_160'), source: 'live' });
  }
  return [...items.values()];
}

// 전체(검색창 숏텐츠 20개) + 분류별(각 5개). 한쪽이 실패해도 나머지는 살린다.
export async function fetchShortents(seeds = CATEGORY_SEEDS.map(([q]) => q)) {
  const items = new Map();
  const errors = [];
  try { for (const x of await fetchGlobal()) items.set(x.gdid, x); } catch (e) { errors.push(`전체: ${e.message}`); }
  for (const q of seeds) {
    try {
      const res = await fetch(`https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`, { headers: PC_HEADERS });
      if (!res.ok) throw new Error(`응답 ${res.status}`);
      for (const x of parseCategoryHtml(await res.text())) {
        const had = items.get(x.gdid);
        items.set(x.gdid, had ? { ...x, ...had, desc: had.desc || x.desc } : { ...x, source: 'category' });
      }
    } catch (e) { errors.push(`${q}: ${e.message}`); }
  }
  if (!items.size) throw new Error(`숏텐츠를 하나도 받지 못했습니다 (${errors.join(', ')})`);
  return Object.assign([...items.values()], { errors });
}

// 저장 파일에 합친다: 처음 본 시각·마지막으로 본 시각을 남기고, 이번에 처음 나온 것은 NEW
export async function updateStore(file, fresh, now = Date.now()) {
  const store = await fs.readFile(file, 'utf8').then((t) => JSON.parse(t.replace(/^﻿/, ''))).catch(() => ({ items: {} }));
  const at = new Date(now).toISOString();
  for (const x of fresh) {
    const old = store.items[x.gdid];
    store.items[x.gdid] = { ...old, ...x, firstSeen: old?.firstSeen || at, lastSeen: at };
  }
  for (const [id, x] of Object.entries(store.items)) if (now - Date.parse(x.lastSeen) > KEEP_MS && !x.jobId) delete store.items[id];
  store.current = fresh.map((x) => x.gdid);
  store.firstFetch ||= at; // 맨 처음 조회에서는 전부 처음 보는 것이라 NEW를 붙이지 않는다
  store.lastFetch = at;
  store.lastError = null;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(store, null, 2));
  return store;
}

// 비슷한 글 찾기: 제목을 두 글자 이상 낱말로 쪼개, 겹치는 낱말이 2개 이상이거나 짧은 쪽의 절반 이상이면 비슷하다고 본다.
// ponytail: 낱말 겹침만 본다. 표현이 완전히 다른 같은 주제는 못 잡는다 — 필요하면 AI 비교로 올린다.
// 어느 주제에나 붙는 말은 겹쳐도 같은 주제라는 근거가 안 된다 (2026-10-16 '11월 여행'·'추천'으로 엉뚱하게 묶인 사례)
const GENERIC = new Set(['추천', '후기', '리뷰', '방법', '정리', '총정리', '꿀팁', '기준', '정보', '가격', '이유', '비교', '차이', '선택', '선택법', '확인', '신청',
  '여행', '맛집', '사용법', '가이드', '공개', '최신', '이번', '오늘', '올해', '내년', '주말', '시작', '종류', '뜻', '바로', '포함']);
const isGeneric = (w) => GENERIC.has(w) || /^\d+(월|일|년|시|분|개|가지|원|만원|선)?$/.test(w);
const words = (text) => [...new Set(String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !isGeneric(w)))];
// 같은 낱말이거나, 3글자 이상 낱말이 서로를 품을 때(조사·어미가 붙은 꼴) 같은 낱말로 본다
const same = (w, v) => w === v || (Math.min(w.length, v.length) >= 3 && (v.includes(w) || w.includes(v)));
export function similarPost(title, posts) {
  const a = words(title);
  if (!a.length) return null;
  let best = null;
  for (const p of posts) {
    const b = words(p.title);
    const shared = a.filter((w) => b.some((v) => same(w, v))).length;
    const ratio = shared / Math.min(a.length, b.length || 1);
    if ((shared >= 2 || ratio >= 0.5) && (!best || shared > best.shared)) best = { title: p.title, path: p.path, shared };
  }
  return best;
}
