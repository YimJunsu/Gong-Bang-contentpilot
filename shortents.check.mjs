// node shortents.check.mjs — 숏텐츠 저장·비슷한 글 판정 자체 검사 (네트워크 없음)
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { updateStore, similarPost } from './shortents.mjs';

const file = path.join(os.tmpdir(), `shortents-check-${process.pid}.json`);
const t0 = Date.parse('2026-10-16T09:00:00Z');
let s = await updateStore(file, [{ gdid: 'a', title: 'A' }, { gdid: 'b', title: 'B' }], t0);
assert.deepEqual(s.current, ['a', 'b']);
s = await updateStore(file, [{ gdid: 'b', title: 'B2' }, { gdid: 'c', title: 'C' }], t0 + 1800_000);
assert.equal(s.items.b.firstSeen, new Date(t0).toISOString(), '처음 본 시각 유지');
assert.equal(s.items.b.title, 'B2', '새 정보로 갱신');
assert.equal(s.items.c.firstSeen, s.lastFetch, '새 항목은 이번 조회가 처음');
assert.ok(s.items.a, '지금 목록에 없어도 이틀까지는 남김');
s.items.b.jobId = 'job1';
await fs.writeFile(file, JSON.stringify(s));
s = await updateStore(file, [{ gdid: 'c', title: 'C' }], t0 + 50 * 3600_000);
assert.ok(!s.items.a, '이틀 지난 항목은 지움');
assert.ok(s.items.b, '글을 쓴 항목은 남김');
await fs.rm(file);

const posts = [{ title: '2027 최저임금 월급 계산, 209시간 기준', path: 'x' }, { title: '강릉 커피축제 이번 주말', path: 'y' }];
assert.equal(similarPost('2027년 최저임금 확정 월급 얼마', posts)?.path, 'x');
assert.equal(similarPost('강릉 커피축제 주차', posts)?.path, 'y');
assert.equal(similarPost('솔비 이규한 결혼', posts), null);
// 흔한 말(11월·여행·추천)만 겹치면 비슷하지 않다 — 실제로 엉뚱하게 묶였던 두 사례
const more = [{ title: '일본 면세 구매일 기준, 11월 여행은 뭐가 다를까?', path: 'j' }, { title: '가성비 게이밍 키보드 추천, 10만 원 이하 5선·축 선택법', path: 'k' }];
assert.equal(similarPost('대마도 11월 날씨, 당일치기 및 1박2일 여행', more), null);
assert.equal(similarPost('이케아 공간별 러그 추천과 선택 꿀팁', more), null);
assert.equal(similarPost('게이밍 키보드 축 추천', more)?.path, 'k', '진짜 겹치는 주제는 잡는다');
console.log('shortents.check ok');
// 요약 문장의 숫자 문자 참조를 푼다
import { parseCategoryHtml } from './shortents.mjs';
const html = '<a href="?query=%EC%95%84%ED%81%AC&amp;x_shortents=%7B%22category%22%3A%22%EB%B6%80%22%2C%22gdid%22%3A%22g1%22%7D"><span>아크</span> 동탄 &#x27;아크메르&#x27; 16일 &amp; 개관</a>';
const [one] = parseCategoryHtml(html);
assert.equal(one.title, '아크');
assert.equal(one.desc, "동탄 '아크메르' 16일 & 개관");
console.log('shortents.check parse ok');
