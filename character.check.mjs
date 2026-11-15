// npm run check: 캐릭터 숏폼 대본 검사·자막 줄바꿈·프롬프트
import assert from 'node:assert/strict';
import { validateCharScript, wrapCaption, charScriptPrompt } from './character.mjs';
import { charSceneData } from './character-render.mjs';
const poses = ['idle', 'talk', 'smug', 'sad'];
const s = validateCharScript({ title: ['아이폰 특'], scenes: [{ bg_prompt: 'cafe', lines: [
  { text: ' 첫 줄 ', pose: 'jump', move: 'fly', fx: ['sweat', 'boom', 'heart', 'anger'], pop: ['아주아주아주긴글자입니다', 'b', 'c', 'd'] },
  { text: '', pose: 'smug' }, { text: '둘째', tone: 'angry', pose: 'smug' }] }] }, poses);
assert.equal(s.kind, 'character');
assert.equal(s.scenes[0].lines.length, 2);
assert.deepEqual(s.scenes[0].lines[0], { text: '첫 줄', tone: 'normal', pose: 'talk', move: 'idle', fx: ['sweat', 'heart'], pop: ['아주아주아주긴글자입', 'b', 'c'] });
assert.equal(s.scenes[0].media, 'media/bg-01.png');
assert.throws(() => validateCharScript({ scenes: [] }, poses), /장면/);
assert.equal(wrapCaption('충전기 빌려 달라 하면 일단 한숨 쉼'), '충전기 빌려 달라|하면 일단 한숨 쉼');
const p = charScriptPrompt({ topic: '월급날', format: 'rule', name: '오덕이' }, poses);
assert.ok(p.includes('smug(뻔뻔)') && !p.includes('jump(') && p.includes('국룰'));
const d = charSceneData(s.scenes[0], { seconds: 5, parts: [{ start: 0, end: 2 }, { start: 2.2, end: 4.5 }] }, {}, {}, 'D:/x');
assert.equal(d.beats[0].end, 2.2); assert.equal(d.beats[1].end, 5); assert.equal(d.beats[0].pop.length, 3);
console.log('character.check ok');
