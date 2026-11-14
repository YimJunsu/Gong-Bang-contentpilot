// 숏폼 제목 스타일: 글꼴 + 두 줄 색 + 외곽선 + 둘째 줄 띠/빛. 숏폼 렌더러(video.mjs·stage.html)와 화면 미리보기(app/page.jsx)가 같이 쓴다.
// font는 assets/fonts의 글꼴 id(video.mjs FONT_CHOICES). line2Box가 있으면 둘째 줄을 그 색 띠 위에 올린다. glow는 둘째 줄 빛 번짐 색.
export const TITLE_STYLES = {
  variety: { name: '예능 자막', desc: '흰·노랑 + 검은 외곽선, 가장 무난', font: 'blackhan', line1: '#ffffff', line2: '#ffe600', stroke: '#000000' },
  breaking: { name: '속보 뉴스', desc: '둘째 줄 빨간 띠, 소식·마감 알림', font: 'blackhan', line1: '#ffffff', line2: '#ffffff', stroke: '#000000', line2Box: '#e11d2e' },
  money: { name: '돈·이득', desc: '초록 강조, 가격·할인·지원금', font: 'blackhan', line1: '#ffffff', line2: '#39ff88', stroke: '#00331a' },
  info: { name: '정보 깔끔', desc: '하늘색 + 남색 외곽선, 방법·정리', font: 'dohyeon', line1: '#ffffff', line2: '#5ad1ff', stroke: '#0b1a3a' },
  neon: { name: '네온 시크', desc: '청록 빛 번짐, IT·밤·트렌드', font: 'dohyeon', line1: '#ffffff', line2: '#00f0ff', stroke: '#10003a', glow: '#00f0ff' },
  cute: { name: '귀여움', desc: '분홍 + 보라 외곽선, 굿즈·간식·캐릭터', font: 'jua', line1: '#ffffff', line2: '#ff9ccf', stroke: '#4a1446' },
  warm: { name: '감성 따뜻', desc: '크림·주황, 여행·카페·일상', font: 'jua', line1: '#fff7e6', line2: '#ffb347', stroke: '#4a2a10' },
  dark: { name: '노랑 띠', desc: '둘째 줄 노란 띠 + 검은 글자, 꿀팁·체크', font: 'dohyeon', line1: '#ffffff', line2: '#111111', stroke: '#000000', line2Box: '#ffe600' }
};
export const DEFAULT_TITLE_STYLE = 'variety';

// 예전 대본(font만 있음)은 그 글꼴의 기본 스타일로 맞춘다
const BY_FONT = { blackhan: 'variety', dohyeon: 'info', jua: 'cute' };
export function titleStyleOf(script = {}) {
  if (TITLE_STYLES[script.titleStyle]) return { id: script.titleStyle, ...TITLE_STYLES[script.titleStyle] };
  const id = BY_FONT[script.font] || DEFAULT_TITLE_STYLE;
  return { id, ...TITLE_STYLES[id], font: script.font || TITLE_STYLES[id].font };
}
