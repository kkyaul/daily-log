// ============================================================
// firebase-config.js — Firebase 초기화
// ============================================================
//
// ⚠️ 아래 firebaseConfig 값을 본인의 새 Firebase 프로젝트
//    설정값으로 교체하세요.
//    Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → SDK 설정
//
// 이 앱은 Firebase v10 모듈러 SDK를 CDN으로 불러옵니다.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc,
  query, orderBy, limit, startAfter, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ─── 본인 프로젝트 설정으로 교체 ───────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAgsodgqDXvm04fIrKt3Kzp4cq8fVghEdI",
  authDomain: "daily-log-5a8cb.firebaseapp.com",
  projectId: "daily-log-5a8cb",
  storageBucket: "daily-log-5a8cb.firebasestorage.app",
  messagingSenderId: "664146223206",
  appId: "1:664146223206:web:210ece3e40c114bdd24da7"
};
// ───────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export {
  db, storage, auth, provider,
  collection, doc, getDoc, getDocs, setDoc,
  query, orderBy, limit, startAfter, where, Timestamp,
  ref, uploadBytes, getDownloadURL, deleteObject,
  signInWithPopup, signOut, onAuthStateChanged,
};
