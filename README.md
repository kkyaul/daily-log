# DAILY_LOG

하루 기록 텍스트를 붙여넣으면 자동 파싱해서 저장하는 개인용 기록 웹앱.
터미널 인터페이스 · GitHub Pages + Firebase 구조.

---

## 기능

- 📝 **텍스트 파싱 입력** — 기록 텍스트 붙여넣기 → 자동 파싱 → merge 저장 (빈 필드는 기존 데이터 유지)
- 📋 **리스트 조회** — 날짜 내림차순, 20건씩 무한 스크롤, 날짜/장소명 검색
- 🔍 **상세 화면** — 모든 항목 수정 가능 (인라인 + 바텀시트 에디터)
- 📔 **일기 / 장소 / 사진** — 상세 화면에서 등록 (사진은 WebP 1200px 자동 변환)
- 💰 **지출내역** — 사용처/카테고리/금액/메모
- 📊 **월별 통계** — 루틴 현황 / 무드 캘린더 / 지출 통계 (연·월 select)
- ⏰ **자동 문서 생성** — 매일 00:30 KST 당일 문서 미리 생성 (Cloud Functions)

---

## 파일 구조

```
daily-log/
├─ index.html              # 앱 진입점
├─ css/style.css           # 터미널 테마 스타일
├─ js/
│  ├─ firebase-config.js   # ⚠️ Firebase 설정값 교체 필요
│  ├─ parser.js            # 텍스트 파싱 엔진
│  ├─ db.js                # Firestore/Storage 액세스
│  └─ app.js               # 메인 앱 로직
├─ functions/
│  ├─ index.js             # 매일 00:30 스케줄러
│  └─ package.json
├─ firebase.json
├─ firestore.rules         # ⚠️ 본인 UID 교체 필요
├─ storage.rules           # ⚠️ 본인 UID 교체 필요
└─ firestore.indexes.json
```

---

## 설정 순서

### 1. Firebase 프로젝트 생성
1. [Firebase 콘솔](https://console.firebase.google.com)에서 새 프로젝트 생성
2. Blaze 요금제로 업그레이드 (Functions/Storage 사용)
3. Firestore, Storage, Authentication(Google 로그인) 활성화

### 2. 설정값 교체
- `js/firebase-config.js` → 프로젝트 설정의 SDK 구성값 붙여넣기
- 첫 로그인 후 콘솔 → Authentication → 사용자에서 본인 **UID** 확인
- `firestore.rules`, `storage.rules`의 `REPLACE_WITH_YOUR_UID`를 본인 UID로 교체

### 3. 배포
```bash
npm install -g firebase-tools
firebase login
firebase use --add        # 생성한 프로젝트 선택

# Functions 의존성 설치
cd functions && npm install && cd ..

# 규칙 + 함수 배포
firebase deploy --only firestore:rules,storage,functions
```

### 4. 프론트엔드 배포 (GitHub Pages)
1. 이 폴더를 GitHub 저장소에 push
2. 저장소 Settings → Pages → Branch: main / root 선택
3. 배포된 URL을 Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 추가

> Firebase Hosting을 쓰려면 `firebase deploy --only hosting`도 가능합니다.

---

## 텍스트 입력 포맷

```
2026.04.22 (Wed)

𝑾𝑬𝑨𝑻𝑯𝑬𝑹 ⛅ 𝑴𝑶𝑶𝑫 🩷
W: 날씨 코멘트
M: 무드 코멘트

𝑻𝒐𝒅𝒂𝒚'𝒔 𝑴𝒖𝒔𝒊𝒄
🎵 곡명

𝑺𝒍𝒆𝒆𝒑 𝑻𝒓𝒂𝒄𝒌𝒆𝒓
🌃 23:37
취침 코멘트
🌅 06:36
기상 코멘트

𝑬𝒗𝒆𝒏𝒕𝒔
🎂 하루종일 이벤트
09:30 ~ 10:00 | 🇺🇸 시간 이벤트

𝑹𝒐𝒖𝒕𝒊𝒏𝒆
░ 완료항목
□ 미완료항목

𝑴𝒆𝒂𝒍
☕️| 07:42 간식
🍴| 18:22 식사

𝑾𝒂𝒕𝒆𝒓
0mL

𝑻𝒊𝒎𝒆 𝑳𝒐𝒈
🛏️ | 6:58
🇺🇸 | 1:00

𝑮𝒓𝒂𝒕𝒊𝒕𝒖𝒅𝒆 𝑱𝒐𝒖𝒓𝒏𝒂𝒍
✏️ 감사 내용
```

### Time Log 이모지 고정 매핑
🛏️ 수면 · 🏢 업무 · 🇺🇸 영어 · 🇯🇵 일본어 · 🎻 바이올린 · 📚 독서 · 💪🏼 운동 · 🗑️ 낭비

---

## 참고

- 무드레벨/기상컨디션/에너지레벨, 지출, 일기, 장소, 사진은 텍스트 파싱이 아닌 **상세 화면에서 직접 입력**합니다.
- 검색은 날짜(`2026-04` 또는 `2026-04-22`)와 장소/키워드 두 모드를 지원합니다.
- 보안 규칙이 단일 사용자(본인 UID) 전용이라 다른 사람은 접근할 수 없습니다.
