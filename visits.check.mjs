// 댓글 답방 순수 로직 자체 검사 (npm run check)
import assert from 'node:assert/strict';
import { emptyStore, mergeComments, pickTargets, sendBlock, applyDrafts, draftPrompt, LIMITS } from './visits.mjs';

const c = (id, blogId, at = '2026-11-10T10:00:00Z') => ({ id, at, author: { name: blogId, blogId }, comment: '잘 봤어요', myPost: { title: '내 글' } });
const s = emptyStore();
assert.equal(mergeComments(s, [c('a', 'kim'), c('b', 'lee'), c('a', 'kim'), { id: 'x' }]), 2, '중복·작성자 없는 댓글은 빼고 더한다');
mergeComments(s, [c('c', 'oducki'), c('d', 'kim', '2026-11-09T10:00:00Z')]);

const now = Date.parse('2026-11-10T12:00:00Z');
const picked = pickTargets(s, { myBlogId: 'oducki', buddyIds: ['kim'], now });
assert.deepEqual(picked.map((p) => p.id), ['a'], '서로이웃만, 같은 사람은 한 번만');
assert.equal(s.items.b.reason, '서로이웃 아님');
assert.equal(s.items.c.reason, '내 블로그');
assert.equal(s.items.d.status, 'skipped', '같은 사람의 두 번째 댓글은 건너뛴다(한 사람에 한 번)');

// 초안 반영: preparing 상태만, skip은 건너뜀
s.items.a.status = 'preparing';
assert.equal(applyDrafts(s, { drafts: [{ id: 'a', text: ' 후쿠오카 우동 맛있어 보여요. 들러 주셔서 감사해요! ' }, { id: 'b', text: '무시' }] }), 1);
assert.equal(s.items.a.status, 'drafted');
assert.equal(s.items.a.draft.startsWith('후쿠오카'), true);
assert.equal(s.items.b.status, 'skipped', '이미 건너뛴 항목은 초안을 받아도 그대로');

// 같은 사람은 초안이 있으면 7일 동안 다시 고르지 않는다
s.items.d.status = 'new';
assert.deepEqual(pickTargets(s, { myBlogId: 'oducki', buddyIds: ['kim'], now }).map((p) => p.id), []);

// 보내기 제한
s.items.a.target = { url: 'https://m.blog.naver.com/kim/1' };
assert.equal(sendBlock(s, s.items.a, now), '');
s.items.a.status = 'sent'; s.items.a.sentAt = new Date(now - 10_000).toISOString();
assert.match(sendBlock(s, s.items.a, now), /이미 보낸/);
const other = { status: 'drafted', target: { url: 'u' } };
assert.match(sendBlock(s, other, now), /초 뒤에/, '간격 안 지키면 막는다');
for (let i = 0; i < LIMITS.perDay; i += 1) s.items[`s${i}`] = { status: 'sent', sentAt: new Date(now - 3600_000 - i).toISOString(), author: { blogId: `p${i}` } };
assert.match(sendBlock(s, other, now), /오늘은/, '하루 상한');

assert.match(draftPrompt([{ id: 'q', author: { name: '이웃' }, target: { title: 't', text: '본문' } }]), /=== id: q/);
console.log('visits.check ok');
