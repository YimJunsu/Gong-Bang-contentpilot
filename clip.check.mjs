import assert from 'node:assert/strict';
import { validateClip, pickIds, withCredits, cropFilter, youtubeUrl, pickPrompt, scriptPrompt } from './clip.mjs';

const sources = [{ n: 1, url: 'https://www.youtube.com/watch?v=a', channel: 'M2', duration: 60 }];
const ok = validateClip({ title: ['윗줄', '*아랫줄*'], scenes: [{ src: 1, start: '3.04', end: 7, focus: [150, 'x'], caption: ' 자막 ' }] }, sources);
assert.equal(ok.layout, 'clip');
assert.deepEqual(ok.scenes[0], { src: 1, start: 3, end: 7, focus: [100, 40], caption: '자막', sub: '' });
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
