// npm run check: 쇼츠 자동화 후보 거르기
import assert from 'node:assert/strict';
import { pickFresh, AUTO_CATS, weekSearchUrl } from './autoshorts.mjs';
const v = (id, o = {}) => ({ id, title: `t${id}`, channel: 'c', duration: 60, views: 10, verified: false, ...o });
const list = [v('a', { views: 5 }), v('b', { views: 50 }), v('c', { title: 'Funniest compilation' }), v('d', { duration: 5 }), v('e', { duration: 3600 }), v('b'), v('u', { views: 999 })];
const got = pickFresh(list, AUTO_CATS.comedy, new Set(['u']), 3).map((x) => x.id);
assert.deepEqual(got, ['b', 'a']); // 조회수 순, 모음·너무 짧은/긴 것·이미 쓴 것·중복 제외
assert.deepEqual(pickFresh([v('x'), v('y', { verified: true })], AUTO_CATS.kpop, new Set(), 2).map((x) => x.id), ['y']); // 연예인은 인증 채널만
assert.match(weekSearchUrl('a b'), /search_query=a%20b&sp=EgIIAw%253D%253D$/);
assert.deepEqual(pickFresh([v('p', { title: 'Trump Spins Over Midterm Defeat' }), v('q', { title: 'Grammy award drummer' })], AUTO_CATS.talkshow, new Set(), 2).map((x) => x.id), ['q']); // 정치·뉴스 제외, award는 통과
console.log('autoshorts.check ok');

// 업로드 txt·폴더 분류
{
  const { uploadText, uploadTitle, hashtagsOf, SHORT_FOLDERS } = await import('./shorts-kinds.mjs');
  assert.equal(uploadTitle({ title: ['윗줄', '*강조* 아랫줄'] }), '윗줄 강조 아랫줄');
  assert.equal(uploadTitle({ uploadTitle: '업로드 제목', title: ['x'] }), '업로드 제목');
  assert.deepEqual(hashtagsOf({ hashtags: ['Shorts', '#웃긴 영상', '#Shorts'] }), ['#Shorts', '#웃긴영상']);
  assert.equal(uploadText({ uploadTitle: '제목', description: '설명', hashtags: ['#a'] }), '[영상 제목]\n제목\n\n[영상 설명]\n설명\n\n[해시태그]\n#a\n');
  assert.equal(SHORT_FOLDERS.viral, '꿀잼');
  assert.equal(SHORT_FOLDERS.celeb, '연예인');
}
