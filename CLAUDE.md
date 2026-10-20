# CLAUDE.md — 공방-콘텐츠파일럿 (Gong-Bang contentpilot) 인수인계

이 문서는 이 저장소에서 작업하는 Claude Code(또는 사람)를 위한 인수인계 문서다. 사용자 안내는 `README.md`를 본다.

## 1. 무엇인가

네이버 블로그 운영을 돕는 **로컬 관리 페이지** (`http://localhost:5999`, Windows 전용).

- **글 생성하기**: 주제·참고 링크·요청사항·사진/참고 자료(PDF·HTML 등)를 주면 `codex` 또는 `claude` CLI가 백그라운드에서 글(HTML + meta.json + 이미지)을 쓴다. 대화 기록은 남기지 않는다(`--ephemeral` / `--no-session-persistence`).
- **임시저장**: 전용 크롬 프로필(headless)로 네이버 글쓰기 화면을 열어 본문·이미지를 넣고 저장만 누른다. 발행은 안 한다.
- **숏텐츠**: 네이버 검색 숏텐츠를 30분마다 모아 보여 주고, 골라서 바로 글쓰기.
- **핫 키워드**: 크리에이터 어드바이저 트렌드 → 주제별 인기유입검색어(어제 기준)를 받아 보여 주고, 골라서 바로 글쓰기.
- **숏폼 만들기**: 주제/자료 → AI 대본 → 감정 TTS + 무대(HTML) 프레임 캡처 → ffmpeg로 세로 영상.
- **글 목록 / 작업 로그 / 설정**, 화면별 사용 안내(투어), 작업 끝나면 Windows 알림.

출력 형식은 블로그 작업 폴더의 규칙을 따른다: `<블로그 폴더>\<분류>\YYYYMMDD-주제\{주제.html, meta.json, 게시안내와-검증메모.md, assets\*.webp}`.
원래 사용자 블로그(D:\BLOG\Oducki, 분류 A|B|C)에서 시작했지만 **지인에게 공유할 도구라 특정 블로그에 맞추지 않는다** — 분류는 폴더에서 찾고, 글쓰기 규칙은 그 폴더의 `AGENTS.md`를 AI가 읽는다.

## 2. 구조

| 파일 | 역할 |
|---|---|
| `server.mjs` | 진입점. 127.0.0.1:5999. `/api/*`는 직접 처리, 나머지는 Next 핸들러. 작업 큐(write·draft·discover·shorts·render·scrape), 숏텐츠/핫 키워드 스케줄러, 알림 |
| `app/page.jsx` | 화면 전체(메뉴·각 페이지 컴포넌트). JSX, TypeScript 아님. 오래 걸리는 버튼은 `<Action track="이름">` — 진행 중 목록이 컴포넌트 밖(`pending`)에 있어 메뉴를 옮겨도 스피너가 유지된다. 서버가 아는 진행 중(`busy`, `loggingIn`)은 `busy` prop으로 |
| `app/tour.jsx` | 화면별 사용 안내(스포트라이트 투어). `TOURS`, `TOUR_OF_TAB` |
| `app/dialog.jsx` | 커스텀 confirm/alert (`useDialog()`). 브라우저 기본 alert/confirm 쓰지 않는다 |
| `app/globals.css` | 라이트 테마 고정, SUIT 폰트, 토큰은 `:root` |
| `ai.mjs` | `runAI(config, engine, prompt, {cwd, log})`. 프롬프트는 stdin, codex는 `-o` 파일로 최종 답만 받는다. `lastJson()` |
| `naver.mjs` | playwright-core + 네이버 계정마다 전용 프로필(`data/` 아래 폴더, 계정의 `profile`). 세션 확인·로그인 창·화면 읽기·핫 키워드·임시저장. 모든 브라우저 작업은 `exclusive` 큐 한 줄(다른 계정 프로필이 오면 닫고 다시 연다) |
| `shortents.mjs` | 숏텐츠 수집(로그인 불필요한 JSON + 분류별 검색 HTML), 저장소 갱신, 비슷한 글 찾기(`similarPost`) |
| `video.mjs` | 숏폼 렌더러. 감정 톤(`TONES`), 문장별 음량 측정 후 맞춤, Edge TTS(무료)·ElevenLabs·Google |
| `notify.mjs` | PowerShell WinRT 토스트 알림 |
| `assets/stage.html` | 숏폼 무대: `renderAt(t)` 순수 함수를 CDP로 프레임 캡처 |
| `vendor/` | Naver-Blog-Helper-Extension의 `html.js`, `driver.js` 복사본(에디터 주입) |
| `*.check.mjs` | `npm run check`로 도는 자체 검사(assert) |
| `start.cmd` | 5999 서버 종료 → `npm run build` → 최소화로 서버 실행 → 브라우저 열기 |

계정(`config.json`): `accounts[]` = `{id, service: naver|instagram|threads, name, blogId|handle, profile·folder(네이버만)}`, `defaultNaver` = 기본 네이버 계정(핫 키워드·임시저장 기본값). 작업 폴더 = 계정의 `folder` 또는 `config.blogRoot`(기본 작업 폴더) — `server.mjs` `rootOf()`/`curRoot()`/`allRoots()`. 기본 계정을 바꾸면 대시보드·글 목록·추천·숏폼이 그 계정 폴더를 본다. 글 생성·글 목록은 계정을 골라 그 폴더로. 설정 → 계정 관리에서만 바꾼다(`/api/accounts*`, `/api/config`는 계정 키를 무시). 비밀번호는 받지 않는다. 예전 단일 계정(`data/chrome-profile`, `config.blogId`)은 서버 시작 때 `naver-1`로 자동 이전.

데이터(`data/`, git 제외): `chrome-profile/`(이전된 첫 네이버 계정), `profiles/<계정 id>/`(새로 추가한 네이버 계정 로그인), `jobs.json`, `logs/`, `state.json`, `shortents.json`, `hotkeywords.json`, `discover.json`, `server.log`.

## 3. 다른 PC에서 이어서 개발하기

1. 준비: Windows, Node.js 20+, Google Chrome, Git. AI 엔진은 하나 이상:
   - codex: `npm i -g @openai/codex` 후 `codex login`
   - claude: Claude Code 설치(`claude` 명령)
2. 받기: `git clone https://github.com/YimJunsu/Gong-Bang-contentpilot.git` → 폴더에서 `npm install`
3. 실행: `start.cmd` 더블클릭. 첫 실행 때 `config.json`이 `config.example.json`에서 자동 생성된다.
4. 화면 → 설정: **블로그 작업 폴더**(예: `D:\BLOG\Oducki`, 이 폴더는 git에 없으니 따로 옮겨야 함), 크롬 경로가 다르면 `config.json`의 `chromePath` 수정.
5. 설정 → **계정 관리** → 네이버 계정 추가 → **로그인 창 열기** → 뜬 크롬에서 직접 로그인(**로그인 상태 유지** 체크). 로그인 프로필은 PC마다 새로 만든다 — 다른 PC의 `data/`를 복사해 오지 않는다.
6. 개발 루프: 코드 수정 → `npm run check` → `start.cmd`로 재시작(항상 다시 빌드). 화면만 볼 땐 `.claude/launch.json`의 `ui-preview`(5998, `next start`)로 띄우고 `/api`는 fetch를 가짜로 바꿔 확인했다. 개발 모드(`npm run dev`)는 `http://localhost:5999`로 열 것 — `127.0.0.1:5999`로 열면 화면 스크립트가 붙지 않아 메뉴가 안 눌린다(2026-10-20 확인, 같은 와이파이 접속을 만들 때 다시 볼 것).

## 4. 지켜야 할 것 (사용자 요구·결정)

- **대답·화면 문구는 한국어.** 기술 용어 남발 말고 쉬운 말.
- **블로그 비종속**: A/B/C 같은 분류·경로를 코드에 박지 않는다.
- **보안**: 네이버 비밀번호·쿠키·세션 값을 코드가 다루거나 출력하지 않는다(로그인은 사람이 직접). 서버는 127.0.0.1만, Host 검사, GET 이외 요청은 `x-bh: 1` 헤더 필수, 이미지·폴더 열기·삭제는 블로그 폴더 안만. 삭제는 휴지통으로, confirm 후.
- **UI 취향**: 라이트 테마 고정, SUIT 폰트, 이모지는 Fluent 3D(`public/emoji`)를 필수인 곳에만(사이드바엔 없음). 버튼에 "처리 중…" 글자 금지 — 필요하면 `Action loading`(스피너, 폭 유지). 알림·확인창은 전부 `useDialog()`.
- **나중에 할 일**(지금 하지 말 것): TypeScript 전환, Tailwind 전환 — 기능이 굳은 뒤/공유 직전.
- 작업 원칙: 고치기 전에 관련 파일을 다 읽고, 버그는 재현→증거→수정→재검증. 실제로 돌려 본 것만 "됐다"고 말하고, 못 돌려 본 건 그렇다고 적는다.

## 5. 지금까지 구현·검증 상태 (2026-10-16)

| 기능 | 상태 |
|---|---|
| 글 생성하기(단건) + 참고 링크·요청사항·첨부 | 동작 확인. 숏텐츠 → 이걸로 글쓰기로 이미지 포함 글 생성 확인 |
| 숏텐츠 수집·목록·필터·비슷한 글·새로고침 스피너 | 동작 확인(약 65개/5초) |
| 숏폼(감정 TTS 자연스럽게 재조정 포함) | 렌더 확인(`data/fx-test/short.mp4`), 톤별 음량 목표 ±0.2dB |
| Windows 알림, 글 목록 삭제(휴지통) | 확인 |
| 진행 중 유지·사이드바 로그인 표시·전체 폭 | 숏텐츠 새로고침 중 메뉴 이동 후 복귀 시 스피너 유지·끝나면 목록 갱신 확인. 기본 계정 세션은 서버가 3시간마다(켤 때도) 다시 확인 |
| 글 미리보기 | `/api/postfile/<글 폴더 base64url>/<파일>` — 작업 폴더 안 글 폴더(meta.json)만, CSP로 스크립트 차단, iframe `sandbox=""`. 작업 로그(완료된 글)·글 목록에서 연다 |
| 다시 생성(글) | 의견 입력 + '지금 글 고치기'(`reviseDir`, 같은 폴더 수정·링크 다시 안 읽음) / '처음부터 새로 쓰기'. 화면만 만들고 실제 고쳐 쓰기 실행은 미검증 |
| 파일 첨부 | 여러 번 골라도 누적·끌어다 놓기·×로 빼기. 글 생성하기는 draft 상태에 있어 메뉴를 옮겨도 유지 |
| codex 생각 깊이 | 설정 → AI. `-c model_reasoning_effort=…`(ai.mjs `EFFORTS`). 짧은 프롬프트로 적용 확인. 글 한 편 기준 시간 단축 폭은 미측정(2026-10-17 xhigh 기준 12.5분 = 규칙·검색 3.5분 + 이미지 3.5분 + webp·검증 수정 5분 + 임시저장 15초) |
| 실제 이미지(외부 이미지) | 내 사진이 없으면 자동으로 `imageMode=real`(공식 사진·캡처 먼저), 있으면 `auto` — 화면 선택지는 없앰(2026-10-18 사용자 결정, 이슈형 구분도 없앰). 참고 링크를 읽을 때 이미지 후보(og:image + 400×250 이상 `<img>`, 최대 12개, `naver.scrape(..., {withImages})`)를 모아 프롬프트로 넘긴다. 유튜브는 공식 썸네일만(댓글 이미지 제외, 장면 캡처·영상 다운로드는 안 함). 규칙 `IMAGE_RULES`: 공식 배포·인용만, 통신사·언론사 사진·비공식 인물 사진 금지, 캡션 끝 출처 한 줄, 검증 메모 `이미지 출처` 표 + `meta.json` `image_sources`. 후보 수집은 롯데잇츠·유튜브로 확인, 실제 글에 쓰이는지는 미검증 |
| 공식 유튜브 장면 캡처 | 설정 → 이미지 `videoCapture`(기본 꺼짐). AI가 `POST /api/youtube/frames?url=&t=12:30,33:10&dir=<글폴더>\assets`를 curl로 부르면 `naver.youtubeFrames()`가 영상 페이지를 열어 그 시점 플레이어 화면만 PNG로 저장(영상 파일 안 받음, 광고 대기, 플레이어 UI 숨김), 채널명은 YouTube oEmbed. 꺼짐 403·작업 폴더 밖 거절·영상 길이 초과 처리까지 확인 |
| 링크 카드·유튜브 삽입 | HTML `<div class="oglink" data-url>` / `<div class="embed" data-url>` → `html.js`가 자리표시 → `driver.js` `PASTE_LINK`가 주소를 붙여넣어 네이버가 만든 서명된 oglink/oembed 컴포넌트를 받아 끼운다(카드 직후 붙여넣기는 글자로 들어갈 때가 있어 3번까지 재시도). 글쓰기 화면에서 저장 없이 적용·화면 확인 |
| 훅(후킹) | 블로그 규칙이 없는 폴더용 `HOOK_RULES`(제목·도입 첫 문장·소제목·섹션 연결), 숏폼 대본 첫 3초 훅 유형. 오덕이 폴더 규칙에도 반영(아래) |
| 블로그 폴더 없음 | 글 생성·숏폼·추천·업로드를 시작 전에 막음(이 PC는 `blogRoot`가 비어 글 생성이 실패하던 것으로 추정) |
| 계정 관리(네이버 여러 개·인스타·스레드) | 추가·수정·기본 지정·삭제(프로필 휴지통)·이전 API와 화면에서 확인. 계정별 실제 로그인·임시저장은 미검증. 인스타·스레드는 이름·아이디 저장만 |
| 네이버 로그인 | 확인. 로그인 창이 닫힐 때 세션 쿠키가 사라지던 문제 → 메모리로 넘겨 줌(`naver.mjs` `closeCtx`/`carried`). 서버 재시작 후에도 유지하려면 '로그인 상태 유지' 필요 |
| 핫 키워드 | **화면은 가짜 데이터로만 확인, 실데이터 수집 미검증.** 어드바이저 `/api/v6/trend/category`는 화면 JS가 서명 헤더를 붙여서 직접 호출 불가(401) → `naver.hotKeywords()`가 트렌드 화면을 열고 swiper(`.u_ni_search_swiper`)를 `slideTo`로 넘기며 응답을 가로챈다. 응답: `data[].{category, queryList[].{query, rank, rankChange}}`, rankChange 0=변동없음/±=오르내림/null=new |
| 대시보드 '수집하고 추천받기'(discover) | 핫 키워드 + 숏텐츠 → AI 추천. 수정 후 실사용 미검증 |
| 네이버 임시저장 | 동작 확인(2026-10-17): 글 생성("다 쓰면 임시저장까지") 4편이 기본 계정으로 에디터 주입·이미지 업로드·저장 클릭까지 성공, 사용자가 네이버에서 확인. 저장 대상은 계정의 블로그 아이디 |
| 자동화 메뉴(글·인스타·스레드 자동화) | "준비 중" 표시만 (`Soon` 컴포넌트) |

오덕이 블로그 규칙 개정(2026-10-18, 원본은 `D:\BLOG\Oducki\_config\legacy\20261018-이미지·훅-개정전\`): `공통-작성기준.md`에 `실제 이미지(외부 이미지) 쓰기`·`본문 훅`·도입 첫 문장 훅·쓰레드 첫 줄 훅, `HTML-디자인시스템.md` 외부 이미지 캡션 출처 예외, `AGENTS.md` 5단계·검수 목록. 검증기(`tools/validate-post.ps1`)는 `.sources` 영역만 막으므로 캡션 출처 한 줄은 통과(사본으로 확인).

오덕이 규칙 2차 개정(2026-10-18, 원본 `D:\BLOG\Oducki\_config\legacy\20261018-이슈형·강조-개정전\`): A 이슈형(`article_type: "이슈"`, `A/AGENTS.md`), 강조 3단계(`<strong>` / `<strong class="num">` 빨강 #ff0010 / `<mark>` 음영+15px), 인물 사진은 공식 배포·공식 영상 장면만(개인 SNS 금지)·이미지 정확성, 이슈형 썸네일(오덕이 + 공식 이미지 참고 재현). 검증기: `mark` 15px 허용, 이슈형은 `예를 들어` 검사 제외 — 사본으로 4가지 경우 확인. `vendor/html.js`가 `.num`→빨강 굵게, `mark`→fs15+음영 굵게로 옮기는 것 headless로 확인.

오덕이 규칙 3차 개정(2026-10-18, 원본 `_configlegacy61018-썸네일·분류-개정전`): 썸네일 글자는 이미지 생성으로만(코드 합성 금지 — 나쁜 썸네일 원인이 PIL 조판이었음), 좋은·나쁜 예 `model/썸네일-레퍼런스/`, 분류는 정보=A·직접 경험 후기=B(경험 자료 없으면 B 금지, 사진 있어도 정보면 A)·IT=C. 앱 프롬프트에도 분류·글자 지시(블로그 비종속 문구). `GPTs-지침`은 legacy로 이동.

## 6. 다음에 할 일

1. 핫 키워드 실데이터 확인: 로그인 후 핫 키워드 → 지금 새로고침. 주제가 30개 안팎으로 다 들어오는지. 덜 들어오면 swiper 넘기기 로직(`naver.mjs hotKeywords`) 손볼 것.
2. (해결) `yjuns0519`와 `oducki`는 같은 블로그다(`rss.blog.naver.com/yjuns0519.xml`이 `oducki`로 리디렉트, 2026-10-17 확인).
   - 발행된 글 링크: 블로그 RSS(`https://rss.blog.naver.com/<blogId>.xml`, 최근 50편·제목·링크, 로그인 불필요)에서 제목으로 맞추면 글 목록에 "블로그에서 보기"를 붙일 수 있다. 임시저장 글은 주소가 없다. 아직 구현 안 함.
3. (완료) 네이버 임시저장 실검증 — 계정별(여러 계정) 저장은 아직.
4. 글 자동화: 설계는 `docs/글-자동화-설계.md`(A 이슈형, 임시저장까지·발행은 사람). 다음은 2단계 — 핫 키워드·숏텐츠에 "이슈형으로 쓰기"(공식 자료 찾기 + imageMode=real).
5. 인스타 자동화·스레드 자동화: 메뉴(자동화 그룹)와 "준비 중" 화면만 있음. 기능 설계 전.
6. 그 뒤: TypeScript / Tailwind 전환 검토.
