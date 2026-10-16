# 블로그 헬퍼

네이버 블로그 글을 백그라운드에서 쓰고 임시저장까지 하는 로컬 관리 페이지(`http://localhost:5999`).

## 실행

`start.cmd`를 더블클릭하면 떠 있던 서버를 끄고, 화면을 새로 빌드(`next build`)한 뒤 서버를 최소화 창으로 띄우고 관리 페이지를 엽니다. 코드를 고친 뒤 다시 시작할 때도 이것만 실행하면 됩니다.
화면(`app/`)을 고친 뒤에는 `npm run build`를 다시 하거나, 개발 중에는 `npm run dev`(핫리로드)로 띄웁니다.

1. 대시보드 → **로그인 창 열기** → 뜬 크롬 창에서 직접 로그인 (최초 1회, 세션은 `data/chrome-profile`에 남음)
2. 설정 → 블로그 작업 폴더(`AGENTS.md`가 있는 폴더)
3. 글 생성하기 → 주제·참고 링크·요청사항·사진/참고 자료 → 백그라운드 작성 → (선택) 임시저장

## 구조

| 파일 | 역할 |
|---|---|
| `server.mjs` | 5999 포트. `/api`는 직접 처리하고 나머지는 Next로 넘김. 작업 큐(`data/jobs.json`), 로그(`data/logs`) |
| `app/` | 관리 화면 (Next.js + React) |
| `ai.mjs` | `codex exec` / `claude -p` 실행. 프롬프트는 stdin으로, 대화 기록은 남기지 않음 |
| `naver.mjs` | 전용 크롬 프로필(headless): 세션 확인, 화면 수집, 에디터 주입, 임시저장 |
| `video.mjs` | 숏폼 렌더러: 대본(script.json) → 문장별 감정 TTS(Edge 무료 / ElevenLabs / Google) → 무대 프레임 캡처 → ffmpeg 합성. 결과는 `<블로그 폴더>/shorts/` |
| `shortents.mjs` | 숏텐츠 수집: 검색창 숏텐츠(로그인 없는 JSON, 20개) + 분류별 숏텐츠(검색 결과 HTML, 10분류×5개). 서버가 30분마다 받아 `data/shortents.json`에 쌓음 |
| `assets/stage.html` | 숏폼 무대: 시간 t의 화면을 그리는 HTML/CSS (전환·키프레임 줌·흔들기·글리치·스티커·단어 강조 자막·이글이글 글씨) |
| `assets/fonts/` | 영상용 OFL 폰트: 검은고딕·도현·주아(제목), Pretendard(자막) |
| `vendor/` | Naver-Blog-Helper-Extension의 `html.js`(HTML→에디터 문서모델), `driver.js`(이미지 업로드·적용) 복사본 |

글은 블로그 폴더의 `AGENTS.md` 규칙대로 AI가 직접 씁니다. 그래서 다른 블로그도 폴더만 바꾸면 그 블로그 규칙대로 씁니다.
AI 명령은 `config.json`의 `engines`에서 바꿉니다. codex는 `npm i -g @openai/codex`로 설치합니다.

서버는 `127.0.0.1`에서만 열리고, 다른 사이트에서 보내는 요청은 막습니다(AI를 권한 확인 없이 돌리기 때문).

## 블로그 폴더 구조 (다른 블로그에서 쓰기)

분류는 정해 두지 않고 블로그 폴더에서 찾습니다. `meta.json`이 든 폴더가 글 하나이고, 그 글을 담은 상위 폴더 이름이 분류입니다.

```text
<블로그 폴더>\
├─ AGENTS.md            (선택) 작성 규칙. 없으면 기본 형식으로 씁니다
├─ 맛집\20261016-주제\  → 분류 "맛집"
│   ├─ 주제.html, meta.json, assets\
└─ 20261016-주제\       → 분류 없음
```

분류 이름은 글 `meta.json`의 `category_name`(가장 많이 쓰인 값), 없으면 폴더 이름입니다.
`shorts`·`tmp`·`output`·`assets`·`docs`·`model`·`sticker`와 `_`·`.`로 시작하는 폴더는 글로 보지 않습니다.

## 나중에 할 일

- 글 뽑아내기(완전 자동화): 정해진 시간마다 숏텐츠·핫 키워드에서 SEO에 좋은 주제를 골라 자동으로 HTML 글까지 생성. 글 생성하기(한 편) 테스트 후 설계·구현.

- TypeScript 전환: 기능이 굳거나 지인에게 공유하기 직전에. 서버↔화면이 주고받는 데이터(글 목록·작업·숏폼 대본) 타입부터. Next.js는 JS/TS를 섞을 수 있어 파일 단위로 옮겨도 된다.
