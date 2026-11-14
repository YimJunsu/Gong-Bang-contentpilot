import assert from 'node:assert/strict';
import { reelPrompt, validateReel, validateImages, assignMedia, normalizeTopics } from './reel.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

assert.throws(() => reelPrompt({ topic: '  ' }), /주제/);
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
