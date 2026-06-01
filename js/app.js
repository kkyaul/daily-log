// ============================================================
// app.js — 메인 앱 로직
// ============================================================

import { parseLog, buildMergePayload, TIMELOG_MAP } from "./parser.js";
import {
  auth, provider, signInWithPopup, signOut, onAuthStateChanged,
} from "./firebase-config.js";
import * as DB from "./db.js";

// ── 전역 상태 ──────────────────────────────────────────────
const state = {
  user: null,
  listCursor: null,
  listHasMore: true,
  listLoading: false,
  searchMode: "date",
  currentDetail: null,   // 현재 상세화면 로그 데이터
  monthlyTab: "routine",
  parsedPayload: null,   // PARSE 결과 임시 보관
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── 유틸 ───────────────────────────────────────────────────
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function stars(n) {
  const v = Number(n) || 0;
  return "★★★★★".slice(0, v) + "☆☆☆☆☆".slice(0, 5 - v);
}

function hoursToBar(hours, max = 8) {
  const filled = Math.round((Math.min(hours, max) / max) * 12);
  return `${"█".repeat(filled)}<span class="empty">${"░".repeat(12 - filled)}</span>`;
}

function sleepDuration(bed, wake) {
  if (!bed || !wake) return "";
  const [bh, bm] = bed.split(":").map(Number);
  const [wh, wm] = wake.split(":").map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins < 0) mins += 24 * 60;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function todayId() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 라우팅 ─────────────────────────────────────────────────
function showView(name) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === name));
  window.scrollTo(0, 0);
}

// ── 인증 ───────────────────────────────────────────────────
let appInitialized = false;

$("#login-btn").addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); }
  catch (e) { toast("로그인 실패: " + e.code); }
});

onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (user) {
    $("#gate").style.display = "none";
    $("#app").style.display = "block";
    initApp();
  } else {
    $("#gate").style.display = "flex";
    $("#app").style.display = "none";
  }
});

function initApp() {
  if (appInitialized) return;
  appInitialized = true;
  setupNav();
  setupInput();
  setupList();
  setupMonthly();
  setupSheet();
  showView("list");
  loadListFirstPage();
  populateYearMonth();
}

// ── 네비게이션 ──────────────────────────────────────────────
function setupNav() {
  $$(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const v = item.dataset.view;
      showView(v);
      if (v === "monthly") renderMonthly();
    });
  });
  $("#home-link").addEventListener("click", () => { showView("list"); });
}

// ============================================================
// INPUT 화면
// ============================================================
function setupInput() {
  $("#parse-btn").addEventListener("click", onParse);
  $("#clear-btn").addEventListener("click", () => {
    $("#raw-input").value = "";
    $("#parse-preview").innerHTML = "";
    state.parsedPayload = null;
  });
}

async function onParse() {
  const text = $("#raw-input").value.trim();
  if (!text) { toast("텍스트를 입력하세요"); return; }

  const parsed = parseLog(text);
  if (!parsed.date) { toast("날짜를 인식하지 못했습니다"); return; }

  const payload = buildMergePayload(parsed);
  state.parsedPayload = payload;

  // 기존 문서 존재 여부 확인
  const existing = await DB.getLog(parsed.date);

  const rows = [];
  const fieldLabel = {
    weather: "WEATHER/MOOD", music: "MUSIC", sleep: "SLEEP",
    events: "EVENTS", routine: "ROUTINE", todos: "TO-DO",
    meals: "MEALS", waterMl: "WATER", timeLog: "TIME LOG",
    gratitude: "GRATITUDE", mindset: "MINDSET",
  };
  const allFields = ["weather", "music", "sleep", "events", "routine", "todos", "meals", "waterMl", "timeLog", "gratitude"];

  for (const f of allFields) {
    const label = fieldLabel[f] || f.toUpperCase();
    if (payload[f] !== undefined) {
      let detail = "";
      if (Array.isArray(payload[f])) detail = `${payload[f].length}개 인식`;
      else if (f === "sleep") detail = `${payload.sleep.bedTime || "?"} → ${payload.sleep.wakeTime || "?"}`;
      else if (f === "weather") detail = `${payload.weather?.emoji || ""} / ${payload.mood?.emoji || ""}`;
      else if (f === "waterMl") detail = `${payload.waterMl} mL`;
      rows.push(`<div class="parse-block"><div class="parse-key">${label}</div><div class="parse-val"><span class="ok">✓</span> ${esc(detail)}</div></div>`);
    } else if (existing) {
      // 빈 필드 + 기존 데이터 있음 → 스킵 표시
      rows.push(`<div class="parse-block"><div class="parse-key">${label}</div><div class="parse-val"><span class="skip">⊘</span> 비어있음 · 기존 데이터 유지</div></div>`);
    }
  }

  const dateNote = existing
    ? `<span class="ok">✓</span> ${parsed.date} · ${parsed.dayOfWeek} <span class="badge">기존 문서</span>`
    : `<span class="ok">✓</span> ${parsed.date} · ${parsed.dayOfWeek} <span class="badge acc">신규</span>`;

  $("#parse-preview").innerHTML = `
    <div class="section">── PARSE PREVIEW</div>
    <div class="parse-block"><div class="parse-key">DATE</div><div class="parse-val">${dateNote}</div></div>
    ${rows.join("")}
    <button class="btn bd full" id="save-btn" style="margin-top:10px;">[ MERGE & SAVE ]</button>
  `;
  $("#save-btn").addEventListener("click", () => onSave(parsed.date));
}

async function onSave(dateId) {
  if (!state.parsedPayload) return;
  try {
    $("#save-btn").textContent = "SAVING...";
    await DB.mergeLog(dateId, state.parsedPayload);
    toast("저장 완료: " + dateId);
    $("#raw-input").value = "";
    $("#parse-preview").innerHTML = "";
    state.parsedPayload = null;
    // 리스트 갱신
    resetList();
    showView("list");
    loadListFirstPage();
  } catch (e) {
    toast("저장 실패: " + e.message);
    console.error(e);
  }
}

// ============================================================
// LIST 화면
// ============================================================
function setupList() {
  $$(".search-tab").forEach((t) => {
    t.addEventListener("click", () => {
      $$(".search-tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      state.searchMode = t.dataset.mode;
      $("#search-input").placeholder = state.searchMode === "date"
        ? "날짜 (2026-04 또는 2026-04-22)" : "장소명 또는 키워드";
      // 탭 전환 시 검색어 초기화 + 리스트 갱신
      $("#search-input").value = "";
      resetList();
      loadListFirstPage();
    });
  });

  let searchTimer;
  $("#search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const kw = e.target.value.trim();
    searchTimer = setTimeout(() => {
      if (!kw) { resetList(); loadListFirstPage(); }
      else runSearch(kw);
    }, 350);
  });

  // 무한 스크롤
  window.addEventListener("scroll", () => {
    if ($("#view-list").classList.contains("active") &&
        !state.listLoading && state.listHasMore &&
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
      loadNextPage();
    }
  });
}

function resetList() {
  state.listCursor = null;
  state.listHasMore = true;
  $("#list-container").innerHTML = "";
}

function dots(level, filled = "●", empty = "○") {
  const v = Number(level) || 0;
  return filled.repeat(v) + empty.repeat(5 - v);
}

function renderListItems(items, append = true) {
  const html = items.map((log) => {
    const meta = [
      log.dayOfWeek,
      log.weather?.emoji || "",
    ].filter(Boolean).join(" · ");
    const moodDots = log.mood?.level
      ? `<span class="list-dots mood-dots" title="MOOD">${dots(log.mood.level)}</span>` : "";
    const energyDots = log.energyLevel
      ? `<span class="list-dots energy-dots" title="ENERGY">${dots(log.energyLevel)}</span>` : "";
    return `
      <div class="list-item" data-date="${log.date}">
        <div class="list-left">
          <div class="list-date">${log.date}</div>
          <div class="list-meta">${esc(meta)}</div>
          <div class="list-indicators">${moodDots}${energyDots}</div>
        </div>
        <div class="list-mood">${log.mood?.emoji || "·"}</div>
        <div class="list-arrow">▶</div>
      </div>`;
  }).join("");
  if (append) $("#list-container").insertAdjacentHTML("beforeend", html);
  else $("#list-container").innerHTML = html;
  $$("#list-container .list-item").forEach((el) => {
    el.onclick = () => openDetail(el.dataset.date);
  });
}

async function loadListFirstPage() {
  state.listLoading = true;
  $("#list-loading").style.display = "block";
  try {
    const { items, cursor, hasMore } = await DB.getLogPage();
    state.listCursor = cursor;
    state.listHasMore = hasMore;
    renderListItems(items, false);
    if (items.length === 0) {
      $("#list-container").innerHTML = `<div class="empty-note">// 아직 기록이 없습니다. INPUT에서 추가하세요.</div>`;
    }
  } catch (e) {
    console.error(e);
    $("#list-container").innerHTML = `<div class="empty-note">로드 실패: ${esc(e.message)}</div>`;
  } finally {
    state.listLoading = false;
    $("#list-loading").style.display = "none";
  }
}

async function loadNextPage() {
  if (!state.listCursor) return;
  state.listLoading = true;
  $("#list-loading").style.display = "block";
  try {
    const { items, cursor, hasMore } = await DB.getLogPage(state.listCursor);
    state.listCursor = cursor;
    state.listHasMore = hasMore;
    renderListItems(items, true);
  } catch (e) {
    console.error(e);
  } finally {
    state.listLoading = false;
    $("#list-loading").style.display = "none";
  }
}

async function runSearch(keyword) {
  $("#list-container").innerHTML = `<div class="loading">SEARCHING...</div>`;
  state.listHasMore = false;
  try {
    let results;
    if (state.searchMode === "date") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(keyword)) {
        results = await DB.searchByDate(keyword);
      } else if (/^\d{4}-\d{2}$/.test(keyword)) {
        results = await DB.searchByDateRange(`${keyword}-01`, `${keyword}-31`);
      } else {
        results = [];
      }
    } else {
      results = await DB.searchByPlace(keyword);
    }
    if (results.length === 0) {
      $("#list-container").innerHTML = `<div class="empty-note">// 검색 결과가 없습니다.</div>`;
    } else {
      renderListItems(results, false);
    }
  } catch (e) {
    console.error(e);
    $("#list-container").innerHTML = `<div class="empty-note">검색 실패: ${esc(e.message)}</div>`;
  }
}

// ============================================================
// DETAIL 화면
// ============================================================
async function openDetail(dateId) {
  showView("detail");
  $("#detail-body").innerHTML = `<div class="loading">LOADING ${dateId}...</div>`;
  const log = await DB.getLog(dateId);
  if (!log) { $("#detail-body").innerHTML = `<div class="empty-note">데이터 없음</div>`; return; }
  state.currentDetail = log;
  renderDetail(log);
}

function renderDetail(log) {
  const d = log;
  const routineDone = (d.routine || []).filter((r) => r.done).length;

  const eventsHtml = (d.events || []).length
    ? `<div class="flat-list">${d.events.map((e) =>
        e.allDay
          ? `<div><span class="allday">ALL-DAY</span> ${esc(e.emoji)} ${esc(e.title)}</div>`
          : `<div><span class="time">${esc(e.start)}~${esc(e.end)}</span> ${esc(e.emoji)} ${esc(e.title)}</div>`
      ).join("")}</div>`
    : `<div class="empty-note">// 이벤트 없음</div>`;

  const routineHtml = (d.routine || []).length
    ? d.routine.map((r) =>
        `<div class="entry"><span class="${r.done ? "chk" : "unchk"}">[${r.done ? "✓" : "░"}]</span><span class="label ${r.done ? "" : "dim"}">${esc(r.item)}</span></div>`
      ).join("")
    : `<div class="empty-note">// 루틴 없음</div>`;

  const todoHtml = (d.todos || []).length
    ? d.todos.map((r) =>
        `<div class="entry"><span class="${r.done ? "chk" : "unchk"}">[${r.done ? "✓" : "░"}]</span><span class="label ${r.done ? "" : "dim"}">${esc(r.item)}</span></div>`
      ).join("")
    : `<div class="empty-note">// 할 일 없음</div>`;

  const mealsHtml = (d.meals || []).length
    ? `<div class="flat-list">${d.meals.map((m) =>
        `<div><span class="time">${esc(m.time)}</span> ${m.type === "snack" ? "☕" : "🍴"} ${esc(m.content)}</div>`
      ).join("")}</div>`
    : `<div class="empty-note">// 식사 기록 없음</div>`;

  const timeLogHtml = (d.timeLog || []).length
    ? d.timeLog.filter((t) => t.hours > 0).map((t) =>
        `<div class="bar-row"><span class="cat">${esc(t.category)}</span><span class="bar">${hoursToBar(t.hours)}</span><span class="num">${t.hours.toFixed(2)}h</span></div>`
      ).join("")
    : `<div class="empty-note">// 타임로그 없음</div>`;

  const gratitudeHtml = (d.gratitude || []).length
    ? `<div class="flat-list">${d.gratitude.map((g) => `<div>✏ ${esc(g)}</div>`).join("")}</div>`
    : `<div class="empty-note">// 감사 기록 없음</div>`;

  const expensesHtml = (d.expenses || []).length
    ? d.expenses.map((e) =>
        `<div class="exp-item"><span class="exp-l">${esc(e.place)} <span class="exp-cat">${esc(e.category)}</span></span><span class="exp-amt">${Number(e.amount).toLocaleString()}</span></div>`
      ).join("")
    : `<div class="empty-note">// 지출 없음</div>`;

  const placesHtml = (d.places || []).length
    ? d.places.map((p) =>
        `<div class="place-item"><div><div class="place-name">📍 ${esc(p.name)}</div><div class="place-with">with · ${esc(p.with || "—")}</div></div></div>`
      ).join("")
    : `<div class="empty-note">// 등록된 장소 없음</div>`;

  const photosHtml = `<div class="photo-grid">${
    Array.from({ length: 5 }).map((_, i) => {
      const p = (d.photos || [])[i];
      return p
        ? `<div class="photo-cell filled"><img src="${esc(p.url)}" alt=""></div>`
        : `<div class="photo-cell" data-photo-add="1">+</div>`;
    }).join("")
  }</div>`;

  const diaryHtml = d.diary?.content
    ? `<div class="flat-list" style="white-space:pre-wrap; color:var(--b);">${esc(d.diary.content)}</div>
       <div class="empty-note" style="margin-top:6px;">// 수정: ${d.diary.updatedAt || "—"}</div>`
    : `<div class="empty-note">// 아직 등록된 일기가 없습니다.</div>`;

  $("#detail-body").innerHTML = `
    <div class="prompt">$ <span>log --show ${d.date}</span>  <span class="cursor"></span>
      <span class="btn sm" id="back-btn" style="float:right;">◀ BACK</span></div>

    <div class="section">── OVERVIEW <button class="btn sm" data-edit="overview">EDIT</button></div>
    <div class="row"><span class="k">DATE</span><span class="v">${d.date} · ${esc(d.dayOfWeek)}</span></div>
    <div class="row"><span class="k">WEATHER</span><span class="v">${esc(d.weather?.emoji || "")} ${esc(d.weather?.comment || "—")}</span></div>
    <div class="row"><span class="k">MOOD EMO</span><span class="v acc">${esc(d.mood?.emoji || "")} ${esc(d.mood?.comment || "—")}</span></div>
    <div class="row"><span class="k">MOOD LVL</span><span class="v acc">${d.mood?.level ? stars(d.mood.level) + "  " + d.mood.level + " / 5" : "—"}</span></div>
    <div class="row"><span class="k">WAKE CON</span><span class="v ylw">${d.wakeCondition ? stars(d.wakeCondition) + "  " + d.wakeCondition + " / 5" : "—"}</span></div>
    <div class="row"><span class="k">ENERGY</span><span class="v grn">${d.energyLevel ? stars(d.energyLevel) + "  " + d.energyLevel + " / 5" : "—"}</span></div>
    <div class="row"><span class="k">MUSIC</span><span class="v dim">${(d.music || []).map(esc).join(" · ") || "—"}</span></div>
    <div class="row"><span class="k">WATER</span><span class="v dim">${d.waterMl ?? "—"} mL</span></div>

    <div class="section">── SLEEP <button class="btn sm" data-edit="sleep">EDIT</button></div>
    <div class="row"><span class="k">BED</span><span class="v">${esc(d.sleep?.bedTime || "—")}</span></div>
    <div class="row"><span class="k">WAKE</span><span class="v">${esc(d.sleep?.wakeTime || "—")} ${d.sleep ? "· " + sleepDuration(d.sleep.bedTime, d.sleep.wakeTime) : ""}</span></div>
    ${d.sleep?.bedComment ? `<div class="row"><span class="k">BED NOTE</span><span class="v dim">${esc(d.sleep.bedComment)}</span></div>` : ""}
    ${d.sleep?.wakeComment ? `<div class="row"><span class="k">WAKE NOTE</span><span class="v dim">${esc(d.sleep.wakeComment)}</span></div>` : ""}

    <div class="section">── EVENTS <button class="btn sm" data-edit="events">EDIT</button></div>
    ${eventsHtml}

    <div class="section">── ROUTINE <span class="badge grn">${routineDone}/${(d.routine || []).length}</span></div>
    ${routineHtml}

    <div class="section">── TO-DO <button class="btn sm" data-edit="todos">EDIT</button></div>
    ${todoHtml}

    <div class="section">── MEALS <button class="btn sm" data-edit="meals">EDIT</button></div>
    ${mealsHtml}

    <div class="section">── TIME LOG <button class="btn sm" data-edit="timelog">EDIT</button></div>
    ${timeLogHtml}

    <div class="section">── EXPENSES <button class="btn sm acc" data-edit="expenses">+ EDIT</button></div>
    ${expensesHtml}

    <div class="section">── GRATITUDE <button class="btn sm" data-edit="gratitude">EDIT</button></div>
    ${gratitudeHtml}

    <div class="section">── DIARY <button class="btn sm acc" data-edit="diary">+ EDIT</button></div>
    ${diaryHtml}

    <div class="section">── PLACES <button class="btn sm acc" data-edit="places">+ ADD</button></div>
    ${placesHtml}

    <div class="section">── PHOTOS <span class="badge">${(d.photos || []).length}/5</span></div>
    ${photosHtml}
    <input type="file" id="photo-file" accept="image/*" style="display:none;">
  `;

  // 이벤트 바인딩
  $("#back-btn").onclick = () => { showView("list"); };
  $$("[data-edit]").forEach((btn) => {
    btn.onclick = () => openEditSheet(btn.dataset.edit, log);
  });
  // 루틴/투두 토글
  $$("#detail-body .entry").forEach((el, idx) => {
    // 루틴과 투두를 구분하기 위해 별도 처리 (renderDetail에서 순서 보장)
  });
  bindChecklistToggles(log);
  bindPhotoHandlers(log);
}

// 루틴/투두 체크박스 토글
function bindChecklistToggles(log) {
  const sections = $$("#detail-body .section");
  // 간단히: routine/todo 항목 클릭 시 토글 후 저장
  // entry 요소를 순서대로 routine 개수만큼 / 그 다음 todo 개수만큼 매핑
  const entries = $$("#detail-body .entry");
  const rCount = (log.routine || []).length;
  entries.forEach((el, i) => {
    el.onclick = async () => {
      if (i < rCount) {
        log.routine[i].done = !log.routine[i].done;
        await DB.updateLogFields(log.date, { routine: log.routine });
      } else {
        const ti = i - rCount;
        if (log.todos[ti]) {
          log.todos[ti].done = !log.todos[ti].done;
          await DB.updateLogFields(log.date, { todos: log.todos });
        }
      }
      renderDetail(log);
    };
  });
}

function bindPhotoHandlers(log) {
  const fileInput = $("#photo-file");
  $$('[data-photo-add]').forEach((cell) => {
    cell.onclick = () => fileInput.click();
  });
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if ((log.photos || []).length >= 5) { toast("최대 5장까지 가능합니다"); return; }
    toast("업로드 중...");
    try {
      const photo = await DB.uploadPhoto(log.date, file);
      log.photos = [...(log.photos || []), photo];
      await DB.updateLogFields(log.date, { photos: log.photos });
      toast("사진 업로드 완료");
      renderDetail(log);
    } catch (err) {
      toast("업로드 실패: " + err.message);
      console.error(err);
    }
  };
  // 사진 삭제 (클릭 시)
  $$(".photo-cell.filled").forEach((cell, idx) => {
    cell.onclick = async () => {
      if (!confirm("이 사진을 삭제할까요?")) return;
      const photo = log.photos[idx];
      await DB.deletePhoto(photo.path);
      log.photos.splice(idx, 1);
      await DB.updateLogFields(log.date, { photos: log.photos });
      toast("삭제 완료");
      renderDetail(log);
    };
  });
}

// ============================================================
// 편집 바텀시트
// ============================================================
function setupSheet() {
  $("#sheet-close").onclick = closeSheet;
  $("#sheet-backdrop").onclick = (e) => {
    if (e.target.id === "sheet-backdrop") closeSheet();
  };
}
function openSheet(title, html) {
  $("#sheet-title-text").textContent = title;
  $("#sheet-content").innerHTML = html;
  $("#sheet-backdrop").classList.add("open");
}
function closeSheet() { $("#sheet-backdrop").classList.remove("open"); }

async function saveAndRefresh(log, fields) {
  // searchText 동기화
  const merged = { ...log, ...fields };
  fields.searchText = DB.rebuildSearchText(merged);
  await DB.updateLogFields(log.date, fields);
  Object.assign(log, fields);
  state.currentDetail = log;
  closeSheet();
  renderDetail(log);
  toast("저장 완료");
}

function openEditSheet(kind, log) {
  if (kind === "overview") return editOverview(log);
  if (kind === "todos") return editTodos(log);
  if (kind === "sleep") return editSleep(log);
  if (kind === "events") return editEvents(log);
  if (kind === "meals") return editMeals(log);
  if (kind === "timelog") return editTimeLog(log);
  if (kind === "expenses") return editExpenses(log);
  if (kind === "gratitude") return editGratitude(log);
  if (kind === "diary") return editDiary(log);
  if (kind === "places") return editPlaces(log);
}

function starPicker(id, value) {
  return `<div class="stars" data-star="${id}">${
    [1,2,3,4,5].map((n) => `<span class="star ${n <= (value||0) ? "on" : ""}" data-val="${n}">★</span>`).join("")
  }</div>`;
}
function bindStarPickers(target) {
  target.querySelectorAll(".stars").forEach((sp) => {
    sp.querySelectorAll(".star").forEach((s) => {
      s.onclick = () => {
        const v = Number(s.dataset.val);
        sp.dataset.value = v;
        sp.querySelectorAll(".star").forEach((x) => x.classList.toggle("on", Number(x.dataset.val) <= v));
      };
    });
  });
}

const MOOD_EMOJIS = ["🩷", "💛", "🩶", "💙", "🖤"];

function moodEmojiPicker(current) {
  return `<div class="mood-picker" id="mood-picker">${
    MOOD_EMOJIS.map((e) =>
      `<span class="mood-opt ${e === current ? "selected" : ""}" data-emoji="${e}">${e}</span>`
    ).join("")
  }</div>`;
}

function bindMoodPicker(target) {
  target.querySelectorAll(".mood-opt").forEach((el) => {
    el.onclick = () => {
      target.querySelectorAll(".mood-opt").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
    };
  });
}

function editOverview(log) {
  openSheet("EDIT OVERVIEW", `
    <div class="field"><label>WEATHER EMOJI</label><input id="e-wemoji" value="${esc(log.weather?.emoji || "")}"></div>
    <div class="field"><label>WEATHER COMMENT</label><input id="e-wcomment" value="${esc(log.weather?.comment || "")}"></div>
    <div class="field"><label>MOOD EMOJI</label>${moodEmojiPicker(log.mood?.emoji || "")}</div>
    <div class="field"><label>MOOD COMMENT</label><input id="e-mcomment" value="${esc(log.mood?.comment || "")}"></div>
    <div class="field"><label>MOOD LEVEL</label>${starPicker("mood", log.mood?.level)}</div>
    <div class="field"><label>WAKE CONDITION</label>${starPicker("wake", log.wakeCondition)}</div>
    <div class="field"><label>ENERGY LEVEL</label>${starPicker("energy", log.energyLevel)}</div>
    <div class="field"><label>MUSIC (줄바꿈으로 여러 곡)</label><textarea id="e-music" rows="3">${esc((log.music || []).join("\n"))}</textarea></div>
    <div class="field"><label>WATER (mL)</label><input id="e-water" type="number" value="${log.waterMl ?? ""}"></div>
    <button class="btn bd full" id="e-save">[ SAVE ]</button>
  `);
  bindStarPickers($("#sheet-content"));
  bindMoodPicker($("#sheet-content"));
  $("#e-save").onclick = async () => {
    const getStarVal = (id) => {
      const el = $(`#sheet-content [data-star="${id}"]`);
      return el && el.dataset.value ? Number(el.dataset.value) : (id === "mood" ? log.mood?.level : id === "wake" ? log.wakeCondition : log.energyLevel) || null;
    };
    const selectedMood = $("#sheet-content .mood-opt.selected")?.dataset.emoji || log.mood?.emoji || "";
    const fields = {
      weather: { emoji: $("#e-wemoji").value.trim(), comment: $("#e-wcomment").value.trim() },
      mood: { emoji: selectedMood, comment: $("#e-mcomment").value.trim(), level: getStarVal("mood") },
      wakeCondition: getStarVal("wake"),
      energyLevel: getStarVal("energy"),
      music: $("#e-music").value.split("\n").map((s) => s.trim()).filter(Boolean),
      waterMl: $("#e-water").value === "" ? null : Number($("#e-water").value),
    };
    await saveAndRefresh(log, fields);
  };
}

function editSleep(log) {
  const s = log.sleep || {};
  openSheet("EDIT SLEEP", `
    <div class="field"><label>BED TIME (HH:MM)</label><input id="e-bed" value="${esc(s.bedTime || "")}"></div>
    <div class="field"><label>BED COMMENT</label><textarea id="e-bedc" rows="2">${esc(s.bedComment || "")}</textarea></div>
    <div class="field"><label>WAKE TIME (HH:MM)</label><input id="e-wake" value="${esc(s.wakeTime || "")}"></div>
    <div class="field"><label>WAKE COMMENT</label><textarea id="e-wakec" rows="2">${esc(s.wakeComment || "")}</textarea></div>
    <button class="btn bd full" id="e-save">[ SAVE ]</button>
  `);
  $("#e-save").onclick = async () => {
    await saveAndRefresh(log, { sleep: {
      bedTime: $("#e-bed").value.trim(), bedComment: $("#e-bedc").value.trim(),
      wakeTime: $("#e-wake").value.trim(), wakeComment: $("#e-wakec").value.trim(),
    }});
  };
}

// 배열 항목 편집 공통 (events, meals, gratitude, expenses, places)
function editEvents(log) {
  const render = () => (log._editEvents || []).map((e, i) => `
    <div class="parse-block">
      <div style="display:flex; gap:6px; margin-bottom:6px;">
        <label style="margin:0;"><input type="checkbox" data-allday="${i}" ${e.allDay ? "checked" : ""} style="width:auto;"> ALL-DAY</label>
      </div>
      <div style="display:flex; gap:6px; margin-bottom:6px;">
        <input data-start="${i}" placeholder="시작 09:30" value="${esc(e.start || "")}" ${e.allDay ? "disabled" : ""}>
        <input data-end="${i}" placeholder="종료 10:00" value="${esc(e.end || "")}" ${e.allDay ? "disabled" : ""}>
      </div>
      <div style="display:flex; gap:6px;">
        <input data-emoji="${i}" placeholder="이모지" value="${esc(e.emoji || "")}" style="max-width:70px;">
        <input data-title="${i}" placeholder="제목" value="${esc(e.title || "")}">
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>
    </div>`).join("");

  log._editEvents = JSON.parse(JSON.stringify(log.events || []));
  const show = () => {
    openSheet("EDIT EVENTS", `
      <div id="ev-list">${render()}</div>
      <button class="btn full" id="ev-add" style="margin-bottom:10px;">+ 이벤트 추가</button>
      <button class="btn bd full" id="e-save">[ SAVE ]</button>
    `);
    $("#ev-add").onclick = () => { log._editEvents.push({ allDay: false, start: "", end: "", emoji: "", title: "" }); show(); };
    $("#sheet-content").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { log._editEvents.splice(Number(b.dataset.del), 1); show(); });
    $("#sheet-content").querySelectorAll("[data-allday]").forEach((c) => c.onclick = () => { const i = Number(c.dataset.allday); log._editEvents[i].allDay = c.checked; syncEdit(); show(); });
    $("#e-save").onclick = async () => { syncEdit(); const ev = log._editEvents.filter((e) => e.title.trim()); delete log._editEvents; await saveAndRefresh(log, { events: ev }); };
  };
  const syncEdit = () => {
    $("#sheet-content").querySelectorAll("[data-title]").forEach((el) => {
      const i = Number(el.dataset.title);
      log._editEvents[i].title = el.value;
      const s = $(`#sheet-content [data-start="${i}"]`), e = $(`#sheet-content [data-end="${i}"]`),
            em = $(`#sheet-content [data-emoji="${i}"]`);
      log._editEvents[i].start = s ? s.value : ""; log._editEvents[i].end = e ? e.value : "";
      log._editEvents[i].emoji = em ? em.value : "";
      if (log._editEvents[i].allDay) { log._editEvents[i].start = null; log._editEvents[i].end = null; }
    });
  };
  show();
}

function editMeals(log) {
  log._edit = JSON.parse(JSON.stringify(log.meals || []));
  const render = () => log._edit.map((m, i) => `
    <div class="parse-block">
      <div style="display:flex; gap:6px;">
        <select data-type="${i}" style="max-width:90px;">
          <option value="meal" ${m.type === "meal" ? "selected" : ""}>식사</option>
          <option value="snack" ${m.type === "snack" ? "selected" : ""}>간식</option>
        </select>
        <input data-time="${i}" value="${esc(m.time || "")}" placeholder="HH:MM" style="max-width:80px;">
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>
      <input data-content="${i}" value="${esc(m.content || "")}" placeholder="음식 내용" style="margin-top:6px;">
    </div>`).join("");
  const show = () => {
    openSheet("EDIT MEALS", `
      <div>${render()}</div>
      <button class="btn full" id="m-add" style="margin-bottom:10px;">+ 식사 추가 (현재 시각)</button>
      <button class="btn bd full" id="e-save">[ SAVE ]</button>
    `);
    $("#m-add").onclick = () => {
      const now = new Date();
      const t = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      log._edit.push({ type: "meal", time: t, content: "" }); sync(); show();
    };
    $("#sheet-content").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { sync(); log._edit.splice(Number(b.dataset.del),1); show(); });
    $("#e-save").onclick = async () => { sync(); const meals = log._edit.filter((m) => m.content.trim()); delete log._edit; await saveAndRefresh(log, { meals }); };
  };
  const sync = () => {
    $("#sheet-content").querySelectorAll("[data-content]").forEach((el) => {
      const i = Number(el.dataset.content);
      log._edit[i].content = el.value;
      log._edit[i].time = $(`#sheet-content [data-time="${i}"]`).value;
      log._edit[i].type = $(`#sheet-content [data-type="${i}"]`).value;
    });
  };
  show();
}

function editTimeLog(log) {
  // 고정 매핑 기준으로 모든 카테고리 표시, 시간만 수정
  const existing = {};
  (log.timeLog || []).forEach((t) => existing[t.category] = t.hours);
  const cats = [...new Map(TIMELOG_MAP.map((m) => [m.category, m.emoji])).entries()];
  openSheet("EDIT TIME LOG", `
    ${cats.map(([cat, emoji]) => `
      <div class="field" style="display:flex; align-items:center; gap:8px;">
        <label style="margin:0; min-width:80px;">${emoji} ${cat}</label>
        <input data-cat="${esc(cat)}" data-emoji="${esc(emoji)}" type="number" step="0.01" value="${existing[cat] ?? 0}">
      </div>`).join("")}
    <button class="btn bd full" id="e-save">[ SAVE ]</button>
  `);
  $("#e-save").onclick = async () => {
    const timeLog = [];
    $("#sheet-content").querySelectorAll("[data-cat]").forEach((el) => {
      timeLog.push({ emoji: el.dataset.emoji, category: el.dataset.cat, hours: Number(el.value) || 0 });
    });
    await saveAndRefresh(log, { timeLog });
  };
}

function editGratitude(log) {
  openSheet("EDIT GRATITUDE", `
    <div class="field"><label>감사 항목 (줄바꿈으로 구분)</label>
      <textarea id="e-grat" rows="6">${esc((log.gratitude || []).join("\n"))}</textarea></div>
    <button class="btn bd full" id="e-save">[ SAVE ]</button>
  `);
  $("#e-save").onclick = async () => {
    await saveAndRefresh(log, { gratitude: $("#e-grat").value.split("\n").map((s) => s.trim()).filter(Boolean) });
  };
}

function editTodos(log) {
  log._edit = JSON.parse(JSON.stringify(log.todos || []));
  const render = () => log._edit.map((t, i) => `
    <div class="parse-block">
      <div style="display:flex; gap:6px; align-items:center;">
        <label style="margin:0; display:flex; align-items:center; gap:6px; cursor:pointer;">
          <input type="checkbox" data-done="${i}" ${t.done ? "checked" : ""} style="width:auto;">
          완료
        </label>
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>
      <input data-item="${i}" value="${esc(t.item || "")}" placeholder="할 일 내용" style="margin-top:6px;">
    </div>`).join("");
  const show = () => {
    openSheet("EDIT TO-DO", `
      <div id="todo-list">${render()}</div>
      <button class="btn full" id="td-add" style="margin-bottom:10px;">+ 항목 추가</button>
      <button class="btn bd full" id="e-save">[ SAVE ]</button>
    `);
    $("#td-add").onclick = () => { sync(); log._edit.push({ item: "", done: false }); show(); };
    $("#sheet-content").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { sync(); log._edit.splice(Number(b.dataset.del), 1); show(); });
    $("#e-save").onclick = async () => { sync(); const todos = log._edit.filter((t) => t.item.trim()); delete log._edit; await saveAndRefresh(log, { todos }); };
  };
  const sync = () => {
    $("#sheet-content").querySelectorAll("[data-item]").forEach((el) => {
      const i = Number(el.dataset.item);
      log._edit[i].item = el.value;
      const cb = $(`#sheet-content [data-done="${i}"]`);
      if (cb) log._edit[i].done = cb.checked;
    });
  };
  show();
}

function editExpenses(log) {
  log._edit = JSON.parse(JSON.stringify(log.expenses || []));
  const CATS = ["외식","식재료","카페","교통","의류","생활용품","전자기기","도서","교육","의료","운동","문화","여행","숙박","기타"];
  const render = () => log._edit.map((x, i) => `
    <div class="parse-block">
      <div style="display:flex; gap:6px;">
        <input data-place="${i}" value="${esc(x.place || "")}" placeholder="사용처">
        <select data-cat="${i}" style="max-width:90px;">
          ${CATS.map((c) => `<option ${x.category === c ? "selected" : ""}>${c}</option>`).join("")}
        </select>
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>
      <div style="display:flex; gap:6px; margin-top:6px;">
        <input data-amount="${i}" type="number" value="${x.amount ?? ""}" placeholder="금액" style="max-width:110px;">
        <input data-memo="${i}" value="${esc(x.memo || "")}" placeholder="메모 (선택)">
      </div>
    </div>`).join("");
  const show = () => {
    openSheet("EDIT EXPENSES", `
      <div>${render()}</div>
      <button class="btn full" id="x-add" style="margin-bottom:10px;">+ 지출 추가</button>
      <button class="btn bd full" id="e-save">[ SAVE ]</button>
    `);
    $("#x-add").onclick = () => { sync(); log._edit.push({ place:"", category:"식비", amount:null, memo:"" }); show(); };
    $("#sheet-content").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { sync(); log._edit.splice(Number(b.dataset.del),1); show(); });
    $("#e-save").onclick = async () => { sync(); const expenses = log._edit.filter((x) => x.place.trim() && x.amount); delete log._edit; await saveAndRefresh(log, { expenses }); };
  };
  const sync = () => {
    $("#sheet-content").querySelectorAll("[data-place]").forEach((el) => {
      const i = Number(el.dataset.place);
      log._edit[i].place = el.value;
      log._edit[i].category = $(`#sheet-content [data-cat="${i}"]`).value;
      log._edit[i].amount = Number($(`#sheet-content [data-amount="${i}"]`).value) || null;
      log._edit[i].memo = $(`#sheet-content [data-memo="${i}"]`).value;
    });
  };
  show();
}

function editDiary(log) {
  openSheet("EDIT DIARY", `
    <div class="field"><label>오늘의 일기</label>
      <textarea id="e-diary" rows="10">${esc(log.diary?.content || "")}</textarea></div>
    <button class="btn bd full" id="e-save">[ SAVE ]</button>
  `);
  $("#e-save").onclick = async () => {
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    await saveAndRefresh(log, { diary: { content: $("#e-diary").value.trim(), updatedAt: now } });
  };
}

function editPlaces(log) {
  log._edit = JSON.parse(JSON.stringify(log.places || []));
  const render = () => log._edit.map((p, i) => `
    <div class="parse-block">
      <div style="display:flex; gap:6px;">
        <input data-name="${i}" value="${esc(p.name || "")}" placeholder="장소명">
        <button class="btn sm danger" data-del="${i}">✕</button>
      </div>
      <input data-with="${i}" value="${esc(p.with || "")}" placeholder="같이 간 사람 (선택)" style="margin-top:6px;">
    </div>`).join("");
  const show = () => {
    openSheet("EDIT PLACES", `
      <div>${render()}</div>
      <button class="btn full" id="p-add" style="margin-bottom:10px;">+ 장소 추가</button>
      <button class="btn bd full" id="e-save">[ SAVE ]</button>
    `);
    $("#p-add").onclick = () => { sync(); log._edit.push({ name:"", with:"" }); show(); };
    $("#sheet-content").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { sync(); log._edit.splice(Number(b.dataset.del),1); show(); });
    $("#e-save").onclick = async () => { sync(); const places = log._edit.filter((p) => p.name.trim()); delete log._edit; await saveAndRefresh(log, { places }); };
  };
  const sync = () => {
    $("#sheet-content").querySelectorAll("[data-name]").forEach((el) => {
      const i = Number(el.dataset.name);
      log._edit[i].name = el.value;
      log._edit[i].with = $(`#sheet-content [data-with="${i}"]`).value;
    });
  };
  show();
}

// ============================================================
// MONTHLY 화면
// ============================================================
function setupMonthly() {
  $$(".tab").forEach((t) => {
    t.onclick = () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      state.monthlyTab = t.dataset.tab;
      renderMonthly();
    };
  });
  $("#year-select").onchange = renderMonthly;
  $("#month-select").onchange = renderMonthly;
}

function populateYearMonth() {
  const now = new Date();
  const ys = $("#year-select"), ms = $("#month-select");
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) {
    ys.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`);
  }
  for (let m = 1; m <= 12; m++) {
    ms.insertAdjacentHTML("beforeend", `<option value="${m}">${String(m).padStart(2,"0")}</option>`);
  }
  ys.value = now.getFullYear();
  ms.value = now.getMonth() + 1;
}

async function renderMonthly() {
  const year = Number($("#year-select").value);
  const month = Number($("#month-select").value);
  const box = $("#monthly-content");
  box.innerHTML = `<div class="loading">LOADING...</div>`;
  let logs;
  try { logs = await DB.getMonth(year, month); }
  catch (e) { box.innerHTML = `<div class="empty-note">로드 실패: ${esc(e.message)}</div>`; return; }

  if (state.monthlyTab === "routine") renderMonthlyRoutine(logs, year, month, box);
  else if (state.monthlyTab === "mood") renderMonthlyMood(logs, year, month, box);
  else renderMonthlyExpense(logs, year, month, box);
}

function renderMonthlyRoutine(logs, year, month, box) {
  // 모든 루틴 항목 수집
  const itemSet = [];
  logs.forEach((l) => (l.routine || []).forEach((r) => { if (!itemSet.includes(r.item)) itemSet.push(r.item); }));
  if (itemSet.length === 0) { box.innerHTML = `<div class="empty-note">// 루틴 데이터가 없습니다.</div>`; return; }

  const byDate = {};
  logs.forEach((l) => byDate[l.date] = l);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dows = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

  let rows = "";
  const counts = {};
  itemSet.forEach((it) => counts[it] = 0);

  for (let day = 1; day <= daysInMonth; day++) {
    const dateId = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const log = byDate[dateId];
    const dow = dows[new Date(year, month - 1, day).getDay()];
    const isToday = dateId === todayId();
    let cells = "";
    itemSet.forEach((it) => {
      const r = log && (log.routine || []).find((x) => x.item === it);
      const done = r && r.done;
      if (done) counts[it]++;
      cells += `<td>${done ? '<span class="rg-done">✓</span>' : '<span class="rg-miss">·</span>'}</td>`;
    });
    rows += `<tr><td class="date-cell ${isToday ? "today" : ""}">${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")} ${dow}</td>${cells}</tr>`;
  }

  const shortLabel = (s) => s.length > 4 ? s.slice(0, 3) : s;
  box.innerHTML = `
    <div class="routine-wrap">
      <table class="routine-table">
        <thead><tr><th class="date-col">DATE</th>${itemSet.map((it) => `<th>${esc(shortLabel(it))}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="section">── SUMMARY · ${daysInMonth}일 기준</div>
    <div class="routine-summary">
      ${itemSet.map((it) => `<div class="rs-item"><span>${esc(it)}</span><span class="rs-val">${counts[it]}/${daysInMonth}</span></div>`).join("")}
    </div>`;
}

function renderMonthlyMood(logs, year, month, box) {
  const byDate = {};
  logs.forEach((l) => byDate[l.date] = l);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const dows = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

  let cells = "";
  for (let i = 0; i < firstDow; i++) cells += `<div class="cal-cell empty"></div>`;
  const moodCount = {};
  for (let day = 1; day <= daysInMonth; day++) {
    const dateId = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const log = byDate[dateId];
    const emoji = log?.mood?.emoji || "";
    if (emoji) moodCount[emoji] = (moodCount[emoji] || 0) + 1;
    const cls = log ? (dateId === todayId() ? "has today" : "has") : "";
    cells += `<div class="cal-cell ${cls}" ${log ? `data-date="${dateId}"` : ""}>
      <div class="num">${day}</div>${emoji ? `<div class="emoji">${emoji}</div>` : ""}</div>`;
  }

  const sorted = Object.entries(moodCount).sort((a,b) => b[1]-a[1]);
  box.innerHTML = `
    <div class="cal-grid">
      ${dows.map((d) => `<div class="cal-head">${d}</div>`).join("")}
      ${cells}
    </div>
    <div class="section">── MOOD STATS</div>
    ${sorted.length ? sorted.map(([e,c],i) => `<div class="row"><span class="k">${e}</span><span class="v">${c}일${i===0?" · 가장 많음":""}</span></div>`).join("")
      : `<div class="empty-note">// 무드 데이터 없음</div>`}`;

  box.querySelectorAll(".cal-cell.has").forEach((c) => {
    if (c.dataset.date) c.onclick = () => openDetail(c.dataset.date);
  });
}

function renderMonthlyExpense(logs, year, month, box) {
  let total = 0;
  const byCat = {};
  let maxItem = null;        // {date, place, amount}
  const byDay = {};
  logs.forEach((l) => {
    (l.expenses || []).forEach((x) => {
      const amt = Number(x.amount) || 0;
      total += amt;
      byCat[x.category] = (byCat[x.category] || 0) + amt;
      byDay[l.date] = (byDay[l.date] || 0) + amt;
      if (!maxItem || amt > maxItem.amount) maxItem = { date: l.date, place: x.place, amount: amt };
    });
  });

  if (total === 0) { box.innerHTML = `<div class="empty-note">// 지출 데이터가 없습니다.</div>`; return; }

  const maxDay = Object.entries(byDay).sort((a,b) => b[1]-a[1])[0];
  const catSorted = Object.entries(byCat).sort((a,b) => b[1]-a[1]);
  const catMax = catSorted[0][1];

  box.innerHTML = `
    <div class="section">── TOTAL</div>
    <div class="row"><span class="k">합계</span><span class="v acc" style="font-size:18px;">₩ ${total.toLocaleString()}</span></div>

    <div class="section">── BY CATEGORY</div>
    ${catSorted.map(([cat, amt]) => {
      const filled = Math.round((amt / catMax) * 12);
      return `<div class="bar-row"><span class="cat">${esc(cat)}</span><span class="bar">${"█".repeat(filled)}<span class="empty">${"░".repeat(12-filled)}</span></span><span class="num">${amt.toLocaleString()}</span></div>`;
    }).join("")}

    <div class="section">── HIGHLIGHTS</div>
    <div class="row"><span class="k">최대 소비</span><span class="v">${esc(maxItem.date.slice(5))} · ${esc(maxItem.place)} · ${maxItem.amount.toLocaleString()}</span></div>
    <div class="row"><span class="k">최다 소비일</span><span class="v">${esc(maxDay[0].slice(5))} · ${maxDay[1].toLocaleString()}</span></div>`;
}

// 로그아웃 (status 클릭)
$("#status").addEventListener("click", async () => {
  if (confirm("로그아웃 할까요?")) { await signOut(auth); location.reload(); }
});
