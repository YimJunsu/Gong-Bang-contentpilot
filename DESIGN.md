---
name: 공방-콘텐츠파일럿
description: 네이버 블로그 글을 백그라운드에서 쓰고 임시저장까지 하는 로컬 관리 페이지
colors:
  naver-green: "#00c73c"
  naver-green-pressed: "#00b335"
  green-ink: "#00852f"
  green-soft: "#e9f9ee"
  signal-blue: "#2f6feb"
  alert-red: "#d93f44"
  alert-red-pressed: "#c4363b"
  alert-red-soft: "#fdeeee"
  caution-amber: "#b45309"
  paper: "#ffffff"
  ground: "#f4f6f3"
  ink: "#17201b"
  muted: "#5e6b63"
  line: "#e1e7e2"
  line-strong: "#c8d2ca"
typography:
  display:
    fontFamily: "SUIT, system-ui, Malgun Gothic, sans-serif"
    fontSize: "34px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "SUIT, system-ui, Malgun Gothic, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "SUIT, system-ui, Malgun Gothic, sans-serif"
    fontSize: "17px"
    fontWeight: 800
    letterSpacing: "-0.02em"
  body:
    fontFamily: "SUIT, system-ui, Malgun Gothic, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.6
  label:
    fontFamily: "SUIT, system-ui, Malgun Gothic, sans-serif"
    fontSize: "12.5px"
    fontWeight: 700
  mono:
    fontFamily: "Consolas, D2Coding, monospace"
    fontSize: "12.5px"
    lineHeight: 1.55
rounded:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  dialog: "18px"
  full: "99px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "18px"
  panel: "22px 24px"
  page: "36px 44px 64px"
  page-narrow: "22px 16px 48px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "38px"
  button-primary:
    backgroundColor: "{colors.naver-green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.naver-green-pressed}"
  button-big:
    rounded: "{rounded.lg}"
    padding: "0 22px"
    height: "48px"
  button-danger-fill:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  nav-item:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  nav-item-active:
    backgroundColor: "{colors.green-soft}"
    textColor: "{colors.green-ink}"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    padding: "{spacing.panel}"
  chip:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.full}"
    padding: "3px 4px 3px 10px"
  category-badge:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.sm}"
    height: "28px"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
---

# Design System: 공방-콘텐츠파일럿

## Overview

**Creative North Star: "조용한 작업대 (The Quiet Workbench)"**

공방의 작업대처럼, 도구는 조용히 제자리에 있고 주인공은 그 위에서 만들어지는 글이다. 화면 자체는 흰 종이와 옅은 녹회색 바닥으로 거의 소리를 내지 않는다. 색의 대부분은 Fluent 3D 이모지가 맡고, 화면이 직접 쓰는 강조색은 네이버 그린 하나뿐이다. 그래서 초록이 보이면 "여기가 지금 선택된 곳" 또는 "누를 버튼"이라는 뜻이 된다.

밀도는 중간이다. 넓은 PC 화면에서는 왼쪽 메뉴(248px)와 오른쪽 끝까지 쓰는 본문으로 많은 정보를 한 번에 보여 주고, 860px 아래에서는 메뉴가 한 줄 가로 스크롤로 바뀐다. 위계는 크기보다 굵기 대비(제목 800 / 본문 500)로 만든다. 각 화면에서 큰 목소리는 페이지 머리(큰 이모지 + 34px 제목) 한 곳뿐이다.

부품은 둥글고 다정하다. 모서리는 10~14px로 둥글고, 글자는 굵으며, 눌렀을 때 살짝 작아진다(0.97). 움직임은 0.12~0.28초 안에서 결과를 보여 줄 때만 쓴다. 다크 모드는 없다. 운영체제 설정과 관계없이 항상 밝은 화면이다.

**Key Characteristics:**
- 흰 면(`paper`) + 옅은 녹회색 바닥(`ground`) + 1px 가는 선(`line`)으로 면을 나눈다
- 강조색은 네이버 그린 하나. 파랑은 "진행 중", 빨강은 "실패·삭제"라는 상태 신호로만 쓴다
- SUIT 한 서체로 굵기만 바꿔 위계를 만든다
- 색과 표정은 3D 이모지가, 화면은 조용히
- 짧고 결과를 보여 주는 움직임만, `prefers-reduced-motion`이면 모두 끈다

## Colors

흰 종이 위에 네이버 그린 한 점. 나머지는 상태를 알리는 신호색이다.

### Primary
- **네이버 그린** (`naver-green`): 주요 버튼 배경, 체크박스, 포커스 링, 로그인됨 점, 투어 강조 링, 선택된 글꼴 카드 테두리. 한 화면에서 "다음에 누를 것"이 이 색이다.
- **눌린 그린** (`naver-green-pressed`): 주요 버튼에 마우스를 올렸을 때.
- **짙은 그린 글자** (`green-ink`): 흰 바탕이나 옅은 초록 위의 초록 글자(선택된 메뉴, 완료 상태, '기본' 표시). 밝은 그린은 글자로 쓰기에 대비가 모자라서 따로 둔다.
- **옅은 그린** (`green-soft`): 선택된 메뉴·표 줄 배경, 입력칸 포커스 번짐, 파일을 끌어다 놓는 중인 영역.

### Secondary
- **신호 파랑** (`signal-blue`): "진행 중"만 뜻한다. 작업 중 상태 글자, 메뉴의 진행 중 개수 배지, 확인 중 깜빡이는 점, 핫 키워드 순위 하락.

### Tertiary
- **경고 빨강** (`alert-red`): 실패 상태, 로그아웃 점, 삭제 버튼, NEW 표시, 핫 키워드 순위 상승.
- **눌린 빨강** (`alert-red-pressed`): 빨간 채움 버튼에 마우스를 올렸을 때.
- **옅은 빨강** (`alert-red-soft`): 오류 상자 배경, 삭제 버튼에 마우스를 올렸을 때 배경.
- **주의 호박색** (`caution-amber`): 한 줄 주의 문구(`warn-line`)에만.

### Neutral
- **종이** (`paper`): 패널·메뉴·입력칸·창의 바탕.
- **작업대 바닥** (`ground`): 페이지 바탕, 분류 배지, 세그먼트 바탕, 메뉴 hover.
- **먹** (`ink`): 본문 글자. 순수한 검정이 아니라 초록 기가 도는 아주 짙은 색이다. 창 뒤 어두운 막도 이 색에 투명도를 준다.
- **흐린 먹** (`muted`): 설명·보조 글자, 표 머리, 메뉴 그룹 이름.
- **가는 선** (`line`): 모든 테두리와 구분선.
- **진한 선** (`line-strong`): 버튼에 마우스를 올렸을 때 테두리.

### Named Rules
**The One Green Rule.** 화면이 스스로 고르는 강조색은 네이버 그린 하나다. 새 기능에 다른 브랜드색을 들이지 않는다.

**The Signal-Only Rule.** 파랑과 빨강은 장식이 아니라 상태(진행 중 / 실패·삭제)다. 상태가 아닌 곳에 쓰지 않는다.

**The Emoji Carries Color Rule.** 화면에 색과 표정이 더 필요하면 면을 칠하지 말고 Fluent 3D 이모지를 쓴다. 단, 꼭 필요한 곳에만 쓰고 사이드바에는 넣지 않는다.

## Typography

**Body Font:** SUIT Variable (`app/fonts/SUIT-Variable.woff2`, 100–900), 대체 글꼴 system-ui, Malgun Gothic
**Mono Font:** Consolas (대체 D2Coding) — 로그·코드 편집칸·투어 안의 코드에만

**Character:** 한 가지 한글 서체로, 굵기 대비만으로 위계를 만든다. 제목은 800에 자간을 좁혀 단단하게, 본문은 500으로 편하게. 한글은 `word-break: keep-all`로 낱말 중간에서 끊지 않는다.

### Hierarchy
- **Display** (800, 34px, 1.15, -0.035em): 페이지 머리 제목. 화면마다 하나. 860px 아래에서는 26px.
- **Headline** (800, 26px, 1.2, -0.03em): 대시보드 상태 띠의 큰 숫자.
- **Title** (800, 17px, -0.02em): 패널 제목, 투어 상자 제목(17px), 확인창 제목(18px).
- **Body** (500, 15px, 1.6): 기본 글자. 보조 글자는 13~13.5px의 흐린 먹색.
- **Label** (700, 12.5px): 표 머리, 메뉴 그룹 이름(12.5px), 입력칸 아래 설명(500).
- **Mono** (12.5px, 1.55): 작업 로그, HTML 코드 편집칸.

큰 입력칸(글 주제)만 예외로 19px/700이다. 처음 화면에서 가장 먼저 쓰는 칸이라서다.

### Named Rules
**The Weight-Not-Size Rule.** 위계는 굵기(800 / 700 / 600 / 500)로 만든다. 크기를 키워서 소리치는 곳은 페이지 머리 하나뿐이다.

**The Keep-All Rule.** 한글 문구는 낱말 단위로 줄바꿈한다(`keep-all`). 긴 경로·명령 줄만 아무 데서나 끊는다.

## Layout

- **틀:** 2열 그리드. 왼쪽 메뉴 248px(화면 높이에 고정, 세로 스크롤) + 오른쪽 본문(`minmax(0, 1fr)`). 본문에는 최대 폭이 없고, 넓은 화면에서도 오른쪽 끝까지 쓴다.
- **본문 여백:** 36px 44px 64px. 860px 아래에서는 22px 16px 48px.
- **간격 리듬:** 6 / 8 / 12 / 16 / 18px. 패널 사이 18px, 패널 안쪽 22px 24px, 입력칸 사이 16px.
- **반응형 (860px 아래):** 메뉴가 위쪽 한 줄 가로 스크롤로 바뀐다(브랜드·그룹 이름 숨김, 그룹 묶음을 풀어 일렬). 상태 띠·2열 분할은 1열로 쌓이고, 표 칸 여백은 6px로 줄인다.
- **2열 분할(`split`):** 왼쪽 300px + 오른쪽 나머지. 숏폼 미리보기처럼 고정 폭 미디어와 설정을 나란히 둘 때 쓴다.
- **상태 띠:** 카드 세 장 대신 한 면을 세 칸(1.4fr 1fr 1fr)으로 나누고 칸 사이를 1px 선으로 가른다.

**The Strip-Not-Cards Rule.** 나란한 요약 정보는 카드 여러 장으로 흩지 않고 한 면을 선으로 나눈다.

## Elevation & Depth

기본은 납작하다. 면은 그림자 없이 흰 바탕 + 1px 선으로 바닥과 구분한다. 그림자는 화면 위에 떠서 다른 것을 가리는 것(확인창, 큰 창, 투어 상자)과 선택 상태 표시에만 쓴다.

### Shadow Vocabulary
- **선택 번짐** (`box-shadow: 0 0 0 3px #e9f9ee`): 포커스된 입력칸, 선택된 글꼴 카드, 로그인됨 점. 그림자가 아니라 바깥 테두리처럼 보인다.
- **세그먼트 들림** (`box-shadow: 0 1px 2px rgba(23, 32, 27, .12)`): 세그먼트에서 선택된 칸.
- **떠 있는 상자** (`box-shadow: 0 24px 60px rgba(23, 32, 27, .28)`): 투어 설명 상자.
- **창** (`box-shadow: 0 30px 80px rgba(23, 32, 27, .3)`): 확인창(`dialog.ask`), 큰 창(`dialog.modal`).
- **어두운 막:** 먹색에 투명도 .40~.45 (창 뒤, 투어 배경).

**The Flat-At-Rest Rule.** 화면에 붙어 있는 면에는 그림자가 없다. 그림자는 떠 있는 것과 선택된 것만의 몫이다.

## Shapes

모든 모서리가 둥글다. 크기가 클수록 더 둥글게: 작은 표시 6px → 분류 배지 8px → 버튼·입력칸 10px → 메뉴·큰 버튼·파일 영역 12px → 패널 14px → 창 18px. 알약 모양(99px)은 개수 배지·칩·사용 안내 버튼·상태 점에만 쓴다. 테두리는 거의 다 1px 가는 선이고, 글꼴 카드만 2px, 파일을 놓는 영역은 1.5px 점선이다.

**The Bigger-Is-Rounder Rule.** 모서리 반경은 요소 크기를 따라간다. 작은 요소에 큰 반경을 주거나 큰 면을 각지게 두지 않는다.

## Components

### Buttons
둥글고 굵은 글자, 누르면 살짝 작아진다.
- **Shape:** 부드러운 모서리 (10px), 높이 38px, 큰 버튼은 12px·48px.
- **기본:** 흰 바탕 + 가는 선 + 먹색 굵은 글자(14px/700). hover 때 선이 진해지고 바탕이 아주 옅은 회색(#fafbfa).
- **Primary:** 네이버 그린 채움 + 흰 글자. hover 때 눌린 그린.
- **Danger:** 평소에는 기본 버튼과 같고, hover 때만 옅은 빨강 바탕 + 빨강 글자. 되돌릴 수 없는 확인은 빨강 채움(`danger-fill`).
- **누름:** `scale(.97)`, 0.12초.
- **로딩:** 글자는 자리만 지키고(폭 유지) 가운데에서 16px 원이 돈다. "처리 중…" 같은 글자로 바꾸지 않는다.
- **비활성:** 투명도 .5.

### Chips
- **파일 칩:** 흰 바탕, 가는 선, 알약 모양, 13px. 오른쪽 × 버튼(22px 원)은 hover 때 옅은 빨강.
- **작은 표시(pill):** 6px 모서리, 11px/800. `기본`은 옅은 그린 + 짙은 그린 글자, `NEW`는 빨강 채움 + 흰 글자, `준비 중`은 바닥색 + 흐린 글자.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** 종이(흰색), 바닥 위에 놓인다.
- **Shadow Strategy:** 없음 (Flat-At-Rest).
- **Border:** 1px 가는 선.
- **Internal Padding:** 22px 24px. 패널 제목은 17px/800, 오른쪽 끝에 도구 버튼.

### Inputs / Fields
- **Style:** 흰 바탕, 1px 가는 선, 10px 모서리, 안쪽 10px 12px.
- **Focus:** 테두리가 네이버 그린이 되고 옅은 그린 3px 번짐. 브라우저 기본 외곽선은 끈다.
- **이름표:** 입력칸 위에 14px/700, 아래 설명은 12.5px 흐린 글자.
- **파일 영역:** 1.5px 점선, 12px 모서리. 끌어다 놓는 중에는 초록 테두리 + 옅은 그린 바탕.
- **세그먼트:** 바닥색 홈 안에 칸이 있고, 선택된 칸만 흰 바탕 + 들림 그림자.

### Navigation
- **사이드바:** 흰 바탕, 오른쪽 1px 선, 브랜드(18px/800) → 그룹 이름(12.5px/700 흐린 글자) → 메뉴. 메뉴에는 이모지를 넣지 않는다.
- **메뉴 항목:** 12px 모서리, 600 글자. hover 때 바닥색, 선택되면 옅은 그린 바탕 + 짙은 그린 800 글자. 진행 중인 작업 수는 오른쪽 파랑 알약 배지.
- **맨 아래:** 기본 네이버 계정 로그인 상태 카드. 상태 점(초록=로그인됨, 빨강=안 됨, 파랑 깜빡임=확인 중).
- **좁은 화면:** 위쪽 한 줄 가로 스크롤, 계정 카드는 오른쪽 끝에 이름만.

### 페이지 머리 (Signature)
큰 3D 이모지 + 34px/800 제목 + 흐린 한 줄 설명 + 오른쪽 도구 버튼. 화면마다 하나 있는, 이 시스템에서 유일하게 큰 목소리. 제목 옆에는 알약 모양 '사용 안내' 버튼이 있고, 누르면 투어가 시작된다.

### 사용 안내 투어 (Signature)
화면 나머지를 먹색 .45로 덮고, 설명하는 부분만 초록 3px 링으로 비춘다. 설명 상자는 흰 바탕 16px 모서리에 떠 있는 그림자. 아래에는 단계 점이 있는데, 현재 단계 점만 18px로 길어진 초록색이다. 상자는 0.28초 동안 다음 자리로 미끄러진다.

### 확인창 (Signature)
브라우저 기본 alert/confirm 대신 `useDialog()`의 자체 창. 폭 440px, 18px 모서리, 18px/800 제목 + 흐린 설명, 오른쪽 아래 버튼. 0.2초 동안 아래에서 살짝 떠오르며 커진다.

### 표
표 머리는 12.5px/700 흐린 글자, 줄 사이는 1px 선. 누를 수 있는 줄은 hover 때 옅은 회색, 선택된 줄은 옅은 그린. 글 목록에는 64px 둥근 썸네일과 날짜 머리줄(14px/800)이 있다.

## Do's and Don'ts

### Do:
- **Do** 새 색을 쓰기 전에 기존 토큰(`--green`, `--blue`, `--red`, `--ground`, `--line`)으로 되는지 먼저 본다. 토큰은 `app/globals.css`의 `:root`에 있다.
- **Do** 오래 걸리는 버튼은 `<Action>`으로 만들어 스피너를 쓰고 폭을 유지한다.
- **Do** 알림·확인은 전부 `useDialog()`로 띄운다.
- **Do** 새 화면에도 페이지 머리(이모지 + 제목 + 한 줄 설명)를 하나만 둔다.
- **Do** 움직임은 0.12~0.28초, 결과를 보여 줄 때만 넣고 `prefers-reduced-motion`에서 꺼지게 한다.
- **Do** 860px 아래에서도 쓸 수 있게 만든다. 가로로 넘치지 않게 하고, 좁은 화면에서는 1열로 쌓는다.
- **Do** 상태는 색만으로 전하지 말고 이모지·글자를 함께 쓴다(`.status`).

### Don't:
- **Don't** 다크 모드나 운영체제 테마를 따라가는 색을 만들지 않는다. 라이트 고정이다.
- **Don't** SUIT 말고 다른 UI 서체를 들이지 않는다. 고정폭 서체는 로그·코드에만 쓴다.
- **Don't** 버튼 글자를 "처리 중…"으로 바꾸지 않는다.
- **Don't** 사이드바 메뉴에 이모지를 넣지 않는다. 다른 곳에서도 꼭 필요할 때만 쓰고, 이모지는 Fluent 3D(`public/emoji`)만 쓴다.
- **Don't** 브라우저 기본 `alert` / `confirm`을 쓰지 않는다.
- **Don't** 화면에 붙은 패널에 그림자를 주지 않는다.
- **Don't** 파랑·빨강을 장식으로 쓰지 않는다.
