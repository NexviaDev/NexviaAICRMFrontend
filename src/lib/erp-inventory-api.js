/**
 * ERP 재고 API 클라이언트.
 * 금액·수량 문자열은 Number 로 바꾸지 않습니다.
 */
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { newIdempotencyKey } from '@/lib/erp-sales-api';

const ERP_BASE = `${API_BASE}/erp/inventory`;

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
  return error;
}

async function readJson(res, fallback) {
  if (!res.ok) throw await readError(res, fallback);
  return res.json();
}

export async function fetchInventoryBalances(params = {}) {
  const res = await fetch(`${ERP_BASE}/balances${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '재고 현황을 불러오지 못했습니다.');
}

export async function fetchInventoryBalance(id) {
  const res = await fetch(`${ERP_BASE}/balances/${encodeURIComponent(id)}`, crmFetchInit());
  return readJson(res, '재고 잔량을 불러오지 못했습니다.');
}

export async function fetchInventoryMovements(params = {}) {
  const res = await fetch(`${ERP_BASE}/movements${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '수불 내역을 불러오지 못했습니다.');
}

export async function fetchInventoryMovement(id) {
  const res = await fetch(`${ERP_BASE}/movements/${encodeURIComponent(id)}`, crmFetchInit());
  return readJson(res, '수불 내역을 불러오지 못했습니다.');
}

/** 수동 조정 — Idempotency-Key 필수 */
export async function postInventoryAdjust(body, idempotencyKey = newIdempotencyKey()) {
  const res = await fetch(
    `${ERP_BASE}/adjust`,
    crmFetchInit({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '재고 조정에 실패했습니다.');
}

export { newIdempotencyKey };
