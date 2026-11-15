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
  // titleFont(사용자가 고른 글꼴)가 있으면 스타일의 기본 글꼴 대신 쓴다
  if (TITLE_STYLES[script.titleStyle]) return { id: script.titleStyle, ...TITLE_STYLES[script.titleStyle], ...(script.titleFont ? { font: script.titleFont } : {}) };
  const id = BY_FONT[script.font] || DEFAULT_TITLE_STYLE;
  return { id, ...TITLE_STYLES[id], font: script.titleFont || script.font || TITLE_STYLES[id].font };
}

// ---- 글꼴 목록(화면 미리보기용 이름). 파일은 video.mjs FONT_CHOICES ----
export const TITLE_FONTS = {
  gmarket: { name: 'G마켓 산스', desc: '굵고 단단한 고딕' },
  blackhan: { name: '검은고딕', desc: '가장 굵은 예능 자막' },
  ssurround: { name: '카페24 써라운드', desc: '둥글고 통통한 예능' },
  freesentation: { name: '프리젠테이션', desc: '깔끔한 정보형' },
  maruburi: { name: '마루 부리', desc: '부드러운 명조, 감성' },
  dohyeon: { name: '도현', desc: '단정한 고딕' },
  jua: { name: '주아', desc: '둥글고 귀여운' }
};

// ---- 클립형(①②) 위 검은 띠의 두 줄 색 조합 (assets/clip.html) ----
// t1·t2 = 글자색, t1Box·t2Box = 그 줄 뒤 박스 색(없으면 박스 없음), em = *강조* 글자색
export const CLIP_STYLES = {
  pink: { name: '분홍 박스', desc: '연예인 핫 기본 — 둘째 줄 분홍 박스', t1: '#ffffff', t2: '#ffffff', t2Box: '#e5007d', em: '#ffe600' },
  capture: { name: '흰 박스 + 형광', desc: '해외 영상 기본 — 첫 줄 흰 박스, 둘째 줄 형광 초록', t1: '#000000', t1Box: '#ffffff', t2: '#3dff2e', em: '#ffe600' },
  yellow: { name: '노랑 박스', desc: '둘째 줄 노란 박스 + 검은 글자', t1: '#ffffff', t2: '#000000', t2Box: '#ffe600', em: '#e5007d' },
  news: { name: '빨강 속보', desc: '둘째 줄 빨간 박스', t1: '#ffffff', t2: '#ffffff', t2Box: '#e11d2e', em: '#ffe600' },
  plain: { name: '흰·노랑 글자', desc: '박스 없이 흰 줄 + 노란 줄', t1: '#ffffff', t2: '#ffe600', em: '#5ad1ff' }
};

// 탭별 기본값(사용자가 바꾸면 그 값). docs/숏폼-통합-설계.md
export const KIND_DEFAULTS = {
  celeb: { font: 'gmarket', clipStyle: 'pink' },
  viral: { font: 'blackhan', clipStyle: 'capture' },
  topic: { font: 'freesentation', titleStyle: 'auto' },
  material: { font: 'ssurround', titleStyle: 'auto' }
};
export const clipStyleOf = (script = {}) => CLIP_STYLES[script.clipStyle] || CLIP_STYLES[(KIND_DEFAULTS[script.kind] || {}).clipStyle] || CLIP_STYLES.pink;
