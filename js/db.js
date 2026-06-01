// ============================================================
// db.js — Firestore 데이터 액세스 계층
// ============================================================

import {
  db, storage,
  collection, doc, getDoc, getDocs, setDoc,
  query, orderBy, limit, startAfter, where,
  ref, uploadBytes, getDownloadURL, deleteObject,
} from "./firebase-config.js";

const LOGS = "logs";

// ── 단일 로그 조회 ──────────────────────────────────────────
export async function getLog(dateId) {
  const snap = await getDoc(doc(db, LOGS, dateId));
  return snap.exists() ? snap.data() : null;
}

// ── 빈 날짜 문서 생성 (없을 때만) ───────────────────────────
export async function ensureLogExists(dateId, dayOfWeek) {
  const existing = await getLog(dateId);
  if (existing) return existing;
  const base = {
    date: dateId,
    dayOfWeek: dayOfWeek || "",
    weather: null, mood: null, music: [], mindset: null,
    sleep: null, events: [], routine: [], todos: [],
    meals: [], waterMl: null, timeLog: [], gratitude: [],
    expenses: [], diary: { content: "", updatedAt: null },
    places: [], photos: [], searchText: "",
    wakeCondition: null, energyLevel: null,
  };
  await setDoc(doc(db, LOGS, dateId), base);
  return base;
}

// ── 파싱 결과 merge 저장 (빈 필드 스킵은 payload 단계에서 처리됨) ──
export async function mergeLog(dateId, payload) {
  await setDoc(doc(db, LOGS, dateId), payload, { merge: true });
}

// ── 임의 필드 업데이트 (상세화면 인라인 수정용) ─────────────
export async function updateLogFields(dateId, fields) {
  await setDoc(doc(db, LOGS, dateId), fields, { merge: true });
}

// ── 리스트 페이지네이션 (20건씩, 날짜 내림차순) ──────────────
const PAGE_SIZE = 20;
export async function getLogPage(cursor = null) {
  let q;
  if (cursor) {
    q = query(
      collection(db, LOGS),
      orderBy("date", "desc"),
      startAfter(cursor),
      limit(PAGE_SIZE)
    );
  } else {
    q = query(collection(db, LOGS), orderBy("date", "desc"), limit(PAGE_SIZE));
  }
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => d.data());
  const lastDoc = snap.docs[snap.docs.length - 1] || null;
  const lastCursor = lastDoc ? lastDoc.data().date : null;
  return { items, cursor: lastCursor, hasMore: snap.docs.length === PAGE_SIZE };
}

// ── 날짜 검색 (단일 또는 범위) ──────────────────────────────
export async function searchByDate(dateId) {
  const log = await getLog(dateId);
  return log ? [log] : [];
}

export async function searchByDateRange(startDate, endDate) {
  const q = query(
    collection(db, LOGS),
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// ── 장소명 검색 (전체 로드 후 클라이언트 필터링) ────────────
// searchText + places 배열 모두 검사
export async function searchByPlace(keyword) {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];
  const snap = await getDocs(query(collection(db, LOGS), orderBy("date", "desc")));
  return snap.docs
    .map((d) => d.data())
    .filter((log) => {
      const inPlaces = (log.places || []).some((p) =>
        (p.name || "").toLowerCase().includes(kw)
      );
      const inSearch = (log.searchText || "").toLowerCase().includes(kw);
      return inPlaces || inSearch;
    });
}

// ── 월별 데이터 조회 (루틴/무드/지출 통계용) ────────────────
export async function getMonth(year, month) {
  const mm = String(month).padStart(2, "0");
  const start = `${year}-${mm}-01`;
  const end = `${year}-${mm}-31`;
  const q = query(
    collection(db, LOGS),
    where("date", ">=", start),
    where("date", "<=", end),
    orderBy("date", "asc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

// ── 사진 업로드 (클라이언트 리사이징 후 Storage 업로드) ──────
// Cloud Functions 리사이징 대신 클라이언트에서 직접 WebP 변환.
// (Blaze에서 Functions도 가능하나, 클라이언트 변환이 비용·지연 모두 유리)
export async function resizeToWebP(file, maxEdge = 1200, quality = 0.82) {
  const img = await loadImage(file);
  let { width, height } = img;
  if (Math.max(width, height) > maxEdge) {
    if (width >= height) {
      height = Math.round((height * maxEdge) / width);
      width = maxEdge;
    } else {
      width = Math.round((width * maxEdge) / height);
      height = maxEdge;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  const blob = await new Promise((res) =>
    canvas.toBlob(res, "image/webp", quality)
  );
  return blob;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadPhoto(dateId, file) {
  const blob = await resizeToWebP(file);
  const filename = `${Date.now()}.webp`;
  const path = `photos/${dateId}/${filename}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/webp" });
  const url = await getDownloadURL(storageRef);
  return { url, path, size: Math.round(blob.size / 1024), format: "webp" };
}

export async function deletePhoto(path) {
  try {
    await deleteObject(ref(storage, path));
  } catch (e) {
    console.warn("삭제 실패(이미 없을 수 있음):", e);
  }
}

// ── searchText 재생성 (수동 편집 후 동기화용) ───────────────
export function rebuildSearchText(log) {
  const parts = [];
  if (log.weather?.comment) parts.push(log.weather.comment);
  if (log.mood?.comment) parts.push(log.mood.comment);
  parts.push(...(log.music || []));
  for (const e of log.events || []) parts.push(e.title);
  for (const m of log.meals || []) parts.push(m.content);
  for (const g of log.gratitude || []) parts.push(g);
  for (const p of log.places || []) { parts.push(p.name); if (p.with) parts.push(p.with); }
  for (const ex of log.expenses || []) { parts.push(ex.place); if (ex.memo) parts.push(ex.memo); }
  if (log.diary?.content) parts.push(log.diary.content);
  return parts.filter(Boolean).join(" ");
}
