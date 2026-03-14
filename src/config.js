/**
 * API 베이스 URL.
 * - 프로덕션: VITE_API_URL 미설정 시 Heroku 백엔드 사용 (https://nexviaaicrm-09d65bddf221.herokuapp.com)
 * - 로컬 개발: VITE_API_URL 비우면 Vite 프록시(/api → localhost:5000) 사용
 */
const HEROKU_BACKEND = 'https://nexviaaicrm-09d65bddf221.herokuapp.com';
const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? String(import.meta.env.VITE_API_URL).trim()
  : '';
const base = envUrl
  ? envUrl.replace(/\/$/, '')
  : (typeof import.meta !== 'undefined' && import.meta.env?.PROD ? HEROKU_BACKEND : '');
export const API_BASE = base ? `${base}/api` : '/api';
export const BACKEND_BASE_URL = base || HEROKU_BACKEND;
