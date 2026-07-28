/**
 * ERP 구매 API — 판매 API와 동일 규약 (쿠키 세션, 금액 문자열 유지, 멱등키).
 */
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { newIdempotencyKey, formatMoneyDisplay } from '@/lib/erp-sales-api';

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

export async function fetchPurchaseList(path, params = {}) {
  const res = await fetch(`${ERP_BASE}/${path}${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '목록을 불러오지 못했습니다.');
}

export async function fetchPurchaseDocument(path, id) {
  const res = await fetch(`${ERP_BASE}/${path}/${encodeURIComponent(id)}`, crmFetchInit());
  return readJson(res, '문서를 불러오지 못했습니다.');
}

export async function createPurchaseDocument(path, body) {
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

export async function updatePurchaseDocument(path, id, body) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}`,
    crmFetchInit({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '수정에 실패했습니다.');
}

export async function postPurchaseCommand(path, id, command, body = {}, key = newIdempotencyKey()) {
  const res = await fetch(
    `${ERP_BASE}/${path}/${encodeURIComponent(id)}/${command}`,
    crmFetchInit({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '처리에 실패했습니다.');
}

export async function createChildFromPo(orderId, child, body, key = newIdempotencyKey()) {
  const path = child === 'receipt' ? 'goods-receipts' : 'invoices';
  const res = await fetch(
    `${ERP_BASE}/purchase-orders/${encodeURIComponent(orderId)}/${path}`,
    crmFetchInit({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '하위 문서 생성에 실패했습니다.');
}

export async function fetchPoRemaining(orderId) {
  const res = await fetch(
    `${ERP_BASE}/purchase-orders/${encodeURIComponent(orderId)}/remaining`,
    crmFetchInit()
  );
  return readJson(res, '잔량을 불러오지 못했습니다.');
}

export { newIdempotencyKey, formatMoneyDisplay };
