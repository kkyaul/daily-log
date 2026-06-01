// ============================================================
// parser.js — 하루 기록 텍스트 파싱 모듈
// ============================================================
//
// 설계 원칙:
//  - 각 섹션은 𝑺𝒕𝒚𝒍𝒆𝒅 헤더(수학 기호 볼드/이탤릭)로 구분됨
//  - 파싱 결과에서 "비어있는 값"은 null/빈배열로 표시하여
//    저장 단계에서 merge 시 스킵할 수 있도록 함
//  - 헤더 텍스트는 유니코드 수학 알파벳이므로 정규화해서 매칭
//
// 반환 구조는 requirements.md의 Firestore 구조를 따름.
// ============================================================

// Time Log 이모지 → 카테고리 고정 매핑
const TIMELOG_MAP = [
  { emoji: "🛏️", category: "수면" },
  { emoji: "🏢", category: "업무" },
  { emoji: "🇺🇸", category: "영어" },
  { emoji: "🇯🇵", category: "일본어" },
  { emoji: "🎻", category: "바이올린" },
  { emoji: "📚", category: "독서" },
  { emoji: "💪🏼", category: "운동" },
  { emoji: "💪", category: "운동" },   // skin-tone 없는 변형 대비
  { emoji: "🗑️", category: "낭비" },
  { emoji: "🗑", category: "낭비" },
];

// 수학 볼드/이탤릭 알파벳을 일반 ASCII로 정규화
function normalizeMathAlpha(str) {
  let out = "";
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    // Mathematical Bold (U+1D400–U+1D433)
    if (cp >= 0x1d400 && cp <= 0x1d419) out += String.fromCharCode(65 + (cp - 0x1d400));
    else if (cp >= 0x1d41a && cp <= 0x1d433) out += String.fromCharCode(97 + (cp - 0x1d41a));
    // Mathematical Bold Italic (U+1D468–U+1D49B)
    else if (cp >= 0x1d468 && cp <= 0x1d481) out += String.fromCharCode(65 + (cp - 0x1d468));
    else if (cp >= 0x1d482 && cp <= 0x1d49b) out += String.fromCharCode(97 + (cp - 0x1d482));
    // Mathematical Italic (U+1D434–U+1D467)
    else if (cp >= 0x1d434 && cp <= 0x1d44d) out += String.fromCharCode(65 + (cp - 0x1d434));
    else if (cp >= 0x1d44e && cp <= 0x1d467) out += String.fromCharCode(97 + (cp - 0x1d44e));
    // Mathematical Sans-Serif Bold (U+1D5D4–U+1D607)
    else if (cp >= 0x1d5d4 && cp <= 0x1d5ed) out += String.fromCharCode(65 + (cp - 0x1d5d4));
    else if (cp >= 0x1d5ee && cp <= 0x1d607) out += String.fromCharCode(97 + (cp - 0x1d5ee));
    else out += ch;
  }
  return out;
}

// 섹션 헤더 정의: 정규화된 소문자 텍스트의 일부로 매칭
const SECTION_KEYS = [
  { key: "weather_mood", test: (s) => s.includes("weather") && s.includes("mood") },
  { key: "music",        test: (s) => s.includes("music") },
  { key: "mindset",      test: (s) => s.includes("mindset") },
  { key: "sleep",        test: (s) => s.includes("sleep") },
  { key: "events",       test: (s) => s.includes("events") },
  { key: "routine",      test: (s) => s === "routine" || (s.includes("routine") && !s.includes("to")) },
  { key: "todo",         test: (s) => s.includes("to-do") || s.includes("todo") || s.includes("to do") },
  { key: "meal",         test: (s) => s.includes("meal") },
  { key: "water",        test: (s) => s.includes("water") },
  { key: "timelog",      test: (s) => s.includes("time") && s.includes("log") },
  { key: "gratitude",    test: (s) => s.includes("gratitude") },
];

function detectSection(rawLine) {
  const norm = normalizeMathAlpha(rawLine).toLowerCase().trim();
  // 이모지/기호 제거 후 알파벳과 하이픈/공백만 남김
  const cleaned = norm.replace(/[^a-z\s\-']/g, "").trim();
  if (!cleaned) return null;
  for (const sec of SECTION_KEYS) {
    if (sec.test(cleaned)) return sec.key;
  }
  return null;
}

// 헤더 라인에서 이모지 추출
// 국기(지역표시문자 2개 조합), 변형선택자(FE0F), 스킨톤(1F3FB-FF) 처리
function extractEmojis(rawLine) {
  const matches = rawLine.match(
    /\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]?\u{FE0F}?/gu
  );
  return matches || [];
}

// "HH:MM" 형태 시간 문자열 정규화 (e.g. "6:58" → "06:58")
function padTime(t) {
  if (!t) return t;
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return t;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

// 시:분 → 소수 시간 (e.g. "6:58" → 6.97)
function timeToHours(t) {
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Math.round((parseInt(m[1]) + parseInt(m[2]) / 60) * 100) / 100;
}

// ── 메인 파서 ──────────────────────────────────────────────
function parseLog(text) {
  const result = {
    date: null,
    dayOfWeek: null,
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
  };

  const lines = text.split(/\r?\n/);

  // 1) 날짜 헤더: "2026.04.22 (Wed)"
  for (const line of lines) {
    const m = line.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*\(([^)]+)\)/);
    if (m) {
      result.date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      result.dayOfWeek = m[4].trim();
      break;
    }
  }

  // 2) 섹션별로 라인 그룹핑
  const sections = {};
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (current) sections[current].push(""); // 빈 줄도 보존 (sleep 구분용)
      continue;
    }
    const sec = detectSection(raw);
    if (sec) {
      current = sec;
      if (!sections[current]) sections[current] = [];
      // 헤더 라인 자체도 weather_mood는 이모지 추출 위해 저장
      sections[current]._header = raw;
      continue;
    }
    if (current) sections[current].push(line);
  }

  // 3) weather / mood
  if (sections.weather_mood) {
    const header = sections.weather_mood._header || "";
    const emojis = extractEmojis(header);
    const body = sections.weather_mood.filter((l) => l !== "");
    let weatherComment = "", moodComment = "";
    for (const l of body) {
      if (/^W\s*[:：]/i.test(l)) weatherComment = l.replace(/^W\s*[:：]\s*/i, "").trim();
      else if (/^M\s*[:：]/i.test(l)) moodComment = l.replace(/^M\s*[:：]\s*/i, "").trim();
    }
    const weatherEmoji = emojis[0] || "";
    const moodEmoji = emojis[1] || "";
    if (weatherEmoji || weatherComment)
      result.weather = { emoji: weatherEmoji, comment: weatherComment };
    if (moodEmoji || moodComment)
      result.mood = { emoji: moodEmoji, comment: moodComment, level: null };
  }

  // 4) music (여러 줄 가능, 각 줄에서 이모지 제거)
  if (sections.music) {
    const body = sections.music.filter((l) => l !== "");
    result.music = body.map((l) => l.replace(/^🎵\s*/, "").trim()).filter(Boolean);
  }

  // 5) mindset
  if (sections.mindset) {
    const body = sections.mindset.filter((l) => l !== "").join(" ").trim();
    result.mindset = body || null;
  }

  // 6) sleep — 🌃 취침 / 🌅 기상 + 각 코멘트
  if (sections.sleep) {
    const body = sections.sleep;
    let bedTime = null, bedComment = "", wakeTime = null, wakeComment = "";
    let mode = null;
    for (const l of body) {
      if (l === "") continue;
      if (/🌃|🌙|🛌/.test(l)) {
        mode = "bed";
        bedTime = padTime((l.match(/\d{1,2}:\d{2}/) || [null])[0]);
      } else if (/🌅|☀️|🌄/.test(l)) {
        mode = "wake";
        wakeTime = padTime((l.match(/\d{1,2}:\d{2}/) || [null])[0]);
      } else {
        if (mode === "bed") bedComment += (bedComment ? " " : "") + l;
        else if (mode === "wake") wakeComment += (wakeComment ? " " : "") + l;
      }
    }
    if (bedTime || wakeTime || bedComment || wakeComment) {
      result.sleep = { bedTime, bedComment, wakeTime, wakeComment };
    }
  }

  // 7) events — allDay or timed, 이모지 optional
  if (sections.events) {
    for (const l of sections.events.filter((x) => x !== "")) {
      const timeMatch = l.match(/(\d{1,2}:\d{2})\s*~\s*(\d{1,2}:\d{2})/);
      if (timeMatch) {
        let rest = l.replace(timeMatch[0], "").replace(/^\s*\|\s*/, "").trim();
        const emojis = extractEmojis(rest);
        const emoji = emojis[0] || "";
        const title = emoji ? rest.replace(emoji, "").trim() : rest;
        result.events.push({
          allDay: false,
          start: padTime(timeMatch[1]),
          end: padTime(timeMatch[2]),
          emoji,
          title: title.replace(/^\|/, "").trim(),
        });
      } else {
        // all-day
        const emojis = extractEmojis(l);
        const emoji = emojis[0] || "";
        const title = emoji ? l.replace(emoji, "").trim() : l.trim();
        result.events.push({ allDay: true, start: null, end: null, emoji, title });
      }
    }
  }

  // 8) routine / todo — ░ 완료, □ 미완료
  function parseChecklist(arr) {
    const out = [];
    for (const l of arr.filter((x) => x !== "")) {
      const done = /^[░▒▓■▪]/.test(l);
      const undone = /^[□☐▫]/.test(l);
      if (!done && !undone) continue;
      const item = l.replace(/^[░▒▓■▪□☐▫]\s*/, "").trim();
      if (item) out.push({ item, done: done });
    }
    return out;
  }
  if (sections.routine) result.routine = parseChecklist(sections.routine);
  if (sections.todo) result.todos = parseChecklist(sections.todo);

  // 9) meal — ☕️ 간식 / 🍴 식사 | HH:MM 내용
  if (sections.meal) {
    for (const l of sections.meal.filter((x) => x !== "")) {
      const isSnack = /☕/.test(l);
      const isMeal = /🍴|🍽/.test(l);
      const tm = l.match(/(\d{1,2}:\d{2})/);
      let content = l
        .replace(/[☕️🍴🍽]/g, "")
        .replace(/^\s*\|\s*/, "")
        .replace(/\d{1,2}:\d{2}/, "")
        .trim();
      result.meals.push({
        type: isSnack ? "snack" : isMeal ? "meal" : "meal",
        time: tm ? padTime(tm[1]) : "",
        content,
      });
    }
  }

  // 10) water
  if (sections.water) {
    const body = sections.water.filter((l) => l !== "").join(" ");
    const m = body.match(/(\d+)\s*mL/i);
    if (m) result.waterMl = parseInt(m[1]);
  }

  // 11) time log — 이모지 | H:MM, 고정 매핑
  if (sections.timelog) {
    for (const l of sections.timelog.filter((x) => x !== "")) {
      const tm = l.match(/(\d{1,2}:\d{2})/);
      if (!tm) continue;
      const hours = timeToHours(tm[1]);
      // 매핑에서 이모지 찾기
      let matched = null;
      for (const map of TIMELOG_MAP) {
        if (l.includes(map.emoji)) { matched = map; break; }
      }
      if (matched) {
        result.timeLog.push({ emoji: matched.emoji, category: matched.category, hours });
      }
    }
  }

  // 12) gratitude
  if (sections.gratitude) {
    result.gratitude = sections.gratitude
      .filter((l) => l !== "")
      .map((l) => l.replace(/^✏️?\s*/, "").trim())
      .filter(Boolean);
  }

  return result;
}

// ── 저장용: 빈 값 제외한 merge 페이로드 생성 ──────────────────
// 파싱 결과에서 "값이 있는" 필드만 추려서 반환.
// 빈 값(null, 빈 배열, 빈 문자열)은 제외 → 기존 DB 데이터 유지.
function buildMergePayload(parsed) {
  const payload = {};
  const isEmpty = (v) => {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "string") return v.trim() === "";
    if (typeof v === "object") return Object.keys(v).length === 0;
    return false;
  };

  // 항상 포함되어야 하는 식별 필드
  if (parsed.date) payload.date = parsed.date;
  if (parsed.dayOfWeek) payload.dayOfWeek = parsed.dayOfWeek;

  // 나머지 필드는 비어있지 않을 때만 포함
  const fields = [
    "weather", "mood", "music", "mindset", "sleep", "events",
    "routine", "todos", "meals", "waterMl", "timeLog", "gratitude",
  ];
  for (const f of fields) {
    if (!isEmpty(parsed[f])) payload[f] = parsed[f];
  }

  // searchText 생성 (검색용 키워드 합본)
  const searchParts = [];
  if (parsed.weather?.comment) searchParts.push(parsed.weather.comment);
  if (parsed.mood?.comment) searchParts.push(parsed.mood.comment);
  searchParts.push(...(parsed.music || []));
  for (const e of parsed.events || []) searchParts.push(e.title);
  for (const m of parsed.meals || []) searchParts.push(m.content);
  for (const g of parsed.gratitude || []) searchParts.push(g);
  if (searchParts.length) payload.searchText = searchParts.join(" ");

  return payload;
}

// 브라우저(ES module) export
export { parseLog, buildMergePayload, normalizeMathAlpha, TIMELOG_MAP };
