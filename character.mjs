// 캐릭터 숏폼(설계 docs/캐릭터-숏폼-설계.md): 블로그 폴더마다 캐릭터 하나 + 포즈 세트.
// 포즈 세트는 한 번 만들어 사람이 검수(승인)하고, 영상마다 다시 쓴다(얼굴이 매번 달라지지 않게).
// 저장 위치: <블로그 폴더>\_character\{character.json, ref.<확장자>, poses\<id>.png, raw\<id>.png}
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

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
