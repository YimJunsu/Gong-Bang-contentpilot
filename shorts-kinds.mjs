// 숏폼 탭(종류)과 길이. 화면(app/page.jsx)과 서버(server.mjs·clip.mjs·reel.mjs)가 같이 쓴다. 설계: docs/숏폼-통합-설계.md
// job = 그 탭이 만드는 작업 종류, lengths = 짧게/보통/길게의 [최소초, 최대초]
export const SHORT_KINDS = {
  celeb: { name: '연예인 핫', job: 'clip', lengths: { short: [15, 25], normal: [20, 35], long: [35, 50] } },
  viral: { name: '해외 재밌는 영상', job: 'clip', lengths: { short: [20, 30], normal: [25, 40], long: [40, 58] } },
  topic: { name: '주제·컨셉', job: 'reel', lengths: { short: [25, 40], normal: [40, 60], long: [60, 90] } },
  material: { name: '내 사진·자료', job: 'shorts', lengths: { short: [20, 35], normal: [30, 50], long: [50, 80] } }
};
export const LENGTH_NAMES = { short: '짧게', normal: '보통', long: '길게' };

export function lengthRange(kind, length = 'normal') {
  const k = SHORT_KINDS[kind] || SHORT_KINDS.topic;
  return k.lengths[length] || k.lengths.normal;
}
export const lengthText = (kind, length) => { const [a, b] = lengthRange(kind, length); return `${a}~${b}초`; };

// 만든 숏폼이 어느 탭 것인지: script.kind가 있으면 그것, 없으면(예전 것) 모양으로 짐작
export function kindOf(script = {}) {
  if (SHORT_KINDS[script.kind]) return script.kind;
  if (script.layout === 'clip') return script.concept === 'viral' ? 'viral' : 'celeb';
  if ((script.scenes || []).some((s) => s.image_prompt)) return 'topic';
  return 'material';
}
