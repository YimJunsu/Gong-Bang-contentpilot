// node celebtrend.check.mjs — ① 연예인 빈 칸: 급상승 화제 모으기 자체 검사
import assert from 'node:assert/strict';
import { parseGoogleTrends, celebKeywords, celebPickPrompt, normalizeCelebPicks } from './celebtrend.mjs';

const xml = `<rss><channel><item><title>핑클 완전체</title><ht:approx_traffic>5000+</ht:approx_traffic>
<ht:news_item><ht:news_item_title>핑클 &amp; 컴백 확정</ht:news_item_title></ht:news_item></item>
<item><title><![CDATA[뉴캐슬 대 아스널]]></title><ht:approx_traffic>2000+</ht:approx_traffic></item></channel></rss>`;
const g = parseGoogleTrends(xml);
assert.deepEqual(g[0], { title: '핑클 완전체', traffic: '5000+', news: ['핑클 & 컴백 확정'] });
assert.equal(g[1].title, '뉴캐슬 대 아스널');

const hot = { categories: [
  { category: '맛집', items: [{ query: '빕스', rank: 1, change: 0 }] },
  { category: '스타·연예인', items: [{ query: '오래된 인물', rank: 1, change: 0 }, { query: '갑자기 뜬 인물', rank: 9, change: null }] },
  { category: '방송', items: [{ query: '갑자기 뜬 인물', rank: 2, change: 3 }, { query: '데블스플랜3', rank: 3, change: 44 }] }
] };
const k = celebKeywords(hot);
assert.ok(!k.some((x) => x.query === '빕스'), '연예·방송 분야만');
assert.equal(k[0].query, '갑자기 뜬 인물', '새로 들어온 것이 먼저');
assert.equal(k.filter((x) => x.query === '갑자기 뜬 인물').length, 1, '중복 없음');

const p = celebPickPrompt(k, g, ['지난 화제']);
assert.match(p, /예능/);
assert.match(p, /사생활 의혹/);
assert.match(p, /지난 화제/);
assert.match(p, /핑클 완전체 \| 5000\+/);
assert.match(p, /갑자기 뜬 인물 \| new/);

assert.deepEqual(normalizeCelebPicks({ picks: [{ query: ' 핑클 예능 ', why: '완전체 컴백', name: '핑클' }, { query: '핑클 예능' }, { why: '검색어 없음' }] }),
  [{ name: '핑클', query: '핑클 예능', why: '완전체 컴백' }]);
console.log('celebtrend.check ok');
{
  const { isThemeTopic, themeQueriesPrompt } = await import('./celebtrend.mjs');
  assert.equal(isThemeTopic('관객 난입 레전드'), true);
  assert.equal(isThemeTopic('무대 실수 TOP5'), true);
  assert.equal(isThemeTopic('리센느 리브'), false);
  assert.match(themeQueriesPrompt('무대 실수 레전드'), /"picks"/);
  console.log('celebtrend.check theme ok');
}
