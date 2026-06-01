# DAILY_LOG — Claude Code 작업 가이드

## 프로젝트 개요
하루 기록 텍스트를 파싱해서 Firestore에 저장하는 개인용 웹앱.
GitHub Pages(프론트엔드) + Firebase(DB/Storage/Functions/Auth) 구조.

## 기술 스택
- Frontend: 순수 HTML/CSS/JS (ES modules, no bundler)
- DB: Firestore (신규 프로젝트, `/logs/{YYYY-MM-DD}`)
- Storage: Firebase Storage (사진, WebP 변환)
- Functions: Cloud Functions v2 (node20, asia-northeast3)
- Auth: Firebase Auth (Google 로그인, 단일 사용자)
- 배포: GitHub Pages + firebase deploy

## 디렉터리 구조
```
daily-log/
├─ index.html
├─ css/style.css
├─ js/
│  ├─ firebase-config.js   # SDK 설정값 (배포 전 교체)
│  ├─ parser.js            # 텍스트 파싱 엔진 (ES module)
│  ├─ db.js                # Firestore/Storage 액세스
│  └─ app.js               # 메인 앱 로직
├─ functions/
│  ├─ index.js             # 매일 00:30 KST 스케줄러
│  └─ package.json
├─ firebase.json
├─ firestore.rules         # 단일 사용자 UID 전용
├─ storage.rules
└─ firestore.indexes.json
```

## 핵심 규칙

### 파싱 엔진 (parser.js)
- 섹션 헤더는 유니코드 수학 볼드/이탤릭 알파벳 → `normalizeMathAlpha()`로 정규화 후 매칭
- 국기 이모지(🇺🇸 등)는 Regional Indicator 두 글자 쌍 → `\p{Regional_Indicator}\p{Regional_Indicator}` 패턴으로 하나로 묶어야 함
- 빈 필드(null, 빈 배열)는 `buildMergePayload()`에서 제외 → Firestore merge 시 기존 데이터 유지
- Time Log 이모지-카테고리 매핑은 `TIMELOG_MAP` 상수로 고정 (parser.js 상단)

### Firestore 스키마 (/logs/{YYYY-MM-DD})
```
date, dayOfWeek,
weather{emoji, comment}, mood{emoji, comment, level},
wakeCondition, energyLevel,          // 1~5 별점
music[],                              // 배열
sleep{bedTime, bedComment, wakeTime, wakeComment},
events[{allDay, start, end, emoji, title}],
routine[{item, done}], todos[{item, done}],
meals[{type, time, content}],         // type: "meal"|"snack"
waterMl,
timeLog[{emoji, category, hours}],
gratitude[],
expenses[{place, category, amount, memo}],
diary{content, updatedAt},
places[{name, with}],
photos[{url, path, size, format}],
searchText                            // 키워드 합본 (검색용)
```

### DB 액세스 (db.js)
- 리스트 페이지네이션: `limit(20)` + `startAfter()` 무한 스크롤
- 장소 검색: 전체 로드 후 클라이언트 필터링 (`searchText` + `places[].name`)
- 사진 업로드: 클라이언트 canvas에서 WebP 변환 (긴 쪽 1200px, quality 0.82)
- merge 저장 시 `searchText`는 `rebuildSearchText()`로 재생성

### 보안
- Firestore/Storage 규칙: 단일 사용자 UID 전용 (`isOwner()`)
- firebase-config.js의 apiKey 등은 깃에 올려도 무방 (규칙으로 보호)
- 단, firestore.rules/storage.rules의 `REPLACE_WITH_YOUR_UID`는 배포 전 교체 필수

## Time Log 이모지 고정 매핑
🛏️ 수면 · 🏢 업무 · 🇺🇸 영어 · 🇯🇵 일본어 · 🎻 바이올린 · 📚 독서 · 💪🏼 운동 · 🗑️ 낭비

## 텍스트 파싱 입력 포맷
```
2026.04.22 (Wed)
𝑾𝑬𝑨𝑻𝑯𝑬𝑹 ⛅ 𝑴𝑶𝑶𝑫 🩷
W: 날씨 코멘트
M: 무드 코멘트
𝑻𝒐𝒅𝒂𝒚'𝒔 𝑴𝒖𝒔𝒊𝒄 / 𝑴𝒊𝒏𝒅𝒔𝒆𝒕 / 𝑺𝒍𝒆𝒆𝒑 𝑻𝒓𝒂𝒄𝒌𝒆𝒓
𝑬𝒗𝒆𝒏𝒕𝒔 / 𝑹𝒐𝒖𝒕𝒊𝒏𝒆 / 𝑻𝒐-𝒅𝒐 / 𝑴𝒆𝒂𝒍 / 𝑾𝒂𝒕𝒆𝒓
𝑻𝒊𝒎𝒆 𝑳𝒐𝒈 / 𝑮𝒓𝒂𝒕𝒊𝒕𝒖𝒅𝒆 𝑱𝒐𝒖𝒓𝒏𝒂𝒍
```
- 루틴/투두 완료: `░`, 미완료: `□`
- 식사: `🍴|`, 간식: `☕️|`
- 이벤트 하루종일: 이모지+제목, 시간있음: `HH:MM ~ HH:MM | 이모지 제목`

## 주의사항
- ES module(`type="module"`) 사용 → `import/export` 문법. CommonJS(`require`) 쓰지 말 것
- functions/는 CommonJS 유지 (`require`, node20)
- 파서 수정 시 반드시 실제 기록 텍스트로 테스트할 것 (국기 이모지 파싱이 취약점)
- `sudo npm install` 하지 말 것
