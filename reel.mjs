import fs from 'node:fs/promises';
import path from 'node:path';

export function reelPrompt({ topic, narration = '', style = 'info', files = [] }) {
  if (!String(topic || '').trim()) throw new Error('주제를 입력해 주세요');
  return [
    '릴스와 유튜브 쇼츠용 세로 영상의 대본을 작성한다. 결과는 이 폴더의 script.json 하나다.',
    `주제: ${topic}`,
    style === 'story' ? '이야기를 들려주듯 자연스럽게 구성한다. 시청자가 상상할 수 있는 구체적인 상황으로 시작하고, 갈등의 원인과 결과를 차례로 풀어 한 가지 인사이트로 마무리한다. 예시 인물이나 상황은 재구성된 예시임을 분명히 하며 허구를 실제 사건처럼 주장하지 않는다.' : '핵심 정보를 구어체로 설명한다. 상황이나 질문으로 시작하고, 원인·작동 방식·구체적 사례·시청자가 적용할 수 있는 결론을 연결한다.',
    '시의성이 있는 주장이나 통계는 신뢰할 수 있는 자료로 확인하고 description에 자료명과 주소를 적는다. 확인할 수 없는 수치나 단정적인 주장은 넣지 않는다. 해석과 사실을 구분한다.',
    narration ? `사용자가 제공한 대본을 그대로 낭독한다. 문장을 빠뜨리거나 추가하거나 바꾸지 말고 장면으로만 나눈다:\n${narration}` : '주제에 맞는 45~65초 분량의 구어체 대본을 직접 작성한다. 추상적인 일반론 대신 구체적 상황과 이유를 넣고 같은 말을 반복하지 않는다.',
    'script.json 형식: {"title":["짧은 제목","짧은 부제"],"badge":"", "scenes":[{"image_prompt":"장면에 맞는 이미지 설명 (영어)","stamp":"", "lines":[{"text":"낭독할 문장","tone":"normal"}]}],"description":"영상 설명", "hashtags":["#태그"]}',
    `장면은 ${files.length > 4 ? files.length : 4}개 이상, 8개 이하로 구성한다. 장면마다 서로 다른 구체적인 세로 이미지 설명을 작성한다. 이미지에 글자와 로고는 넣지 않는다. tone은 normal, emphasis, whisper, excited 중 하나다.`,
    '자연스러운 감정 변화를 위해 장면당 짧은 문장 1~3개를 각각 lines로 나눈다. 공감과 설명은 normal, 중요한 전환과 결론은 emphasis, 조심스럽거나 궁금한 대목에만 whisper, 기쁜 내용에만 excited를 쓴다. 과장하거나 모든 문장에 감정을 넣지 않는다.',
    ...(files.length ? [`사용자가 첨부한 이미지·영상이 ${files.length}개 있다. 이 순서대로 장면에 사용하므로 전체 파일이 쓰이도록 ${files.length}개 이상의 장면으로 나눈다.`] : []),
    '현재 작업 폴더 밖의 파일을 수정하지 않는다. 대본 외의 설명을 화면에 넣지 않는다. 질문하지 말고 파일을 작성하고 완료한다.'
  ].join('\n');
}

export function normalizeTopics(result) {
  const seen = new Set();
  const topics = (Array.isArray(result?.topics) ? result.topics : []).filter((x) => typeof x?.topic === 'string' && x.topic.trim()).map((x) => ({ topic: x.topic.trim().slice(0, 100), reason: typeof x.reason === 'string' ? x.reason.trim().slice(0, 160) : '' })).filter((x) => !seen.has(x.topic) && seen.add(x.topic)).slice(0, 6);
  if (!topics.length) throw new Error('추천 주제를 만들지 못했습니다. 다시 시도해 주세요');
  return topics;
}

export function assignMedia(scenes, files) {
  if (!files.length || files.length > scenes.length) throw new Error('첨부 파일을 모두 사용하려면 파일 수 이상의 장면이 필요합니다');
  scenes.forEach((scene, i) => { scene.media = files[i % files.length]; });
}

export async function validateImages(dir, scenes) {
  for (const [i, scene] of scenes.entries()) {
    const name = `scene-${String(i + 1).padStart(2, '0')}.png`;
    if (scene.media !== `media/${name}`) throw new Error(`장면 ${i + 1} 이미지 경로가 올바르지 않습니다`);
    const bytes = await fs.readFile(path.join(dir, 'media', name)).catch(() => null);
    if (!bytes || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error(`장면 ${i + 1} 이미지를 생성하지 못했습니다`);
  }
}

export function validateReel(script, narration = '') {
  if (!Array.isArray(script?.scenes) || !script.scenes.length || script.scenes.length > 8) throw new Error('대본의 장면 수가 올바르지 않습니다');
  for (const scene of script.scenes) {
    if (!scene.image_prompt?.trim()) throw new Error('장면 이미지 설명이 없습니다');
    if (!Array.isArray(scene.lines) || !scene.lines.length || scene.lines.some((line) => typeof line.text !== 'string' || !line.text.trim())) throw new Error('장면의 대본이 비었습니다');
  }
  const compact = (s) => s.replace(/\s+/g, '');
  if (narration.trim() && compact(script.scenes.flatMap((s) => s.lines.map((l) => l.text)).join('')) !== compact(narration)) throw new Error('입력한 대본이 변경되어 중단했습니다. 다시 시도해 주세요');
}
