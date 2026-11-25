import assert from 'node:assert/strict';
import { reelPrompt, ssulPrompt, validateReel, validateImages, assignMedia, normalizeTopics } from './reel.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// 빈 주제: 요즘 화제에서 AI가 고른다(2026-11-22)
assert.match(reelPrompt({ topic: '  ', hints: ['겨울 난방비'] }), /주제는 직접 정한다[\s\S]*겨울 난방비/);
// 썰: 참고 글은 베끼지 않고 바꿔 쓰기, 비우면 말투만 빌려 새로
const sp = ssulPrompt({ source: '소개팅 나갔는데 팀장이 나옴', voice: 'pann' });
assert.match(sp, /<참고 글>[\s\S]*팀장이 나옴/);
assert.match(sp, /베끼지 않는다/);
assert.match(sp, /판체/);
assert.match(sp, /image_prompt/);
const sp2 = ssulPrompt({ hints: ['수능'] });
assert.match(sp2, /참고 글 없음/);
assert.match(sp2, /주제는 직접 정한다[\s\S]*수능/);
assert.match(sp2, /더쿠체/);
const prompt = reelPrompt({ topic: '커피 이야기', narration: '첫 문장입니다. 둘째 문장입니다.', style: 'story' });
assert.match(prompt, /커피 이야기/);
assert.match(prompt, /첫 문장입니다\. 둘째 문장입니다\./);
assert.match(prompt, /그대로/);
assert.match(prompt, /image_prompt/);
assert.match(reelPrompt({ topic: '취업', style: 'story' }), /감정/);
assert.deepEqual(normalizeTopics({ topics: [{ topic: ' 취업의 역설 ', reason: '공감' }, { topic: '취업의 역설', reason: '반복' }, { topic: '' }] }), [{ topic: '취업의 역설', reason: '공감' }]);
assert.throws(() => normalizeTopics({ topics: [] }), /추천/);
const script = { scenes: [{ image_prompt: 'A cup of coffee', lines: [{ text: '첫 문장입니다.' }, { text: '둘째 문장입니다.' }] }] };
assert.doesNotThrow(() => validateReel(script, '첫 문장입니다. 둘째 문장입니다.'));
assert.throws(() => validateReel(script, '다른 문장'), /대본/);
assert.throws(() => validateReel({ scenes: [{ lines: [{ text: '안녕' }] }] }), /이미지/);
const mediaScenes = [{}, {}, {}];
assignMedia(mediaScenes, ['media/01.jpg', 'media/02.mp4']);
assert.deepEqual(mediaScenes.map((s) => s.media), ['media/01.jpg', 'media/02.mp4', 'media/01.jpg']);
assert.throws(() => assignMedia([{}], ['media/a.jpg', 'media/b.mp4']), /장면/);
assert.match(reelPrompt({ topic: '취업', files: ['a.jpg', 'b.mp4'] }), /2개 이상의 장면/);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reel-test-'));
try {
  const scenes = [{ media: 'media/scene-01.png' }];
  await assert.rejects(() => validateImages(dir, scenes), /이미지/);
  await fs.mkdir(path.join(dir, 'media'));
  await fs.writeFile(path.join(dir, 'media', 'scene-01.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await validateImages(dir, scenes);
  await assert.rejects(() => validateImages(dir, [{ media: '../outside.png' }]), /이미지/);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('reel.check ok');
// 컨셉 꾸미기: 종류마다 정해진 것만, 없으면 돌아가며
{
  const { lookFor, LOOKS } = await import('./shorts-kinds.mjs');
  assert.equal(lookFor('topic', 'info-num'), 'info-num');
  assert.ok(LOOKS.topic.includes(lookFor('topic', 'scrap', 3)));
  assert.deepEqual([0, 1, 2].map((n) => lookFor('ssul', '', n)), ['ssul-photo', 'ssul-photo', 'ssul-photo'], '썰은 실사 사진 한 가지');
  assert.equal(lookFor('material'), 'scrap');
  assert.match(reelPrompt({ topic: '연말정산' }), /info-check[\s\S]*point/);
  console.log('reel.check looks ok');
}
