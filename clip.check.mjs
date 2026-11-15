import assert from 'node:assert/strict';
import { validateClip, pickIds, withCredits, cropFilter, youtubeUrl, pickPrompt, scriptPrompt } from './clip.mjs';

const sources = [{ n: 1, url: 'https://www.youtube.com/watch?v=a', channel: 'M2', duration: 60 }];
const ok = validateClip({ title: ['윗줄', '*아랫줄*'], scenes: [{ src: 1, start: '3.04', end: 7, focus: [150, 'x'], caption: ' 자막 ' }] }, sources);
assert.equal(ok.layout, 'clip');
assert.deepEqual(ok.scenes[0], { src: 1, start: 3, end: 7, focus: [100, 40], caption: '자막', sub: '', subs: [], pops: [] });
assert.throws(() => validateClip({ title: ['a'], scenes: [{ src: 2, start: 0, end: 3 }] }, sources), /원본 번호/);
assert.throws(() => validateClip({ title: ['a'], scenes: [{ src: 1, start: 50, end: 70 }] }, sources), /원본 길이/);
assert.throws(() => validateClip({ title: ['a'], scenes: [{ src: 1, start: 5, end: 5.2 }] }, sources), /시각/);
assert.throws(() => validateClip({ title: [''], scenes: [{ src: 1, start: 0, end: 3 }] }, sources), /제목/);
assert.throws(() => validateClip({ title: ['a'], scenes: [] }, sources), /구간 수/);

const found = [{ id: 'a', url: 'u1' }, { id: 'b', url: 'u2' }, { id: 'c', url: 'u3' }];
assert.deepEqual(pickIds({ picks: [{ id: 'zz' }, { id: 'b' }, { id: 'b' }, { id: 'a' }, { id: 'c' }] }, found).map((v) => v.id), ['b', 'a']);
assert.throws(() => pickIds({ picks: [{ id: 'zz' }] }, found), /고르지/);

// 출처는 코드가 붙이고, AI가 쓴 출처 문단은 덮어쓴다
assert.equal(withCredits('설명\n\n출처: 아무거나', sources), '설명\n\n출처\nM2 https://www.youtube.com/watch?v=a');
assert.match(cropFilter([30, 40]), /iw\*0\.3-ow\/2/);
assert.ok(youtubeUrl('https://youtu.be/dblLC2fqLXY') && youtubeUrl('https://www.youtube.com/watch?v=x') && youtubeUrl('https://www.youtube.com/shorts/x'));
assert.ok(!youtubeUrl('https://evil.com/youtube.com/watch?v=x') && !youtubeUrl('file:///c:/x'));
assert.match(pickPrompt({ topic: '안나' }, [{ id: 'a', channel: 'M2', duration: 3, views: 1, title: 't' }]), /id=a/);
const sp = scriptPrompt({ topic: '안나', mute: true }, [{ n: 1, title: 't', channel: 'M2', duration: 60, sheets: ['s.jpg'], hot: [[10, 14]] }]);
assert.match(sp, /s\.jpg/); assert.match(sp, /10-14/); assert.match(sp, /성적 표현/); assert.match(sp, /소리는 끄고/);
console.log('clip.check ok');

// ② 해외 재밌는 영상: 모음·리액션 채널 거르기, 원작자 고르기·짧은 구간 지시
{
  const { notCompilation, pickPrompt, scriptPrompt } = await import('./clip.mjs');
  const ok = (title, channel) => notCompilation({ title, channel });
  if (!ok('Drummer pulls out new sticks for guests', 'Drumeo') || ok('TRY NOT TO LAUGH compilation', 'x') || ok('고양이 웃긴 영상 모음', '냥이') || ok('First time reaction to', 'React Guy')) throw new Error('모음·리액션 거르기');
  if (!pickPrompt({ topic: 'drum', kind: 'viral' }, []).includes('원작자 채널 영상만')) throw new Error('viral 고르기 지시');
  const sp = scriptPrompt({ topic: 'x', kind: 'viral', seconds: [10, 20] }, []);
  if (!sp.includes('구간 1~4개') || !sp.includes('10~20초')) throw new Error('viral 대본 지시');
  if (!sp.includes('오 지린다;') || !sp.includes('난입함')) throw new Error('viral 말투 지시');
  const { clipStyleOf } = await import('./title-styles.mjs');
  if (clipStyleOf({ kind: 'celeb' }).layout !== 'slim' || clipStyleOf({ kind: 'viral' }).layout !== 'sticker') throw new Error('탭별 기본 형식');
  console.log('clip.check viral ok');
}

// 번역 자막·반응 말풍선: 구간 안으로 자르고 장면 시각(0초부터)으로, 겹치면 앞 자막을 끊는다. pops가 있으면 통자막(caption)은 뺀다
{
  const { validateClip: vc, parseJson3, transcriptText } = await import('./clip.mjs');
  const src = [{ n: 1, duration: 60, channel: 'c', url: 'u', title: 't', file: 'f' }];
  const s = vc({ title: ['a', 'b'], scenes: [{ src: 1, start: 10, end: 20, caption: '통자막', subs: [{ at: 9, end: 12, text: '안녕|하세요' }, { at: 11.5, end: 25, text: '둘째' }, { at: 15, end: 15.1, text: '짧음' }], pops: [{ at: 14, text: '오 지린다;' }, { at: 19.9, text: '끝 직전' }] }] }, src).scenes[0];
  assert.deepEqual(s.subs, [{ at: 0, end: 1.5, text: '안녕|하세요' }, { at: 1.5, end: 10, text: '둘째' }]);
  assert.deepEqual(s.pops, [{ at: 4, end: 5.8, text: '오 지린다;' }]);
  assert.equal(s.caption, '');
  const cues = parseJson3(JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'hello ' }, { utf8: 'there' }] }, { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: '\n' }] }, { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: '[Music]' }] }, { tStartMs: 3500, dDurationMs: 2000, segs: [{ utf8: 'next one' }] }] }));
  assert.deepEqual(cues, [{ start: 1, end: 3.5, text: 'hello there' }, { start: 3.5, end: 5.5, text: 'next one' }]);
  assert.equal(transcriptText(cues), '[1-3.5] hello there\n[3.5-5.5] next one');
  assert.deepEqual(parseJson3('not json'), []);
}
