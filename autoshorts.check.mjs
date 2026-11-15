// npm run check: 쇼츠 자동화 후보 거르기
import assert from 'node:assert/strict';
import { pickFresh, AUTO_CATS, weekSearchUrl } from './autoshorts.mjs';
const v = (id, o = {}) => ({ id, title: `t${id}`, channel: 'c', duration: 60, views: 10, verified: false, ...o });
const list = [v('a', { views: 5 }), v('b', { views: 50 }), v('c', { title: 'Funniest compilation' }), v('d', { duration: 5 }), v('e', { duration: 3600 }), v('b'), v('u', { views: 999 })];
const got = pickFresh(list, AUTO_CATS.comedy, new Set(['u']), 3).map((x) => x.id);
assert.deepEqual(got, ['b', 'a']); // 조회수 순, 모음·너무 짧은/긴 것·이미 쓴 것·중복 제외
assert.deepEqual(pickFresh([v('x'), v('y', { verified: true })], AUTO_CATS.kpop, new Set(), 2).map((x) => x.id), ['y']); // 연예인은 인증 채널만
assert.match(weekSearchUrl('a b'), /search_query=a%20b&sp=EgIIAw%253D%253D$/);
console.log('autoshorts.check ok');
