/**
 * ERP 기준정보 API 클라이언트.
 * 모든 요청은 HttpOnly 쿠키 세션(crmFetchInit)을 사용하며, 서버 오류 메시지를 그대로 노출합니다.
 */
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';

const ERP_BASE = `${API_BASE}/erp`;

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function readError(res, fallback) {
  const data = await res.json().catch(() => ({}));
  const error = new Error(data.error || fallback);
  error.status = res.status;
  error.code = data.code || '';
  error.latest = data.latest || null;
  return error;
}

/** 목록 조회 — 서버 페이지네이션 */
export async function fetchErpList(path, params = {}) {
  const res = await fetch(`${ERP_BASE}/${path}${buildQuery(params)}`, crmFetchInit());
  if (!res.ok) throw await readError(res, '목록을 불러오지 못했습니다.');
  return res.json();
}

/** 단건 조회 — URL 파라미터로 연 모달이 새로고침돼도 목록 없이 표시되도록 */
export async function fetchErpRecord(path, id) {
  const res = await fetch(`${ERP_BASE}/${path}/${encodeURIComponent(id)}`, crmFetchInit());
  if (!res.ok) throw await readError(res, '정보를 불러오지 못했습니다.');
  return res.json();
}

export async function createErpRecord(path, body) {
  const res = await fetch(
    `${ERP_BASE}/${path}`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  if (!res.ok) throw await readError(res, '등록에 실패했습니다.');
  return res.json();
}

/** 낙관적 잠금 — body.version 을 반드시 함께 보냅니다 */
export async function updateErpRecord(path, id, body) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}`,
    crmFetchInit({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  if (!res.ok) throw await readError(res, '수정에 실패했습니다.');
  return res.json();
}

export async function deleteErpRecord(path, id) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}`,
    crmFetchInit({ method: 'DELETE' })
  );
  if (!res.ok && res.status !== 204) throw await readError(res, '삭제에 실패했습니다.');
  return true;
}

export async function fetchErpHistory(path, id, params = {}) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}/history${buildQuery(params)}`,
    crmFetchInit()
  );
  if (!res.ok) throw await readError(res, '변경 이력을 불러오지 못했습니다.');
  return res.json();
}

/** 화면 표시용 권한 — 최종 판단은 서버가 합니다 */
export async function fetchErpPermissions() {
  const res = await fetch(`${ERP_BASE}/permissions`, crmFetchInit());
  if (!res.ok) throw await readError(res, '권한 정보를 불러오지 못했습니다.');
  return res.json();
}

export async function fetchErpSyncStatus(path) {
  const res = await fetch(`${ERP_BASE}/${path}/sync-status`, crmFetchInit());
  if (!res.ok) throw await readError(res, '동기화 상태를 불러오지 못했습니다.');
  return res.json();
}

export async function runErpSync(path, body = {}) {
  const res = await fetch(
    `${ERP_BASE}/${path}/sync-from-crm`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  if (!res.ok) throw await readError(res, '가져오기에 실패했습니다.');
  return res.json();
}

/** 사업자번호 표시 — 저장은 숫자만, 화면은 000-00-00000 */
export function formatBusinessNumberDisplay(value) {
  const digits = String(value == null ? '' : value).replace(/[^0-9]/g, '');
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * 금액 표시 — 서버는 Decimal128을 문자열로 내려주므로 Number 변환 없이 정수부만 구분자를 넣습니다.
 * (큰 금액에서 부동소수점 오차가 생기지 않게)
 */
export function formatMoneyDisplay(value, currency = '') {
  if (value == null || value === '') return '-';
  const raw = String(value).trim();
  if (!/^[+-]?\d*(\.\d+)?$/.test(raw)) return raw;

  const negative = raw.startsWith('-');
  const unsigned = raw.replace(/^[+-]/, '');
  const [intPart, fracPart] = unsigned.split('.');
  const grouped = (intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmedFrac = fracPart ? fracPart.replace(/0+$/, '') : '';
  const body = `${negative ? '-' : ''}${grouped}${trimmedFrac ? `.${trimmedFrac}` : ''}`;
  return currency ? `${body} ${currency}` : body;
}
