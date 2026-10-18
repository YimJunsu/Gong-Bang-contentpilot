'use client';
// 사용 안내 투어: 화면 요소(data-tour="...")를 강조하고 옆에 설명 상자를 띄운다. 이전/다음, 진행 점, ESC로 닫기.
// 단계에 tab이 있으면 그 화면으로 이동한 뒤 요소를 찾는다. 요소가 없으면 가운데에 띄운다.
import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const TourContext = createContext(() => {});

// **굵게** 와 `코드` 만 지원하는 아주 작은 서식
const rich = (text) => String(text).split(/(\*\*.+?\*\*|`.+?`)/g).map((part, i) => (
  part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part
));

const settingsSteps = [
  { target: 'settings-blog', title: '블로그 작업 폴더', body: [
    '글이 저장될 폴더 경로를 입력하세요. 예: `D:\\BLOG\\내블로그`',
    '폴더 안에 **AGENTS.md**(말투·분량·구성 규칙)를 두면 AI가 그대로 따릅니다. 없으면 기본 형식으로 씁니다.',
    '폴더 안의 하위 폴더가 그대로 **글 분류**가 됩니다. 예: `맛집\\`, `여행\\`'
  ] },
  { target: 'settings-collect', title: '주제를 가져올 화면', body: [
    '**핫 키워드**는 네이버에 로그인돼 있으면 크리에이터 어드바이저에서 알아서 받아 옵니다. 주소를 넣을 필요가 없습니다.',
    '**숏텐츠 자동 조회 간격**: 숏텐츠는 로그인 없이 받아 옵니다. 기본 30분마다, 0이면 끕니다.'
  ] },
  { target: 'settings-ai', title: 'AI 엔진', body: [
    '**codex**: 글과 이미지를 함께 만듭니다. 처음 한 번 터미널에서 `npm i -g @openai/codex` 설치 후 `codex login`.',
    '**claude**: Claude Code(`claude` 명령)가 설치돼 있으면 바로 씁니다.',
    '작업마다 화면에서 바꿀 수 있습니다. AI는 백그라운드에서 돌고, 대화 기록을 남기지 않습니다.'
  ] }
];

const accountsStep = { target: 'settings-accounts', title: '계정 관리', body: [
  '**네이버 블로그**는 여러 계정을 둘 수 있습니다. 계정마다 **로그인 창 열기**로 뜬 크롬에서 직접 로그인하세요(**로그인 상태 유지** 체크). 비밀번호는 이 도구가 받지 않습니다.',
  '**기본** 계정으로 핫 키워드를 받고 임시저장합니다. 계정이 둘 이상이면 글 생성하기·글 목록에서 저장할 계정을 고를 수 있습니다.',
  '블로그 아이디는 세션 확인 때 채워집니다. 로그인한 블로그와 다르면 경고가 뜹니다.',
  '**인스타그램·스레드**는 지금은 이름과 아이디만 적어 둡니다. 자동화 기능이 생기면 연결합니다.'
] };

export const TOURS = {
  setup: [
    { title: '공방-콘텐츠파일럿 시작하기', body: [
      '이 PC에서 돌아가는 콘텐츠 작업 도우미입니다. 지금은 네이버 블로그를 돕고, 인스타·스레드 자동화를 준비 중입니다.',
      '**글 자동 작성 → 네이버 임시저장**, **핫 키워드·숏텐츠로 주제 찾기**, **자료로 숏폼 영상 만들기**를 한 화면에서 합니다.',
      '처음 한 번만 순서대로 설정하면 됩니다. 언제든 ESC로 닫고, 대시보드의 **사용 안내**에서 다시 볼 수 있습니다.'
    ] },
    ...settingsSteps.map((s, i) => ({ ...s, tab: 'settings', title: `${i + 1}. ${s.title}` })),
    { tab: 'settings', target: 'settings-save', title: '설정 저장', body: ['입력했으면 **설정 저장**을 누르세요. 이 PC의 `config.json`에만 저장됩니다.'] },
    { tab: 'settings', target: 'settings-accounts', title: '4. 네이버 계정 로그인 (처음 한 번)', body: [
      '**계정 관리**에서 네이버 계정을 추가하고(이미 있으면 그대로) **로그인 창 열기** → 뜬 크롬 창에서 직접 로그인하세요. **로그인 상태 유지**를 켜야 서버를 다시 켜도 풀리지 않습니다. 비밀번호는 이 도구가 다루지 않습니다.',
      '로그인은 계정마다 전용 크롬 프로필에 남아서, 이후엔 창 없이 백그라운드로 임시저장합니다.',
      '블로그를 여러 개 운영하면 계정을 더 추가하고, 주로 쓸 계정을 **기본**으로 두세요.'
    ] },
    { target: 'nav', title: '메뉴 둘러보기', body: [
      '**찾기**: 핫 키워드·숏텐츠에서 쓸 주제를 고릅니다. 숏텐츠는 자동으로 계속 쌓입니다.',
      '**만들기**: 글 생성하기(한 편 작성 + 임시저장), 숏폼 만들기(세로 영상).',
      '**자동화**: 글 자동화·인스타 자동화·스레드 자동화(모두 준비 중).',
      '**관리**: 글 목록, 작업 로그, 설정.'
    ] },
    { title: '준비 끝', body: [
      '각 화면 제목 옆 **사용 안내**를 누르면 그 화면의 기능을 따로 안내합니다.',
      '코드를 업데이트했거나 화면이 이상하면 `start.cmd`를 다시 실행하세요. 서버를 껐다 켜고 새로 빌드합니다.'
    ] }
  ],
  auto: [
    { title: '글 자동화 (준비 중)', body: [
      '정해진 시간마다 숏텐츠·핫 키워드에서 SEO에 좋은 주제를 골라 글까지 자동으로 만드는 기능입니다. 지금은 준비 중입니다.',
      '그동안은 **글 생성하기**나 숏텐츠의 **이걸로 글쓰기**로 한 편씩 만들 수 있습니다.'
    ] }
  ],
  insta: [
    { title: '인스타 자동화 (준비 중)', body: [
      '만든 글·숏폼을 인스타그램 게시물·릴스로 바꿔 올리는 기능입니다. 지금은 준비 중입니다.'
    ] }
  ],
  threads: [
    { title: '스레드 자동화 (준비 중)', body: [
      '만든 글을 스레드(Threads)에 맞는 짧은 글로 바꿔 올리는 기능입니다. 지금은 준비 중입니다.'
    ] }
  ],
  home: [
    { target: 'home-strip', title: '오늘 현황', body: [
      '네이버 로그인 상태, 오늘 만든 글과 그중 임시저장한 수, 지금 돌고 있는 작업 수를 보여 줍니다.',
      '로그인이 풀렸으면 **로그인 창 열기**로 다시 로그인하세요.'
    ] },
    { target: 'home-picks', title: '추천 주제', body: [
      '**수집하고 추천받기**: 핫 키워드와 지금 숏텐츠 목록을 읽고, AI가 이미 쓴 글과 겹치지 않는 주제 5~10개를 골라 줍니다.',
      '추천마다 분류, 메인 키워드, 왜 지금 쓰면 좋은지, 어떤 각도로 쓸지가 나옵니다.',
      '**이 주제로 쓰기**를 누르면 글 생성하기에 주제와 분류가 채워집니다.'
    ] }
  ],
  shortents: [
    { target: 'shortents-filter', title: '숏텐츠 모아 보기', body: [
      '네이버 검색창의 숏텐츠(20개)와 분류별 숏텐츠(엔터·부동산·증권·여행맛집·리빙푸드·패션뷰티·카테크·스포츠·영화·드라마, 각 5개)를 자동으로 받아 둡니다.',
      '**지금 목록**은 방금 받은 것, **최근 이틀**은 그사이 보였던 것까지 보여 줍니다.',
      '**새로 뜬 것만**: 이번에 처음 나온 주제만. **비슷한 글 있는 건 숨기기**: 이미 쓴 글과 제목이 겹치는 주제를 뺍니다.'
    ] },
    { target: 'shortents-list', title: '골라서 바로 쓰기', body: [
      '**이걸로 글쓰기**: 숏텐츠 요약 화면을 참고 자료로 넘겨 백그라운드에서 바로 씁니다. 진행은 작업 로그에서 봅니다.',
      '**글 생성하기로**: 요청사항·사진·참고 자료를 더 넣고 싶을 때. 주제와 참고 자료가 채워진 채로 넘어갑니다.',
      '"비슷한 글이 있어요"가 보이면 이미 쓴 글과 겹칠 수 있으니 각도를 바꾸거나 건너뛰세요.'
    ] }
  ],
  topics: [
    { target: 'hot-filter', title: '핫 키워드 모아 보기', body: [
      '크리에이터 어드바이저 **트렌드 → 주제별 인기유입검색어**입니다. 어제 하루 블로그 글로 많이 들어온 검색어를 주제별로 보여 줍니다.',
      '로그인돼 있으면 6시간마다 알아서 받고, **지금 새로고침**으로 바로 받을 수도 있습니다.',
      '**▲숫자**는 순위가 오른 만큼, **NEW**는 새로 등장한 검색어입니다. **오르는 것만**으로 급상승 검색어만 볼 수 있습니다.'
    ] },
    { target: 'hot-list', title: '골라서 바로 쓰기', body: [
      '**이걸로 글쓰기**: 검색어를 주제로 백그라운드에서 바로 씁니다. **글 생성하기로**: 요청사항·자료를 더 넣고 싶을 때.',
      '"비슷한 글이 있어요"가 보이면 이미 쓴 글과 겹칠 수 있으니 각도를 바꾸거나 건너뛰세요.'
    ] }
  ],
  write: [
    { target: 'write-topic', title: '주제', body: ['쓸 주제를 한 줄로 적습니다. 예: `용산 아이파크몰 치이카와마켓 웨이팅`', '추천 주제나 숏텐츠에서 넘어오면 자동으로 채워집니다.'] },
    { target: 'write-refs', title: '참고 링크 · 요청사항 · 첨부', body: [
      '**참고 링크**: 공식 페이지·공지 주소를 한 줄에 하나씩. 서버가 페이지 내용을 읽어 함께 넘기고, 요청하면 그 페이지 이미지도 내려받아 씁니다.',
      '**요청사항**: ChatGPT에 쓰던 그대로 적으면 됩니다. 강조·인용, 쓸 이미지, 썸네일 장면, 말투 등.',
      '**내 사진·영상**: 직접 찍은 사진. 본문에 실제 사진으로 들어갑니다.',
      '**참고 자료**: PDF·HTML·캡처. 사실·숫자 확인용이고, 그 안의 이미지는 블로그 스타일로 새로 만듭니다.'
    ] },
    { target: 'write-options', title: '분류 · AI 엔진', body: [
      '**분류**: 블로그 폴더에서 찾은 분류 중 고릅니다. "규칙에 따라 자동"이면 AGENTS.md 기준으로 AI가 정합니다.',
      '**AI 엔진**: codex는 이미지까지 만들고, claude는 글 위주입니다.'
    ] },
    { target: 'write-start', title: '글 생성 시작', body: [
      '누르면 **작업 로그**로 이동해 진행 상황을 보여 줍니다. 몇 분 걸릴 수 있고, 화면을 닫아도 계속 돕니다.',
      '결과는 `블로그 폴더\\분류\\날짜-주제\\`에 html·meta.json·이미지로 저장됩니다.',
      '**다 쓰면 임시저장까지**: 네이버 글쓰기 화면을 백그라운드로 열어 본문·이미지를 넣고 **저장**만 누릅니다. 발행은 하지 않습니다.'
    ] }
  ],
  shorts: [
    { target: 'shorts-topic', title: '주제 · 메모 · 자료', body: [
      '주제나 자료 중 하나만 있어도 됩니다. 주제를 비우면 자료를 보고 정합니다.',
      '사진·영상은 장면 배경으로, PDF는 핵심 페이지를 이미지로 뽑아 씁니다.',
      '메모에 말투(예: "친구한테 말하듯", "열받는 말투")를 적으면 대본에 반영합니다.'
    ] },
    { target: 'shorts-fonts', title: '제목 글꼴', body: ['영상 내내 위에 고정되는 제목 2줄의 글꼴입니다. 카드의 예시가 실제 영상 모양과 같습니다.'] },
    { target: 'shorts-voice', title: '목소리 설정', body: [
      '**Edge**: 무료, 키 없음. 속삭임·화남 같은 감정은 높낮이·속도·음량으로 흉내 냅니다.',
      '**ElevenLabs**: API 키가 필요합니다. 감정을 실제로 연기합니다(기본 목소리 Adam). 무료 요금제는 상업적 이용이 안 되고 출처 표기가 필요합니다.',
      '바꾼 뒤 **목소리 저장**을 누르세요.'
    ] },
    { target: 'shorts-list', title: '만든 숏폼 · 대본 고치기', body: [
      '줄을 누르면 미리보기와 대본 고치기 창이 뜹니다. 결과 파일은 `블로그 폴더\\shorts\\날짜-주제\\short.mp4`.',
      '대본의 문장(lines)마다 **tone**: normal(보통) · emphasis(강조) · angry(화남) · whisper(속삭임) · excited(신남).',
      '`*별표*`로 감싼 단어는 노랗게, 이글이글한 글씨로 강조됩니다. **stamp**는 장면에 찍히는 스티커 문구입니다.',
      '고르고 싶으면 장면 **enter**(slide·zoomblur·drop·glitch·flip·wipe·spin·pop), **focus**(줌 지점 [가로%, 세로%]), 문장 **move**(punch·zoomout·pan·shake·bounce)도 적을 수 있습니다.',
      '다시 렌더링하면 바뀐 문장만 음성을 새로 만들어서 빠릅니다.'
    ] }
  ],
  posts: [
    { target: 'posts-toolbar', title: '거르기 · 찾기', body: [
      '분류 탭, 제목·키워드 검색, 임시저장 상태, 정렬(최신·오래된·제목)로 거릅니다.',
      '오늘 올릴 글을 고를 땐 **아직 안 한 글**만 보면 편합니다.'
    ] },
    { target: 'posts-table', title: '글마다 할 수 있는 것', body: [
      '썸네일, 메인 키워드, 이미지·태그 수를 보여 주고, 날짜순일 땐 날짜별로 묶습니다.',
      '**폴더**: 탐색기로 글 폴더를 엽니다.',
      '**임시저장**: 네이버 글쓰기 화면에 본문·이미지를 넣고 저장합니다. 네이버 로그인이 필요합니다.'
    ] }
  ],
  jobs: [
    { target: 'jobs-table', title: '작업 로그', body: [
      '줄을 누르면 바로 아래에 로그가 열리고, 다시 누르면 닫힙니다. 진행 중이면 3초마다 갱신됩니다.',
      '**재시도 / 다시 생성**: 같은 입력으로 처음부터 다시 합니다.',
      '**영상만 다시**(숏폼): 대본은 두고, 저장된 음성으로 영상만 다시 만듭니다.',
      '**삭제**: 기록과 로그만 지웁니다. 만든 글·영상 파일은 그대로입니다.'
    ] },
    { target: 'head-tools', title: '한꺼번에 정리', body: ['**끝난 기록 모두 지우기**: 완료·실패한 기록을 지웁니다. 진행 중인 작업은 남습니다.'] }
  ],
  settings: [
    accountsStep,
    ...settingsSteps,
    { target: 'settings-save', title: '저장', body: ['숏폼 목소리는 **숏폼 만들기** 화면의 "목소리 설정"에서 정합니다.'] }
  ]
};
// 화면 → 그 화면 안내
export const TOUR_OF_TAB = { auto: 'auto', insta: 'insta', threads: 'threads', home: 'home', reward: 'topics', shortents: 'shortents', write: 'write', shorts: 'shorts', posts: 'posts', jobs: 'jobs', settings: 'settings' };

const GAP = 14, W = 400;
export function Tour({ steps, onClose, go }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [boxH, setBoxH] = useState(0);
  const box = useRef(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const find = useCallback(() => (step.target ? document.querySelector(`[data-tour="${step.target}"]`) : null), [step]);
  const measure = useCallback(() => { const el = find(); setRect(el ? el.getBoundingClientRect() : null); }, [find]);

  // 단계가 바뀌면: 필요한 화면으로 이동 → 요소가 그려질 때까지 기다림 → 화면 가운데로 스크롤 → 위치 측정
  useEffect(() => {
    if (step.tab) go(step.tab);
    setRect(null);
    let tries = 0;
    let timer;
    const look = () => {
      const el = find();
      // 바로 한 번 재고(가운데로 튀었다 돌아오는 깜빡임 방지), 스크롤이 끝난 뒤 다시 잰다
      if (el) { measure(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); timer = setTimeout(measure, 380); }
      else if (step.target && tries++ < 40) timer = setTimeout(look, 50);
    };
    look();
    return () => clearTimeout(timer);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [measure]);

  const next = useCallback(() => (last ? onClose(true) : setI((n) => n + 1)), [last, onClose]);
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), []);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose(false);
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [next, prev, onClose]);
  useEffect(() => { box.current?.querySelector('.tour-next')?.focus(); }, [i]);
  useLayoutEffect(() => { if (box.current) setBoxH(box.current.offsetHeight); });

  // 설명 상자 위치: 요소 아래 → 공간이 없으면 위 → 그래도 없으면 화면 가운데
  let style = { width: W };
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const width = Math.min(W, vw - 32);
    let top = rect.bottom + GAP;
    if (top + boxH > vh - 16) top = rect.top - boxH - GAP;
    if (top < 16) top = Math.max(16, vh - boxH - 16);
    style = { width, top, left: Math.min(Math.max(16, rect.left), vw - width - 16) };
  }

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={step.title}>
      {rect
        ? <div className="tour-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
        : <div className="tour-dim" />}
      <div ref={box} className={`tour-box${rect ? '' : ' center'}`} style={style}>
        <div className="tour-head">
          <b>{step.title}</b>
          <button className="tour-x" onClick={() => onClose(false)} aria-label="안내 닫기">×</button>
        </div>
        {step.body.length > 1 ? <ul>{step.body.map((line, k) => <li key={k}>{rich(line)}</li>)}</ul> : <p>{rich(step.body[0])}</p>}
        <div className="tour-foot">
          <div className="tour-dots" aria-label={`${steps.length}단계 중 ${i + 1}단계`}>
            {steps.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}
          </div>
          <span className="muted tour-esc">ESC로 닫기</span>
          {i > 0 && <button className="btn" onClick={prev}>‹ 이전</button>}
          <button className="btn primary tour-next" onClick={next}>{last ? '완료' : '다음 ›'}</button>
        </div>
      </div>
    </div>
  );
}
