// 캐릭터 숏폼 렌더: 줄마다 남자 목소리(감정 톤) → assets/character.html 무대를 프레임마다 캡처 → 장면 이어 붙이기.
// 음성·캡처·인코딩은 video.mjs(숏폼 렌더러)의 것을 그대로 쓴다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { buildVoice, renderScene, sfx, ffmpeg, duration, FONT_CHOICES } from './video.mjs';
import { charDir, wrapCaption } from './character.mjs';
import { LOOKS } from './shorts-kinds.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.join(HERE, 'assets', 'fonts');
const STAGE = pathToFileURL(path.join(HERE, 'assets', 'character.html')).href;
// 남자 목소리 기본값(설정의 목소리가 여자 기본값이어도 캐릭터 숏폼은 남자로). ElevenLabs는 설정의 목소리(기본 Adam, 남자)
export const MALE = { edge: 'ko-KR-InJoonNeural', google: 'ko-KR-Neural2-C' };

export function charTts(tts = {}, voice = '') {
  return { ...tts, voice: voice || MALE.edge, googleVoice: MALE.google, rate: tts.rate || '+12%' };
}

// 한 장면의 무대 데이터: 줄(beat) 시간·포즈·움직임·효과·팡 글자 시각·자막
export function charSceneData(scene, v, poses, fonts, dir) {
  const beats = v.parts.map((p, k) => {
    const line = scene.lines[k];
    const dur = Math.max(0.6, p.end - p.start);
    const step = Math.min(0.45, dur / Math.max(1, line.pop.length));
    return {
      start: k ? p.start : 0, end: k < v.parts.length - 1 ? v.parts[k + 1].start : v.seconds, voiceEnd: p.end, speaking: true,
      pose: line.pose, move: line.move, fx: line.fx, dir: k % 2 ? -1 : 1,
      pop: line.pop.map((text, j) => ({ text, at: p.start + 0.12 + j * step }))
    };
  });
  const captions = v.parts.map((p, k) => ({ start: beats[k].start, end: beats[k].end, text: wrapCaption(scene.lines[k].text) }));
  return { seconds: v.seconds, beats, captions, poses, fonts, bg: scene.media ? pathToFileURL(path.resolve(dir, scene.media)).href : null, index: 0, stamp: null };
}

export async function renderCharacter(dir, script, { root, tts = {}, voice = '', log = () => {} } = {}) {
  const work = path.join(dir, 'build');
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  const sounds = await sfx();
  const t = charTts(tts, voice);
  const voices = [];
  for (const [i, scene] of script.scenes.entries()) voices.push(await buildVoice(scene, i + 1, work, path.join(dir, 'voice-cache'), { ...t, log }, log));
  const poseDir = path.join(charDir(root), 'poses');
  const poses = {};
  for (const id of new Set(['idle', 'talk', ...script.scenes.flatMap((s) => s.lines.map((l) => l.pose))])) {
    const f = path.join(poseDir, `${id}.png`);
    if (await fs.stat(f).catch(() => null)) poses[id] = pathToFileURL(f).href;
  }
  const fonts = { P: pathToFileURL(path.join(FONTS, (FONT_CHOICES[script.titleFont] || FONT_CHOICES.ssurround).file)).href, B: pathToFileURL(path.join(FONTS, 'Pretendard-ExtraBold.otf')).href };
  const browser = await chromium.launch({ executablePath: tts.chromePath, headless: true, args: ['--allow-file-access-from-files'] });
  const clips = [];
  try {
    for (const [i, scene] of script.scenes.entries()) {
      // 컨셉 꾸미기(look): 위 제목 + (채팅 반응) 앞 장면 대사 이어 보기
      const history = script.scenes.slice(0, i).flatMap((s) => s.lines.map((l) => wrapCaption(l.text))).slice(-2);
      const data = { ...charSceneData(scene, voices[i], poses, fonts, dir), index: i + 1, look: LOOKS.character.includes(script.look) ? script.look : '', title: (script.title || [])[0] || '', history };
      const t0 = Date.now();
      // 장면 사이 '휙' 소리는 두 번째 장면부터(renderScene이 index로 판단)
      clips.push(await renderScene(browser, data, voices[i].voice, sounds, path.join(work, `scene-${String(i + 1).padStart(2, '0')}.mp4`), log, STAGE));
      log(`장면 ${i + 1}/${script.scenes.length}: ${data.seconds.toFixed(1)}초 · ${((Date.now() - t0) / 1000).toFixed(0)}초 걸림`);
    }
  } finally { await browser.close(); }
  const list = path.join(work, 'concat.txt');
  await fs.writeFile(list, clips.map((c) => `file '${c.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const out = path.join(dir, 'short.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], log);
  log(`완성: ${out} (${(await duration(out)).toFixed(1)}초)`);
  return out;
}
