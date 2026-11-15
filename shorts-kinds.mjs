// 숏폼 탭(종류)과 길이. 화면(app/page.jsx)과 서버(server.mjs·clip.mjs·reel.mjs)가 같이 쓴다. 설계: docs/숏폼-통합-설계.md
// job = 그 탭이 만드는 작업 종류, lengths = 짧게/보통/길게의 [최소초, 최대초]
export const SHORT_KINDS = {
  celeb: { name: '연예인 핫', job: 'clip', lengths: { short: [15, 25], normal: [20, 35], long: [35, 50] } },
  viral: { name: '해외 재밌는 영상', job: 'clip', lengths: { short: [20, 30], normal: [25, 40], long: [40, 58] } },
  topic: { name: '주제·컨셉', job: 'reel', lengths: { short: [25, 40], normal: [40, 60], long: [60, 90] } },
  character: { name: '캐릭터', job: 'character', lengths: { short: [20, 30], normal: [30, 40], long: [40, 55] } },
  material: { name: '내 사진·자료', job: 'shorts', lengths: { short: [20, 35], normal: [30, 50], long: [50, 80] } }
};
export const LENGTH_NAMES = { short: '짧게', normal: '보통', long: '길게' };

export function lengthRange(kind, length = 'normal') {
  const k = SHORT_KINDS[kind] || SHORT_KINDS.topic;
  return k.lengths[length] || k.lengths.normal;
}
export const lengthText = (kind, length) => { const [a, b] = lengthRange(kind, length); return `${a}~${b}초`; };

// 저장 폴더: shorts\<분류>\<날짜>-<업로드 제목>
export const SHORT_FOLDERS = { celeb: '연예인', viral: '꿀잼', topic: '정보', character: '캐릭터', material: '내자료' };

// 업로드용 제목·설명·해시태그(영상 폴더의 txt 파일). AI 대본 프롬프트마다 이 규칙을 붙인다
export const UPLOAD_TXT = '업로드-제목·설명.txt';
export const UPLOAD_RULE = '- 업로드용(script.json에 같이 넣는다): "uploadTitle"은 유튜브 영상 제목 45자 이내 — 앞 단어부터 궁금하게 + 사람들이 검색할 핵심 키워드(인물·주제) 1~2개, 화면 제목을 그대로 베끼지 않고, 낚시·없는 내용 금지. "description"은 2~4줄 — 무슨 영상인지 한 줄 + 보는 포인트 + 댓글 유도 한 줄. "hashtags"는 5~8개 — #Shorts 하나 + 한국어 검색어 위주, 띄어쓰기 없이.';
export const uploadTitle = (s = {}) => String(s.uploadTitle || (s.title || []).join(' ') || s.topic || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
export const hashtagsOf = (s = {}) => [...new Set((Array.isArray(s.hashtags) ? s.hashtags : []).map((t) => String(t).replace(/\s+/g, '').replace(/^#*/, '')).filter(Boolean).map((t) => `#${t}`))];
export function uploadText(s = {}) {
  return [
    '[영상 제목]', uploadTitle(s), '',
    '[영상 설명]', String(s.description || '').trim(), '',
    '[해시태그]', hashtagsOf(s).join(' '),
    ...(s.sound ? ['', '[추천 사운드]', String(s.sound).trim()] : [])
  ].join('\n').trim() + '\n';
}

// 만든 숏폼이 어느 탭 것인지: script.kind가 있으면 그것, 없으면(예전 것) 모양으로 짐작
export function kindOf(script = {}) {
  if (SHORT_KINDS[script.kind]) return script.kind;
  if (script.layout === 'clip') return script.concept === 'viral' ? 'viral' : 'celeb';
  if ((script.scenes || []).some((s) => s.image_prompt)) return 'topic';
  return 'material';
}
