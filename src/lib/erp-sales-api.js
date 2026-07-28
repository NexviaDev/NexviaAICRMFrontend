/**
 * ERP 판매·수금(2단계) API 클라이언트.
 *
 * 규약 (erp-master-api.js 와 동일):
 *  - 모든 요청은 HttpOnly 쿠키 세션(crmFetchInit)을 사용합니다.
 *  - 서버 오류 메시지를 가공하지 않고 그대로 노출합니다. code/latest 는 409 처리용으로 함께 담습니다.
 *  - 금액은 서버가 Decimal128을 문자열로 내려줍니다. Number 변환 없이 표시 포맷만 합니다.
 */
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { formatMoneyDisplay } from '@/lib/erp-master-api';

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

async function readJson(res, fallback) {
  if (!res.ok) throw await readError(res, fallback);
  if (res.status === 204) return null;
  return res.json();
}

/**
 * 명령 1회에 대한 멱등키.
 * 같은 사용자 동작(버튼 한 번 클릭)에 대해서는 재시도해도 같은 키를 다시 보내야
 * Railway 콜드 스타트 재시도가 중복 문서를 만들지 않습니다.
 */
export function newIdempotencyKey() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rand = () => Math.random().toString(16).slice(2, 10);
  return `erp-${Date.now().toString(16)}-${rand()}-${rand()}`;
}

/* ---------------- 문서 CRUD ---------------- */

/** 문서 목록 — 서버 페이지네이션 (`{ items, pagination }`) */
export async function fetchSalesList(path, params = {}) {
  const res = await fetch(`${ERP_BASE}/${path}${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '목록을 불러오지 못했습니다.');
}

/** 단건 조회 — URL 파라미터로 연 모달이 새로고침돼도 목록 없이 표시되도록 */
export async function fetchSalesDocument(path, id) {
  const res = await fetch(`${ERP_BASE}/${path}/${encodeURIComponent(id)}`, crmFetchInit());
  return readJson(res, '문서를 불러오지 못했습니다.');
}

export async function createSalesDocument(path, body) {
  const res = await fetch(
    `${ERP_BASE}/${path}`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '등록에 실패했습니다.');
}

/** 낙관적 잠금 — body.version 을 반드시 함께 보냅니다 (409 VERSION_CONFLICT) */
export async function updateSalesDocument(path, id, body) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}`,
    crmFetchInit({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '저장에 실패했습니다.');
}

/** 초안 삭제 — 확정 문서는 취소 명령으로만 무효화합니다 */
export async function deleteSalesDocument(path, id) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}`,
    crmFetchInit({ method: 'DELETE' })
  );
  if (!res.ok && res.status !== 204) throw await readError(res, '삭제에 실패했습니다.');
  return true;
}

export async function fetchSalesHistory(path, id, params = {}) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}/history${buildQuery(params)}`,
    crmFetchInit()
  );
  return readJson(res, '변경 이력을 불러오지 못했습니다.');
}

/* ---------------- 상태 명령 ---------------- */

/**
 * 문서 명령 (submit/approve/confirm/issue/cancel/revise/convert-to-order/shipments/invoices…).
 * 문서를 새로 만드는 명령은 idempotencyKey 가 필수입니다.
 */
export async function runSalesCommand(path, id, command, body = {}, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}/${command}`,
    crmFetchInit({ method: 'POST', headers, body: JSON.stringify(body) })
  );
  return readJson(res, '요청을 처리하지 못했습니다.');
}

/** CRM 영업기회 → 견적 초안 (Idempotency-Key 필수) */
export async function createQuotationFromOpportunity(opportunityId, body = {}, idempotencyKey) {
  const res = await fetch(
    `${ERP_BASE}/quotations/from-opportunity/${encodeURIComponent(opportunityId)}`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '영업기회에서 견적을 만들지 못했습니다.');
}

/* ---------------- 문서별 부가 조회 ---------------- */

/** 판매주문 라인별 출고·매출 잔량 */
export async function fetchSalesOrderRemaining(id) {
  const res = await fetch(
    `${ERP_BASE}/sales-orders/${encodeURIComponent(id)}/remaining`,
    crmFetchInit()
  );
  return readJson(res, '잔량 정보를 불러오지 못했습니다.');
}

/** 매출에 배부된 수금·대변 내역 */
export async function fetchInvoiceSettlements(id) {
  const res = await fetch(
    `${ERP_BASE}/sales-invoices/${encodeURIComponent(id)}/settlements`,
    crmFetchInit()
  );
  return readJson(res, '정산 내역을 불러오지 못했습니다.');
}

/** 수금 배부 후보 — 거래처의 미수 매출 */
export async function fetchOpenInvoices(params = {}) {
  const res = await fetch(`${ERP_BASE}/receipts/open-invoices${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '미수 매출을 불러오지 못했습니다.');
}

/* ---------------- 분석 ---------------- */

export async function fetchArAging(params = {}) {
  const res = await fetch(`${ERP_BASE}/sales/ar-aging${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '채권 연령을 불러오지 못했습니다.');
}

export async function fetchSalesTrace(params = {}) {
  const res = await fetch(`${ERP_BASE}/sales/trace${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '추적 정보를 불러오지 못했습니다.');
}

/* ---------------- 선택기 ---------------- */

/** 거래처·품목·세금구분·결제조건·창고 선택 목록 (사용 중인 항목만) */
export async function fetchSalesPicker(path, params = {}) {
  const res = await fetch(
    `${ERP_BASE}/${path}${buildQuery({ picker: '1', status: 'active', ...params })}`,
    crmFetchInit()
  );
  const data = await readJson(res, '선택 목록을 불러오지 못했습니다.');
  return Array.isArray(data?.items) ? data.items : [];
}

/* ---------------- 표시 포맷 ---------------- */

export { formatMoneyDisplay };

/** yyyy-mm-dd — 날짜 input 값 (로컬 기준) */
export function toDateInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateDisplay(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatDateTimeDisplay(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * 라인 편집기의 참고용 예상 금액.
 * 서버가 다시 계산한 값이 진실이므로 화면 안내용으로만 씁니다.
 */
export function estimateLineAmount(quantity, unitPrice, discountRatePercent, discountAmount) {
  const qty = Number(String(quantity || '').replace(/,/g, ''));
  const price = Number(String(unitPrice || '').replace(/,/g, ''));
  const rate = Number(discountRatePercent || 0);
  const fixed = Number(String(discountAmount || '').replace(/,/g, '')) || 0;
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return null;
  const gross = qty * price;
  if (!Number.isFinite(gross)) return null;
  const discount = (gross * (Number.isFinite(rate) ? rate : 0)) / 100 + fixed;
  const net = gross - discount;
  return Number.isFinite(net) ? Math.round(net) : null;
}
