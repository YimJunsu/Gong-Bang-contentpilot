// 캐릭터 숏폼(설계 docs/캐릭터-숏폼-설계.md): 블로그 폴더마다 캐릭터 하나 + 포즈 세트.
// 포즈 세트는 한 번 만들어 사람이 검수(승인)하고, 영상마다 다시 쓴다(얼굴이 매번 달라지지 않게).
// 저장 위치: <블로그 폴더>\_character\{character.json, ref.<확장자>, poses\<id>.png, raw\<id>.png}
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { UPLOAD_RULE } from './shorts-kinds.mjs';

export const POSES = [
  ['idle', '기본', 'standing calmly, neutral relaxed face'],
  ['talk', '말하기', 'same as neutral standing but beak wide open as if talking'],
  ['laugh', '웃음', 'laughing happily, eyes squeezed, beak wide open'],
  ['smug', '뻔뻔', 'smug cocky face, half-closed eyes, sly grin, wings on hips, chest puffed out'],
  ['surprised', '놀람', 'shocked, eyes popping, beak dropped open, wings raised'],
  ['sad', '울상', 'sad and teary, drooping posture, small tears'],
  ['angry', '화남', 'angry, frowning brows, stomping, wings flapping'],
  ['think', '생각', 'thinking, one wing touching beak, eyes looking up'],
  ['point_left', '왼쪽 가리키기', 'pointing to the viewer\'s left with one wing, body turned slightly left'],
  ['point_right', '오른쪽 가리키기', 'pointing to the viewer\'s right with one wing, body turned slightly right'],
  ['thumbs', '엄지척', 'giving a proud thumbs-up gesture with a wing, confident smile'],
  ['jump', '점프', 'jumping in the air joyfully, feet off the ground, wings spread'],
  ['run', '달리기', 'running fast to the side, motion pose, determined face'],
  ['hold', '들기', 'holding both wings forward as if presenting an object, nothing in the wings'],
  ['shy', '부끄러움', 'shy and blushing, wings covering cheeks, looking away'],
  ['sleepy', '졸림', 'sleepy and drowsy, eyes half closed, slightly slumped']
];
export const POSE_IDS = POSES.map(([id]) => id);

export const charDir = (root) => path.join(root, '_character');
const infoFile = (root) => path.join(charDir(root), 'character.json');

// 블로그 폴더 안의 상대 경로만 받는다(폴더 밖 파일 금지)
export function insideRoot(root, rel) {
  if (!rel) return null;
  const abs = path.resolve(root, rel);
  const r = path.resolve(root) + path.sep;
  return abs.startsWith(r) && existsSync(abs) ? abs : null;
}

export async function readCharacter(root) {
  const info = JSON.parse(await fs.readFile(infoFile(root), 'utf8').catch(() => '{}'));
  const poses = {};
  for (const id of POSE_IDS) {
    const file = path.join(charDir(root), 'poses', `${id}.png`);
    if (existsSync(file)) poses[id] = { approved: Boolean(info.approved?.[id]), at: (await fs.stat(file)).mtimeMs };
  }
  return { name: info.name || '', ref: info.ref || '', notes: info.notes || '', voice: info.voice || '', poses };
}

export async function saveCharacter(root, patch) {
  const cur = JSON.parse(await fs.readFile(infoFile(root), 'utf8').catch(() => '{}'));
  const next = { ...cur };
  if (typeof patch.name === 'string') next.name = patch.name.trim().slice(0, 30);
  for (const k of ['ref', 'notes']) {
    if (typeof patch[k] !== 'string') continue;
    if (patch[k] && !insideRoot(root, patch[k])) throw new Error(`${k === 'ref' ? '기준 그림' : '설명 파일'}이 블로그 폴더 안에 없습니다: ${patch[k]}`);
    next[k] = patch[k].replace(/\//g, '\\');
  }
  if (patch.approve && POSE_IDS.includes(patch.approve.id)) next.approved = { ...next.approved, [patch.approve.id]: Boolean(patch.approve.on) };
  await fs.mkdir(charDir(root), { recursive: true });
  await fs.writeFile(infoFile(root), JSON.stringify(next, null, 2));
  return readCharacter(root);
}

// codex 이미지 생성 지시. 기준 그림은 -i로 붙이고, 작업 폴더 raw\에 초록 배경 PNG로 받는다
export function posePrompt({ name, notesText = '' }, ids) {
  return [
    `캐릭터 '${name}'의 포즈 그림을 만든다. 첨부한 기준 그림이 이 캐릭터의 정답 외형이다.`,
    notesText ? `캐릭터 설명(외형 규칙은 반드시 지킨다):\n${notesText.slice(0, 4000)}` : '',
    '내장 image_gen.imagegen 도구로 아래 포즈마다 1024x1024 이미지를 한 장씩 만든다. 첨부한 기준 그림을 참고 이미지로 넣어 얼굴·몸 비율·질감·색을 똑같이 유지한다.',
    '모든 그림 공통: 캐릭터 한 마리만, 몸 전체가 잘리지 않고 화면 가운데 약 75% 크기, 배경은 완전히 균일한 순수 초록색(#00FF00) 단색. 바닥 그림자·바닥면·글자·로고·다른 물건·테두리 없음. 캐릭터 몸에는 초록색을 쓰지 않는다.',
    '생성된 실제 이미지 파일을 raw\\<id>.png 로 복사한다. 코드로 그린 그림·빈 파일·대체 이미지를 쓰지 않는다. 도구를 쓸 수 없으면 실패를 보고하고 멈춘다. 작업 폴더 밖 파일은 건드리지 않는다.',
    '포즈 목록(id: 설명):',
    ...ids.map((id) => `- ${id}: ${POSES.find((p) => p[0] === id)[2]}`)
  ].filter(Boolean).join('\n');
}

// 초록 배경 지우기: 초록이 다른 색보다 확연히 강한 곳은 투명, 경계는 반투명 + 초록 번짐 제거. 그 뒤 빈 테두리 자르기
export async function keyGreen(src, dst) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const spill = g - Math.max(r, b);
    if (spill > 90) data[i + 3] = 0;
    else if (spill > 30) data[i + 3] = Math.round(255 * (90 - spill) / 60);
    if (spill > 0) data[i + 1] = Math.max(r, b); // 털 끝에 묻은 초록 빼기
  }
  const keyed = await sharp(data, { raw: info }).png().toBuffer();
  await sharp(keyed).trim({ threshold: 1 }).extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(dst);
  return dst;
}

// 승인된 포즈만(영상에 쓰는 것)
export const approvedPoses = (ch) => Object.entries(ch.poses).filter(([, p]) => p.approved).map(([id]) => id);

// ---- 영상 만들기(2·3단계) ----
export const CHAR_FORMATS = {
  tuk: { name: '○○ 특', desc: '"○○하는 사람 특징"을 하나씩 나열하다 마지막에 반전', example: '아이폰 쓰는 사람 특' },
  rule: { name: '○○할 때 국룰', desc: '다들 하는 행동을 공감 가게 나열', example: '월급날 국룰' },
  vs: { name: '비교', desc: '두 부류를 번갈아 비교(○○ vs ○○)', example: '계획형 vs 즉흥형 여행' },
  free: { name: '자유', desc: '주제에 맞게 자유롭게', example: '' }
};
export const CHAR_LENGTHS = { short: [20, 30], normal: [30, 40], long: [40, 55] };
export const MOVES = ['idle', 'bounce', 'shake', 'pop', 'zoom', 'jump', 'slide', 'tilt', 'nod'];
export const FX = ['sweat', 'sparkle', 'anger', 'question', 'heart', 'shock'];

export function charScriptPrompt({ topic, format = 'tuk', notes = '', length = 'normal', name, hints = [], avoid = [] }, poses) {
  const f = CHAR_FORMATS[format] || CHAR_FORMATS.free;
  const [a, b] = CHAR_LENGTHS[length] || CHAR_LENGTHS.normal;
  const poseList = POSES.filter(([id]) => poses.includes(id)).map(([id, ko]) => `${id}(${ko})`).join(', ');
  return [
    `유튜브 쇼츠용 캐릭터 영상 대본을 쓴다. 캐릭터 '${name}'가 화면 아래에 크게 서서 표정·자세를 바꾸고, 남자 목소리 내레이션이 깔린다. 결과는 이 폴더의 script.json 하나다.`,
    // 빈 주제: 요즘 화제에서 AI가 공감형 주제를 고른다(2026-11-22)
    topic ? `주제: ${topic}` : `주제는 직접 정한다: 이 형식에 맞고 쇼츠 조회수가 잘 나올 공감 주제 하나(정치·사건사고·특정인 비방 금지).${hints.length ? ` 요즘 화제(참고만): ${hints.slice(0, 60).join(' / ')}` : ''}${avoid.length ? ` 이미 만든 주제(피한다): ${avoid.slice(0, 20).join(' / ')}` : ''}`, `형식: ${f.name} — ${f.desc}`, notes ? `요청(따른다): ${notes}` : '',
    '',
    '말투(가장 중요): 커뮤니티 썰 푸는 능청스러운 반말 내레이션. 문장 끝은 ~함/~거림/~임/~됨/~하는 편 같은 짧은 관찰체("맥날 카훗코 아이키아 거림", "할인 문자 오면 일단 장바구니부터 담음"). 구체적인 행동·대사·브랜드 같은 디테일로 웃긴다. 설명문·존댓말·교훈 금지. 마지막 줄은 반전이나 뼈 때리는 한 방.',
    '첫 줄은 3초 안에 멈추게 하는 훅: 주제를 그대로 외치거나("아이폰 쓰는 사람 특"), 공감 질문으로 시작.',
    '',
    'script.json 형식:',
    '{"title":["업로드 제목(20자 이내)"],"scenes":[{"bg_prompt":"배경 그림 설명(영어)","lines":[{"text":"읽을 문장","tone":"normal","pose":"smug","move":"bounce","fx":["sparkle"],"pop":["팡 글자1","팡 글자2"]}]}],"description":"업로드 설명 2~3줄","hashtags":["#태그"]}',
    `- 장면 1~3개, 줄은 모두 합쳐 ${Math.round(a / 3.5)}~${Math.round(b / 3.5)}개, 읽는 시간 합쳐서 ${a}~${b}초를 넘기지 않는다(한 줄 2~4초, 16자 안팎).`,
    `- pose는 이 중에서만: ${poseList}. 말하는 평범한 줄은 talk나 idle, 감정이 실린 줄은 맞는 표정. 같은 포즈를 3줄 넘게 연달아 쓰지 않는다.`,
    `- move: ${MOVES.join('·')} 중 하나(줄 시작 때 몸 동작). fx: ${FX.join('·')} 중 0~2개(머리 근처 효과).`,
    '- pop: 화면 위쪽에 손글씨처럼 크게 "팡" 하고 뜨는 글자 0~3개, 하나에 2~6자, 그 줄의 핵심 단어·감탄("맥날!", "카훗코!", "ㄹㅇ?", "0원"). 모든 줄에 넣지 말고 절반 정도에만. *별표* 1곳은 색 강조.',
    '- tone: normal·emphasis·excited·whisper·angry 중 하나(대부분 normal).',
    '- bg_prompt: 세로 9:16 배경. 주제에 맞는 장소(카페·지하철·방·회사 등), 밝고 부드러운 3D 렌더 느낌, 뒤는 살짝 흐리게, 화면 아래 절반은 캐릭터가 설 수 있게 비워 둔다. 사람·캐릭터·글자·로고 없음.',
    '- 실존 인물 비하·혐오·성적 표현 금지. 브랜드는 가볍게 언급만.',
    UPLOAD_RULE,
    '- 질문하지 말고 끝까지 진행한다. 이 폴더 밖 파일을 수정하지 않는다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter((l) => l !== '').join('\n');
}

// AI 대본 검사·정리: 승인된 포즈만, 모르는 움직임·효과는 빼고, 팡 글자는 짧게
export function validateCharScript(script, poses) {
  const scenes = Array.isArray(script?.scenes) ? script.scenes.slice(0, 3) : [];
  const clean = scenes.map((s, i) => {
    const lines = (Array.isArray(s?.lines) ? s.lines : []).map((l) => ({
      text: String(l?.text || '').trim(),
      tone: ['normal', 'emphasis', 'excited', 'whisper', 'angry'].includes(l?.tone) ? l.tone : 'normal',
      pose: poses.includes(l?.pose) ? l.pose : (poses.includes('talk') ? 'talk' : poses[0]),
      move: MOVES.includes(l?.move) ? l.move : 'idle',
      fx: (Array.isArray(l?.fx) ? l.fx : []).filter((x) => FX.includes(x)).slice(0, 2),
      pop: (Array.isArray(l?.pop) ? l.pop : []).map((p) => String(p || '').trim()).filter(Boolean).slice(0, 3).map((p) => p.slice(0, 10))
    })).filter((l) => l.text);
    if (!lines.length) throw new Error(`장면 ${i + 1}에 문장이 없습니다`);
    return { bg_prompt: String(s.bg_prompt || '').trim() || 'soft blurred cozy room background, warm light, no people, no text', lines, media: `media/bg-${String(i + 1).padStart(2, '0')}.png` };
  });
  if (!clean.length) throw new Error('script.json에 장면이 없습니다');
  return { ...script, kind: 'character', title: [String(script.title?.[0] || '').trim()].filter(Boolean), scenes: clean, hashtags: Array.isArray(script.hashtags) ? script.hashtags : [] };
}

// 자막 줄바꿈: 길면 두 줄로, 가운데에 가장 가까운 띄어쓰기에서 '|' (두 줄 길이를 비슷하게)
export function wrapCaption(text, max = 15) {
  const t = String(text).trim();
  if (t.length <= max) return t;
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i += 1) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? t : `${t.slice(0, best)}|${t.slice(best + 1)}`;
}
