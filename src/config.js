/**
 * API 베이스 URL.
 * - 프로덕션(Vercel 등): VITE_API_URL 에 Railway 등 백엔드 HTTPS 오리진을 넣어 빌드합니다.
 *   미설정 시 /api 로만 호출되므로, 별도 리라이트 없으면 API가 동작하지 않습니다.
 * - 로컬 개발: VITE_API_URL 비우면 Vite 프록시(/api → localhost:5000) 사용
 */
const isProd =
  typeof import.meta !== 'undefined' && Boolean(import.meta.env?.PROD);

const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? String(import.meta.env.VITE_API_URL).trim()
  : '';

const base = envUrl ? envUrl.replace(/\/$/, '') : '';

if (isProd && !base) {
  console.warn(
    '[Nexvia CRM] 프로덕션 빌드에 VITE_API_URL이 없습니다. Vercel(또는 빌드 CI) 환경 변수에 백엔드 URL(예: https://xxx.up.railway.app)을 설정한 뒤 다시 빌드하세요.'
  );
}

/** 예: https://api.example.com/api — 비어 있으면 상대 경로 /api (로컬 프록시) */
export const API_BASE = base ? `${base}/api` : '/api';

/** 표시·웹훅 URL 정규화용 백엔드 오리진(슬래시 없음). 로컬에서 비어 있으면 Vite 프록시만 사용 중 */
export const BACKEND_BASE_URL = base;
