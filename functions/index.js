// ============================================================
// functions/index.js — Cloud Functions
// ============================================================
//
// 매일 00:30 KST에 당일 날짜 문서를 미리 생성합니다.
// 이미 존재하면 스킵합니다.
//
// 배포:
//   cd functions
//   npm install
//   firebase deploy --only functions
// ============================================================

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function emptyLog(dateId, dayOfWeek) {
  return {
    date: dateId,
    dayOfWeek,
    weather: null,
    mood: null,
    music: [],
    mindset: null,
    sleep: null,
    events: [],
    routine: [],
    todos: [],
    meals: [],
    waterMl: null,
    timeLog: [],
    gratitude: [],
    expenses: [],
    diary: { content: "", updatedAt: null },
    places: [],
    photos: [],
    searchText: "",
    wakeCondition: null,
    energyLevel: null,
  };
}

exports.createDailyLog = onSchedule(
  {
    schedule: "30 0 * * *",       // 매일 00:30
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",     // 서울 리전
  },
  async () => {
    const now = new Date();
    // KST 기준 날짜 계산
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(kst.getUTCDate()).padStart(2, "0");
    const dateId = `${y}-${m}-${d}`;
    const dow = DOW[kst.getUTCDay()];

    const ref = db.collection("logs").doc(dateId);
    const snap = await ref.get();
    if (snap.exists) {
      console.log(`이미 존재: ${dateId} — 스킵`);
      return;
    }
    await ref.set(emptyLog(dateId, dow));
    console.log(`생성 완료: ${dateId} (${dow})`);
  }
);
