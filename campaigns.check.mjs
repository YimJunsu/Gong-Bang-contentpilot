// node campaigns.check.mjs — 공개 목록 파싱, 조회, 저장, 차단 자체 검사 (외부 요청 없음)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDinner, parseGangnam, normalizeCampaign, allowedByRobots, safeDetailUrl, queryCampaigns, createCampaignService } from './campaigns.mjs';

const now = Date.parse('2026-11-04T09:00:00Z');
const dinnerHtml = `<div class="qz-dq-card campaign qz-button fluid">
<a class="qz-dq-card__link" href="/taste/123"><img src="https://img.example/a.webp" alt="[서울 강남] 커피 &amp; 케이크"></a>
<div class="qz-dq-card__badge-row"><strong>카페</strong></div>
<p class="qz-caption-kr color-placeholder ellipsis w-500">2인 디저트 제공</p>
<p class="dday"><strong><span>3</span>일 남음</strong></p><p class="apply_badge">신청 0 / 5</p></div>
<div class="qz-dq-card campaign"><a href="/taste/124"><img alt="[릴스] 다른 캠페인"></a><i class="qz_b_reels"></i><p>2일 남음 신청 10 / 2</p></div>`;
const gangnamHtml = `<li class='list_item' data-product='77'><div class='imgArea'><a href='/cp/?id=77'><img src='//img.example/t.jpg'></a></div>
<div class='textArea'><dl><em class='blog'>Blog</em><em class='type'>방문형</em><em class='day_c'>오늘 마감</em>
<dt class='tit'><a href='/cp/?id=77'>[서울 송파] 파스타</a></dt><dd class='sub_tit'>식사권 5만원</dd></dl>
<span class='numb'><b>신청 1,234</b> / 모집 10</span></div></li>
<li class='list_item' data-product='78'><em class='instagram'>Instagram</em><dt class='tit'><a href='/cp/?id=78'>인스타 전용</a></dt></li>`;
const dinner = parseDinner(dinnerHtml);
assert.equal(dinner.length, 1, '릴스 전용은 제외한다');
assert.equal(parseDinner(dinnerHtml.split('<div class="qz-dq-card campaign">')[0] + '<footer><i class="qz_b_clip"></i></footer>').length, 1, '페이지 바닥의 아이콘은 공고 채널 판단에 쓰지 않는다');
const a = normalizeCampaign('dinnerqueen', dinner[0], now);
assert.equal(a.title, '[서울 강남] 커피 & 케이크');
assert.deepEqual(a.region, { sido: '서울', sigungu: '강남구', raw: '서울 강남' });
assert.equal(a.applicantCount, 0, '신청 0을 미공개와 구분한다');
assert.equal(a.category, 'CAFE');
assert.equal(a.applyEndAt, '2026-11-07T14:59:59.999Z');
const gangnam = parseGangnam(gangnamHtml);
assert.equal(gangnam.length, 1);
const b = normalizeCampaign('gangnam', gangnam[0], now);
assert.equal(b.recruitCount, 10);
assert.equal(b.applicantCount, 1234);
assert.equal(b.thumbnailUrl, 'https://img.example/t.jpg');
assert.equal(b.applyEndAt, '2026-11-04T14:59:59.999Z');
assert.equal(normalizeCampaign('dinnerqueen', parseDinner(dinnerHtml.replace('<span>3</span>일 남음', '선정중'))[0], now).status, 'CLOSED', '선정 단계의 공고는 모집 중으로 표시하지 않는다');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], regionRaw: '강남역' }, now).region.sigungu, '강남구');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], regionRaw: '경기 성남', title: '[경기 성남] 식당' }, now).region.sigungu, '성남시');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], regionRaw: '대구 달서' }, now).region.sigungu, '달서구');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], regionRaw: '부산 기장' }, now).region.sigungu, '기장군');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], regionRaw: '경기 광주' }, now).region.sigungu, '광주시');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], regionRaw: '경기 양평' }, now).region.sigungu, '양평군');
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], type: 'DELIVERY' }, now).region.sido, null);
assert.equal(normalizeCampaign('dinnerqueen', { ...dinner[0], dDay: null }, now).applyEndAt, null, '마감 미공개를 임의로 정하지 않는다');

assert.equal(allowedByRobots('User-agent: *\nDisallow: /\nAllow: /$', '/'), true);
assert.equal(allowedByRobots('User-agent: *\nDisallow: /\nAllow: /$', '/campaign/'), false);
assert.equal(allowedByRobots('User-agent: *\nDisallow: /cp/?id=77', '/cp/?id=77'), false);
assert.equal(allowedByRobots('User-agent: *\nDisallow: /cp/?id=77', '/cp/?id=78'), true);
assert.equal(allowedByRobots('User-agent: ContentPilot\nDisallow: /\nUser-agent: *\nAllow: /', '/taste'), false);
assert.equal(allowedByRobots('User-agent: *\nDisallow:', '/taste'), true);
assert.ok(safeDetailUrl(a));
for (const url of ['https://dinnerqueen.net.evil.com/taste/1', 'https://evil.com/', 'javascript:alert(1)', 'https://user:pass@dinnerqueen.net/taste/1', 'http://dinnerqueen.net/taste/1', 'https://dinnerqueen.net:444/taste/1']) {
  assert.throws(() => safeDetailUrl({ ...a, detailUrl: url }), /주소/);
}

const c = { ...a, id: 'dinnerqueen-other', title: '배송 캠페인', type: 'DELIVERY', region: { sido: null, sigungu: null, raw: '' }, point: 5000, applicantCount: null };
const store = { items: { [a.id]: a, [b.id]: b, [c.id]: c }, bookmarks: [a.id], sources: {} };
const q = (s) => queryCampaigns(store, new URLSearchParams(s), now);
assert.equal(q('').totalElements, 3);
assert.equal(q('sido=서울&sigungu=강남구').totalElements, 1);
assert.equal(q('q=커피&category=CAFE&source=dinnerqueen').totalElements, 1);
assert.equal(q('endWithin=0').totalElements, 1, '오늘 마감은 한국 날짜 기준이다');
assert.equal(q('hasPoint=true').content[0].id, c.id);
assert.equal(q('bookmarked=true').totalElements, 1);
assert.equal(q('sort=competition').content.at(-1).id, c.id, '경쟁률 미공개는 뒤로 보낸다');
assert.equal(q('sort=recruit').content[0].id, b.id);
assert.equal(q('size=1&page=1').content.length, 1);
assert.equal(q('page=Infinity&size=-1').page, 0);
assert.equal(queryCampaigns(store, new URLSearchParams(), now + 7 * 86400_000).totalElements, 0);
assert.equal(queryCampaigns(store, new URLSearchParams('includeClosed=true'), now + 7 * 86400_000).totalElements, 3);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-check-'));
const file = path.join(dir, 'campaigns.json');
let mode = 'ok';
let clock = now;
const calls = [];
const fetcher = async (url) => {
  calls.push(url);
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
  if (mode === 'blocked') return new Response('blocked', { status: 429 });
  if (url.includes('/policy')) return new Response('<p>서비스 이용약관</p>');
  // 첫 페이지에는 한 건, 다음 페이지에는 명시적인 빈 목록이 온다.
  return new Response(url.includes('taste_list') ? JSON.stringify({ layout: '', has_next: false }) : dinnerHtml);
};
try {
  const service = createCampaignService(file, { fetcher, pause: async () => {}, now: () => clock });
  await service.refresh('dinnerqueen');
  assert.equal(service.list(new URLSearchParams()).totalElements, 1);
  const firstSeen = service.list(new URLSearchParams()).content[0].firstSeenAt;
  service.bookmark(a.id, true);
  clock += 180_000;
  await service.refresh('dinnerqueen');
  assert.equal(service.list(new URLSearchParams()).totalElements, 1, '중복 공고는 갱신한다');
  assert.equal(service.list(new URLSearchParams()).content[0].firstSeenAt, firstSeen);
  assert.equal(service.list(new URLSearchParams()).content[0].bookmarked, true);
  const restored = createCampaignService(file, { fetcher, pause: async () => {}, now: () => clock });
  assert.equal(restored.list(new URLSearchParams('bookmarked=true')).totalElements, 1, '재시작 후 즐겨찾기 유지');
  const before = calls.length;
  await service.refresh('seoulouba');
  assert.equal(calls.length, before, '수집 금지 사이트는 요청하지 않는다');
  mode = 'blocked'; clock += 180_000;
  await service.refresh('dinnerqueen');
  assert.equal(service.sources().find(s => s.id === 'dinnerqueen').enabled, false, '429 즉시 수집 중지');
  assert.equal(service.list(new URLSearchParams()).totalElements, 1, '차단되어도 기존 데이터 유지');
  service.toggle('dinnerqueen', false);
  assert.equal(service.list(new URLSearchParams()).totalElements, 0, '사용자가 비활성화한 출처의 공고는 숨긴다');

  const cancelCalls = [];
  let cancelling;
  cancelling = createCampaignService(path.join(dir, 'cancel.json'), {
    now: () => clock,
    fetcher: async (url) => { cancelCalls.push(url); return new Response('User-agent: *\nAllow: /'); },
    pause: async () => { cancelling.toggle('dinnerqueen', false); }
  });
  await cancelling.refresh('dinnerqueen');
  assert.equal(cancelCalls.length, 1, '요청 대기 중 끄면 다음 요청을 보내지 않는다');

  const queueCalls = [];
  let queued;
  queued = createCampaignService(path.join(dir, 'queued.json'), {
    now: () => clock, pause: async () => {},
    fetcher: async url => {
      queueCalls.push(url);
      if (url.endsWith('/robots.txt')) { queued.toggle('gangnam', false); return new Response('User-agent: *\nAllow: /'); }
      if (url.includes('/policy')) return new Response('서비스 이용약관');
      return new Response(url.includes('taste_list') ? JSON.stringify({ layout: '', has_next: false }) : dinnerHtml);
    }
  });
  await queued.refresh();
  assert.equal(queueCalls.some(url => url.includes('xn--939au0g4vj8sq.net')), false, '대기 중에 끈 출처는 robots 요청도 보내지 않는다');

  mode = 'ok';
  const partialFile = path.join(dir, 'partial.json');
  fs.writeFileSync(partialFile, JSON.stringify({ ...store, logs: [], sources: { dinnerqueen: { lastFetched: 10 } } }));
  const partial = createCampaignService(partialFile, { fetcher, pause: async () => {}, now: () => clock });
  await partial.refresh('dinnerqueen');
  assert.equal(partial.status().logs[0].result, 'PARTIAL');
  assert.equal(partial.list().totalElements, 3, '급감 시 신규 목록으로 기존 공고를 덮어쓰지 않는다');
  assert.equal(partial.list(new URLSearchParams('bookmarked=true')).totalElements, 1, '실패해도 즐겨찾기는 보존한다');

  const goneFile = path.join(dir, 'gone.json');
  fs.writeFileSync(goneFile, JSON.stringify({ ...store, logs: [], sources: {} }));
  const gone = createCampaignService(goneFile, { fetcher, pause: async () => {}, now: () => clock });
  await gone.refresh('dinnerqueen');
  assert.equal(gone.list().totalElements, 3, '한 번 안 보인 공고는 유지한다');
  clock += 25 * 3600_000;
  await gone.refresh('dinnerqueen');
  assert.equal(gone.list().content.some(item => item.id === c.id), false, '전체 목록에서 24시간 이상 사라진 공고는 숨긴다');
  assert.equal(gone.list(new URLSearchParams('includeClosed=true')).content.find(item => item.id === c.id).status, 'GONE');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log('campaigns.check ok');
