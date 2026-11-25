import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_RULE } from './shorts-kinds.mjs';

// 빈 칸으로 만들 때 AI에게 주는 요즘 화제(핫 키워드·숏텐츠). 서버가 모은다
export const hintText = (hints = []) => (hints.length ? `요즘 화제(참고만, 수치·인기는 지어내지 않는다): ${hints.slice(0, 60).join(' / ')}` : '');
const avoidText = (avoid = []) => (avoid.length ? `이미 만든 주제(겹치지 않게 피한다): ${avoid.slice(0, 20).join(' / ')}` : '');
const PICK_TOPIC = '주제는 직접 정한다: 아래 요즘 화제 중 쇼츠 조회수가 잘 나올 만한 것(공감·궁금증·이득이 크고, 정치·사건사고·혐오·특정인 비방이 아닌 것) 하나를 고른다. 화제가 없으면 누구나 공감할 생활 주제로.';

// 썰 말투 프리셋(2026-11-22). 커뮤니티 글은 자동으로 긁지 않는다(더쿠·네이트판 robots.txt가 막음) — 사람이 붙여 넣은 글만 바꿔 쓰고, 비우면 말투만 빌려 새로 쓴다
export const SSUL_VOICES = {
  theqoo: { name: '더쿠체', desc: '덬들 수다, ~함·~임·~ㅠㅠ', rule: '익명 여초 커뮤니티 수다 말투: 반말 관찰체(~함/~임/~했음/~인 거임), 감탄은 ㅠㅠ·ㅋㅋ·;; 조금, "아니 근데", "진짜 개웃긴 게" 같은 연결. 과한 비속어 금지.' },
  pann: { name: '판체', desc: '사연 글, ~했어요·~인데요', rule: '사연 게시판 글 말투: "안녕하세요 20대 직장인인데요" 같은 자기소개로 시작하는 존댓말 사연체(~했어요/~인데요/~거든요), 중간중간 당황·억울한 감정 표현, 끝은 "여러분이라면 어떡하실 것 같나요?" 같은 질문.' },
  friend: { name: '친구한테 썰 풀듯', desc: '야 들어봐, 반말 구어', rule: '친구한테 술자리에서 썰 푸는 반말 구어("야 들어봐", "근데 여기서 반전", "와 진짜 그때 표정 봤어야 돼"). 리듬 빠르게, 짧은 문장.' },
  radio: { name: '라디오 사연', desc: '차분한 낭독, 여운', rule: '라디오 사연 낭독체: 차분한 존댓말(~였습니다/~더라고요), 장면 묘사를 조금 넣고, 마지막은 따뜻하거나 씁쓸한 여운 한 줄.' }
};

// 썰: 대본 → 장면마다 그림(codex 이미지) → 확대·슬라이드 전환 영상. source = 사람이 붙여 넣은 참고 글(선택)
export function ssulPrompt({ topic = '', source = '', voice = 'theqoo', seconds = [45, 60], hints = [], avoid = [] }) {
  const v = SSUL_VOICES[voice] || SSUL_VOICES.theqoo;
  const src = String(source || '').trim().slice(0, 6000);
  return [
    '유튜브 쇼츠·릴스용 "썰" 영상 대본을 만든다. 장면마다 그림을 새로 그려 확대·슬라이드 효과로 이어 붙이는 영상이다. 결과는 이 폴더의 script.json 하나다.',
    topic ? `주제: ${topic}` : src ? '주제: 아래 참고 글에서 정한다.' : PICK_TOPIC,
    !topic && !src ? hintText(hints) : '',
    !topic && !src ? avoidText(avoid) : '',
    src ? [
      '참고 글(사람이 직접 읽고 붙여 넣은 커뮤니티 글). 그대로 옮기지 않는다: 이야기 뼈대(상황·갈등·반전)만 가져와 사건 순서·디테일·문장을 새로 쓴다. 원문 문장을 3어절 넘게 이어서 베끼지 않는다. 실명·아이디·회사명·학교명 같은 특정 정보는 지우거나 바꾼다.',
      '<참고 글>', src, '</참고 글>'
    ].join('\n') : '참고 글 없음: 실제 있었던 일처럼 꾸미지 말고, 흔히 있을 법한 상황으로 새로 지어낸 썰을 쓴다(실존 인물·회사·사건 금지).',
    `말투: ${v.name} — ${v.rule}`,
    `- 낭독 ${seconds[0]}~${seconds[1]}초, 장면 5~8개. 첫 장면은 3초 안에 "그래서 어떻게 됐는데?"가 나오는 훅(결과·반전 예고, 예: "소개팅 나갔는데 상대가 우리 팀장이었음"). "오늘은 ~ 썰을 풀어볼게요" 같은 시작 금지.`,
    '- 흐름: 훅 → 상황 → 갈등 고조 → 반전·결말 → 마지막 한 줄(댓글 유도 질문이나 뼈 때리는 한 방). 결말을 흐지부지하지 않는다.',
    '- 욕설·혐오·성적 묘사·특정 집단 비하 금지. 범죄·자해 미화 금지.',
    'script.json 형식: {"title":["윗줄(10자 이내)","아랫줄(12자 이내, *강조*)"],"badge":"썰","scenes":[{"image_prompt":"장면 그림 설명(영어)","enter":"slide","focus":[50,45],"stamp":"","lines":[{"text":"낭독할 문장, *강조*","tone":"normal","move":"punch"}]}],"description":"업로드 설명","hashtags":["#태그"]}',
    // 2026-11-22 사용자: 애니메이션·웹툰 그림체는 촌스럽다 → 실제 사진처럼(사람·물건)
    '- image_prompt: 장면마다 서로 다른 실사 사진(영어). 그림·만화·웹툰·일러스트·3D 렌더 금지 — 휴대폰이나 카메라로 실제로 찍은 듯한 사진: "candid smartphone photo, natural window light, realistic skin and fabric texture, shallow depth of field, Korean everyday setting" 같은 말을 붙인다. 이야기의 물건·장소를 크게 보여 주는 장면(예: 서랍 속 똑같은 화장품 5개 클로즈업)을 절반 이상 넣고, 사람은 얼굴을 다 보이기보다 손·뒷모습·어깨 너머·흐린 얼굴로. 같은 인물은 매번 같은 옷·머리로. 사진 안 글자·로고·브랜드 이름 금지. 실존 인물 얼굴 금지.',
    '- enter(장면 등장 전환): slide / zoomblur / drop / flip / wipe / pop 중 이야기 흐름에 맞게(반전엔 zoomblur·drop). focus는 줌인할 때 당길 지점(인물 얼굴 등).',
    '- lines: 장면당 1~3문장, 문장 속 핵심 한 곳을 *별표*. tone은 normal / emphasis / whisper / excited / angry, 절반 이상 normal. move(선택): punch(확 줌인, 반전·충격) / pan / shake(당황) / bounce / zoomout / none.',
    '- stamp(선택): 반전 장면에만 크게 찍는 짧은 말(6자 이내, 예: "실화?", "반전"). 1~2곳.',
    UPLOAD_RULE,
    '현재 작업 폴더 밖의 파일을 수정하지 않는다. 질문하지 말고 파일을 작성하고 완료한다. 마지막에 script.json 내용을 그대로 출력한다.'
  ].filter(Boolean).join('\n');
}

export function reelPrompt({ topic, narration = '', style = 'info', files = [], seconds = [45, 65], hints = [], avoid = [] }) {
  return [
    '릴스와 유튜브 쇼츠용 세로 영상의 대본을 작성한다. 결과는 이 폴더의 script.json 하나다.',
    String(topic || '').trim() ? `주제: ${topic}` : narration ? '주제: 아래 대본에서 정한다.' : [PICK_TOPIC, hintText(hints), avoidText(avoid)].filter(Boolean).join('\n'),
    style === 'story' ? '이야기를 들려주듯 자연스럽게 구성한다. 시청자가 상상할 수 있는 구체적인 상황으로 시작하고, 갈등의 원인과 결과를 차례로 풀어 한 가지 인사이트로 마무리한다. 예시 인물이나 상황은 재구성된 예시임을 분명히 하며 허구를 실제 사건처럼 주장하지 않는다.' : '핵심 정보를 구어체로 설명한다. 상황이나 질문으로 시작하고, 원인·작동 방식·구체적 사례·시청자가 적용할 수 있는 결론을 연결한다.',
    '시의성이 있는 주장이나 통계는 신뢰할 수 있는 자료로 확인하고 description에 자료명과 주소를 적는다. 확인할 수 없는 수치나 단정적인 주장은 넣지 않는다. 해석과 사실을 구분한다.',
    narration ? `사용자가 제공한 대본을 그대로 낭독한다. 문장을 빠뜨리거나 추가하거나 바꾸지 말고 장면으로만 나눈다:\n${narration}` : `주제에 맞는 ${seconds[0]}~${seconds[1]}초 분량의 구어체 대본을 직접 작성한다. 추상적인 일반론 대신 구체적 상황과 이유를 넣고 같은 말을 반복하지 않는다.`,
    'script.json 형식: {"title":["짧은 제목","짧은 부제"],"badge":"","look":"info-check", "scenes":[{"image_prompt":"장면에 맞는 이미지 설명 (영어)","point":"","stamp":"", "lines":[{"text":"낭독할 문장","tone":"normal"}]}],"description":"영상 설명", "hashtags":["#태그"]}',
    '화면 꾸미기 "look": 여러 항목을 차례로 짚는 목록형(예: 놓치기 쉬운 3가지, 순서·방법)이면 "info-check"(체크리스트가 하나씩 체크됨), 한 가지씩 깊게 짚거나 숫자가 핵심이면 "info-num"(큰 번호). 핵심 항목을 설명하는 장면에만 "point"(14자 이내 항목 이름, 예: "월세 세액공제")를 넣고 훅·마무리 장면은 빈 문자열. point 장면은 2~5개.',
    `장면은 ${files.length > 4 ? files.length : 4}개 이상, 8개 이하로 구성한다. 장면마다 서로 다른 구체적인 세로 이미지 설명을 작성한다. 이미지에 글자와 로고는 넣지 않는다. tone은 normal, emphasis, whisper, excited 중 하나다.`,
    '자연스러운 감정 변화를 위해 장면당 짧은 문장 1~3개를 각각 lines로 나눈다. 공감과 설명은 normal, 중요한 전환과 결론은 emphasis, 조심스럽거나 궁금한 대목에만 whisper, 기쁜 내용에만 excited를 쓴다. 과장하거나 모든 문장에 감정을 넣지 않는다.',
    ...(files.length ? [`사용자가 첨부한 이미지·영상이 ${files.length}개 있다. 이 순서대로 장면에 사용하므로 전체 파일이 쓰이도록 ${files.length}개 이상의 장면으로 나눈다.`] : []),
    UPLOAD_RULE.replace(/^- /, ''),
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
