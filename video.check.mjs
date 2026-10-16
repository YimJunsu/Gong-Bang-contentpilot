// node video.check.mjs — 자막 묶기 로직 자체 검사
import assert from 'node:assert';
import { chunkCaptions, markEmphasis, prosodyFor, pauseAfter } from './video.mjs';

const words = [
  { part: '인천 ', start: 45, end: 409 }, { part: '행복주택 ', start: 420, end: 999 }, { part: '110호, ', start: 1011, end: 1670 },
  { part: '기본 ', start: 1886, end: 2159 }, { part: '월세 ', start: 2170, end: 2454 }, { part: '14만 ', start: 2465, end: 3056 },
  { part: '6700원부터 ', start: 3068, end: 4215 }, { part: '시작합니다. ', start: 4227, end: 5034 }, { part: '마감은 ', start: 5200, end: 5600 }
];
const chunks = chunkCaptions('', words, 6.2);
assert.ok(chunks.every((c) => c.text.length <= 22), '한 덩어리 22자 이하');
assert.equal(chunks[0].start, 0, '첫 자막은 0초부터');
assert.equal(chunks.at(-1).end, 6.2, '마지막 자막은 끝까지');
chunks.slice(1).forEach((c, i) => assert.equal(c.start, chunks[i].end, '빈틈 없음'));
assert.ok(chunks.some((c) => c.text.endsWith('시작합니다.')) && chunks.at(-1).text.startsWith('마감은'), '문장 끝에서 끊음');

const even = chunkCaptions('가나 다라마 바사', null, 3);
assert.equal(even.map((c) => c.text).join(' '), '가나 다라마 바사', '타이밍 없을 때 글자 비례');
assert.equal(even.at(-1).end, 3);
assert.equal(markEmphasis('제가 딱 세 개로 줄여 드릴게요.', '제가 *딱 세 개*로 줄여 드릴게요.'), '제가 *딱 세 개로* 줄여 드릴게요.', '조사 붙은 강조 어절');
assert.equal(markEmphasis('보통 문장입니다.', '보통 문장입니다.'), '보통 문장입니다.', '강조 없음');
// 자연스러운 감정: 기본 속도 위에 더하고, 보통 문장은 조금씩 흔들린다
assert.deepEqual(prosodyFor('angry', 0, '+10%'), { rate: '+20%', pitch: '+5%' });
assert.deepEqual(prosodyFor('whisper', 0, '+10%'), { rate: '+2%', pitch: '-3%' });
assert.notDeepEqual(prosodyFor('normal', 0, '+10%'), prosodyFor('normal', 1, '+10%'), '보통 문장끼리 조금 다름');
assert.ok(pauseAfter('정말요?', 'normal') > pauseAfter('그래서,', 'normal'), '물음표 뒤가 쉼표 뒤보다 길다');
assert.ok(pauseAfter('알려 드릴게요.', 'whisper') > pauseAfter('알려 드릴게요.', 'normal'), '속삭이기 전엔 한 박자');
assert.ok(pauseAfter('알려 드릴게요.', 'angry') < pauseAfter('알려 드릴게요.', 'normal'), '화남으로 넘어갈 땐 바짝');
console.log('video.check ok', chunks.map((c) => c.text));
