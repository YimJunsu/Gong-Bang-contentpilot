import assert from 'node:assert/strict';
import { validateClip, pickIds, withCredits, cropFilter, youtubeUrl, pickPrompt, scriptPrompt, extractArgs } from './clip.mjs';

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
  const sp = scriptPrompt({ topic: 'x', kind: 'viral', narrate: false, seconds: [10, 20] }, []);
  if (!sp.includes('구간 1~4개') || !sp.includes('10~20초')) throw new Error('viral 대본 지시');
  if (!sp.includes('오 지린다;') || !sp.includes('난입함')) throw new Error('viral 말투 지시');
  const { clipStyleOf } = await import('./title-styles.mjs');
  if (clipStyleOf({ kind: 'celeb' }).layout !== 'issue' || clipStyleOf({ kind: 'celeb', accent: 'purple' }).k !== '#a855ff' || clipStyleOf({ kind: 'viral' }).layout !== 'stamp' || clipStyleOf({ kind: 'celeb', clipStyle: 'chip' }).layout !== 'slim') throw new Error('탭별 기본 형식');
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

// mp3·mp4 추출기: 형식별 yt-dlp 인자, 파일 경로만 출력, 재생목록 아님
{
  const a3 = extractArgs('https://youtu.be/x', 'mp3', 'D:\dl');
  assert.ok(a3.includes('-x') && a3[a3.indexOf('--audio-format') + 1] === 'mp3' && a3.includes('--no-playlist'));
  assert.equal(a3[a3.indexOf('--print') + 1], 'after_move:filepath');
  const a4 = extractArgs('https://youtu.be/x', 'mp4', 'D:\dl');
  assert.ok(!a4.includes('-x') && a4[a4.indexOf('--merge-output-format') + 1] === 'mp4');
  assert.ok(a4[a4.indexOf('-o') + 1].startsWith('D:\dl'));
}
// ② 원작자만: 웃음·짤 모음 계정, 5분 넘는 영상은 뺀다(2026-11-22 실제 생성에서 걸린 경우)
{
  const { notCompilation, validateClip } = await import('./clip.mjs');
  assert.equal(notCompilation({ title: 'I can work under pressure', channel: 'Mzansi Laughter', duration: 120 }), false);
  assert.equal(notCompilation({ title: 'my dog vs vacuum', channel: 'Jenna Smith', duration: 580 }), false);
  assert.equal(notCompilation({ title: 'my dog vs vacuum', channel: 'Jenna Smith', duration: 45 }), true);
  const src = [{ n: 1, duration: 60 }];
  const v = validateClip({ title: ['a', 'b'], textZone: 'bottom', scenes: [{ src: 1, start: 0, end: 6, caption: '한편…', sub: '보충', subs: [{ at: 1, end: 3, text: '번역' }] }] }, src);
  assert.equal(v.scenes[0].caption, '', '번역 자막 있는 장면은 통자막 안 씀');
  assert.equal(v.scenes[0].sub, '');
  assert.equal(v.textZone, 'bottom');
  assert.equal(validateClip({ title: ['a'], textZone: 'middle', scenes: [{ src: 1, start: 0, end: 5, caption: '한 줄' }] }, src).textZone, 'none');
  console.log('clip.check source ok');
}
// ② 해설 형식: say 있는 장면은 해설이 자막(통자막·번역 자막 비움), 해설 문장 나누기·자막 타이밍
{
  const { validateClip, sayLines, narrationCaps, scriptPrompt, zoneOf } = await import('./clip.mjs');
  const src = [{ n: 1, duration: 60 }];
  const v = validateClip({ title: ['현장 고인물 감탄시킨', '신입 막내의 *일머리*'], scenes: [
    { src: 1, start: 0, end: 8, say: '현장에 신입이 두 명 들어왔는데요.  그리고 잠시 후', caption: 'x', subs: [{ at: 1, end: 2, text: 'y' }] },
    { src: 1, start: 8, end: 12, say: '', subs: [{ at: 9, end: 11, text: '번역' }] }] }, src);
  assert.equal(v.narrate, true);
  assert.deepEqual([v.scenes[0].caption, v.scenes[0].subs.length, v.scenes[0].say], ['', 0, '현장에 신입이 두 명 들어왔는데요. 그리고 잠시 후']);
  assert.equal(v.scenes[1].say, undefined, '해설 없는 장면(결정적 순간)은 원본 소리 + 번역 자막');
  assert.equal(v.scenes[1].subs.length, 1);
  assert.equal(validateClip({ title: ['a'], scenes: [{ src: 1, start: 0, end: 5, caption: 'c' }] }, src).narrate, false);
  assert.deepEqual(sayLines('11명 대가족인데요. 그리고 잠시 후! 엄청난 장면이'), ['11명 대가족인데요.', '그리고 잠시 후!', '엄청난 장면이']);
  const parts = [
    { start: 0, end: 2, text: '1m가 넘는 *팬에* 고기가 올라갑니다.', words: null },
    { start: 2.2, end: 4, text: '그리고 잠시 후', words: null }];
  const caps = narrationCaps(parts, 6);
  assert.ok(caps.length >= 2 && caps[0].at === 0);
  assert.equal(caps.at(-1).end, 6, '마지막 자막은 장면 끝까지');
  caps.forEach((c, k) => k && assert.equal(caps[k - 1].end, c.at, '자막 사이 빈틈 없음'));
  assert.ok(caps.some((c) => /\*팬에\*/.test(c.text)), '강조 유지');
  assert.equal(zoneOf({ textZone: 'bottom', scenes: [{ cover: [[18, 83, 64, 12]] }] }), 'cover');
  assert.equal(zoneOf({ textZone: 'bottom', scenes: [{}] }), 'bottom');
  const tail = narrationCaps([{ start: 0, end: 3, text: '다행히 이후 화해했다고 합니다.' }], 3).map((c) => c.text);
  assert.ok(tail.every((t) => t.length > 4), tail.join(' | '));
  const fast = narrationCaps(parts, 3, 1.3);
  assert.ok(fast.every((c) => c.end <= 3));
  const pr = scriptPrompt({ topic: 'x', kind: 'viral' }, [{ n: 1, title: 't', channel: 'c', duration: 30, sheets: [] }]);
  assert.match(pr, /"say"/); assert.match(pr, /그리고 잠시 후/);
  assert.doesNotMatch(scriptPrompt({ topic: 'x', kind: 'viral', narrate: false }, [{ n: 1, title: 't', channel: 'c', duration: 30, sheets: [] }]), /"say"/);
  console.log('clip.check story ok');
}
// ① 이슈 형식: 출처(from)·팬 반응(react)·TOP N 이름(label), 원본 최대 5개
{
  const { validateClip, scriptPrompt, pickIds, pickPrompt } = await import('./clip.mjs');
  const src = [{ n: 1, duration: 60 }, { n: 2, duration: 60 }];
  const v = validateClip({ title: ['기다리던 MAMA에서', '결국 눈물보인 *리센느*'], scenes: [
    { src: 1, start: 0, end: 5, from: '공식 인터뷰', caption: '업로드 당시 26년 5월|약속했던 두 사람' },
    { src: 2, start: 3, end: 9, from: 'MAMA', caption: '1년도 안 돼서 서게 됨', react: '와... 진짜 울컥' }] }, src);
  assert.equal(v.format, 'story');
  assert.deepEqual([v.scenes[0].from, v.scenes[1].react, v.scenes[0].react], ['공식 인터뷰', '와... 진짜 울컥', undefined]);
  const t = validateClip({ format: 'top', title: ['a', 'b'], scenes: [{ src: 1, start: 0, end: 6, label: '소녀시대 태연', caption: '한 줄 평' }] }, src);
  assert.equal(t.format, 'top'); assert.equal(t.scenes[0].label, '소녀시대 태연');
  assert.equal(validateClip({ title: ['a'], scenes: [{ src: 1, start: 0, end: 5, caption: 'c' }] }, src).format, undefined, '예전 대본은 형식 없음');
  const found = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `v${i}` }));
  assert.equal(pickIds({ picks: found.map((v) => ({ id: v.id })) }, found, 5).length, 5);
  assert.equal(pickIds({ picks: found.map((v) => ({ id: v.id })) }, found).length, 2);
  const pr = scriptPrompt({ topic: '리센느', kind: 'celeb' }, [{ n: 1, title: 't', channel: 'c', duration: 30, sheets: [] }]);
  assert.match(pr, /"react"/); assert.match(pr, /"from"/); assert.match(pr, /"top"/); assert.doesNotMatch(pr, /\nNL|'NL'/);
  assert.match(pickPrompt({ topic: '관객 난입 레전드' }, []), /TOP N/);
  console.log('clip.check issue ok');
}
// 원래 자막 모자이크(cover) + 이슈 형식 기본
{
  const { validateClip, mosaicFilter } = await import('./clip.mjs');
  const v = validateClip({ title: ['a'], scenes: [{ src: 1, start: 0, end: 5, caption: 'c', cover: [[5, 78, 90, 18], [1, 2], ['x', 1, 2, 3], [0, 0, 1, 1]] }] }, [{ n: 1, duration: 30 }]);
  assert.deepEqual(v.scenes[0].cover, [[5, 78, 90, 18]]);
  const f = mosaicFilter([[0, 80, 100, 20]], [1920, 1080]);
  assert.match(f, /crop=1920:216:0:864/); assert.match(f, /flags=neighbor/); assert.match(f, /\[mv\]$/);
  assert.equal(mosaicFilter([], [1920, 1080]), '');
  console.log('clip.check cover ok');
}
