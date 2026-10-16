# CLAUDE.md — 블로그 헬퍼 (Gong-Bang contentpilot) 인수인계

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
| `app/page.jsx` | 화면 전체(메뉴·각 페이지 컴포넌트). JSX, TypeScript 아님 |
| `app/tour.jsx` | 화면별 사용 안내(스포트라이트 투어). `TOURS`, `TOUR_OF_TAB` |
| `app/dialog.jsx` | 커스텀 confirm/alert (`useDialog()`). 브라우저 기본 alert/confirm 쓰지 않는다 |
| `app/globals.css` | 라이트 테마 고정, SUIT 폰트, 토큰은 `:root` |
| `ai.mjs` | `runAI(config, engine, prompt, {cwd, log})`. 프롬프트는 stdin, codex는 `-o` 파일로 최종 답만 받는다. `lastJson()` |
| `naver.mjs` | playwright-core + 전용 프로필 `data/chrome-profile`. 세션 확인·로그인 창·화면 읽기·핫 키워드·임시저장. 모든 브라우저 작업은 `exclusive` 큐 한 줄 |
| `shortents.mjs` | 숏텐츠 수집(로그인 불필요한 JSON + 분류별 검색 HTML), 저장소 갱신, 비슷한 글 찾기(`similarPost`) |
| `video.mjs` | 숏폼 렌더러. 감정 톤(`TONES`), 문장별 음량 측정 후 맞춤, Edge TTS(무료)·ElevenLabs·Google |
| `notify.mjs` | PowerShell WinRT 토스트 알림 |
| `assets/stage.html` | 숏폼 무대: `renderAt(t)` 순수 함수를 CDP로 프레임 캡처 |
| `vendor/` | Naver-Blog-Helper-Extension의 `html.js`, `driver.js` 복사본(에디터 주입) |
| `*.check.mjs` | `npm run check`로 도는 자체 검사(assert) |
| `start.cmd` | 5999 서버 종료 → `npm run build` → 최소화로 서버 실행 → 브라우저 열기 |

데이터(`data/`, git 제외): `chrome-profile/`(네이버 로그인), `jobs.json`, `logs/`, `state.json`, `shortents.json`, `hotkeywords.json`, `discover.json`, `server.log`.

## 3. 다른 PC에서 이어서 개발하기

1. 준비: Windows, Node.js 20+, Google Chrome, Git. AI 엔진은 하나 이상:
   - codex: `npm i -g @openai/codex` 후 `codex login`
   - claude: Claude Code 설치(`claude` 명령)
2. 받기: `git clone https://github.com/YimJunsu/Gong-Bang-contentpilot.git` → 폴더에서 `npm install`
3. 실행: `start.cmd` 더블클릭. 첫 실행 때 `config.json`이 `config.example.json`에서 자동 생성된다.
4. 화면 → 설정: **블로그 작업 폴더**(예: `D:\BLOG\Oducki`, 이 폴더는 git에 없으니 따로 옮겨야 함), 크롬 경로가 다르면 `config.json`의 `chromePath` 수정.
5. 대시보드 → **로그인 창 열기** → 뜬 크롬에서 직접 로그인(**로그인 상태 유지** 체크). 로그인 프로필은 PC마다 새로 만든다 — 다른 PC의 `data/`를 복사해 오지 않는다.
6. 개발 루프: 코드 수정 → `npm run check` → `start.cmd`로 재시작(항상 다시 빌드). 화면만 볼 땐 `.claude/launch.json`의 `ui-preview`(5998, `next start`)로 띄우고 `/api`는 fetch를 가짜로 바꿔 확인했다.

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
| 네이버 로그인 | 확인. 로그인 창이 닫힐 때 세션 쿠키가 사라지던 문제 → 메모리로 넘겨 줌(`naver.mjs` `closeCtx`/`carried`). 서버 재시작 후에도 유지하려면 '로그인 상태 유지' 필요 |
| 핫 키워드 | **화면은 가짜 데이터로만 확인, 실데이터 수집 미검증.** 어드바이저 `/api/v6/trend/category`는 화면 JS가 서명 헤더를 붙여서 직접 호출 불가(401) → `naver.hotKeywords()`가 트렌드 화면을 열고 swiper(`.u_ni_search_swiper`)를 `slideTo`로 넘기며 응답을 가로챈다. 응답: `data[].{category, queryList[].{query, rank, rankChange}}`, rankChange 0=변동없음/±=오르내림/null=new |
| 대시보드 '수집하고 추천받기'(discover) | 핫 키워드 + 숏텐츠 → AI 추천. 수정 후 실사용 미검증 |
| 네이버 임시저장 | **미검증**(셀렉터 확인 전) |
| 글 자동화 메뉴 | "준비 중" 표시만 |

## 6. 다음에 할 일

1. 핫 키워드 실데이터 확인: 로그인 후 핫 키워드 → 지금 새로고침. 주제가 30개 안팎으로 다 들어오는지. 덜 들어오면 swiper 넘기기 로직(`naver.mjs hotKeywords`) 손볼 것.
2. **blogId 확인**: 로그인 후 자동으로 `yjunsu0519`가 채워졌지만 어드바이저 채널은 `oducki`. 임시저장은 설정의 블로그 아이디로 가므로, 대상 블로그를 사용자에게 확인하고 설정에서 고친다.
3. 네이버 임시저장 실검증.
4. 글 자동화(글 뽑아내기, 완전 자동): 정해진 시간마다 핫 키워드·숏텐츠에서 SEO 좋은 주제 선정 → 글 생성(→ 임시저장). 사용자가 단건 생성을 충분히 테스트한 뒤 설계.
5. 그 뒤: TypeScript / Tailwind 전환 검토.
