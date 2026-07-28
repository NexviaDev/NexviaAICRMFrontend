/**
 * ERP 회계 API
 */
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import { newIdempotencyKey } from '@/lib/erp-sales-api';

const BASE = `${API_BASE}/erp/accounting`;

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function readJson(res, fallback) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(data.error || fallback);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export async function fetchAccounts(params = {}) {
  const res = await fetch(`${BASE}/accounts${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '계정과목을 불러오지 못했습니다.');
}

export async function seedAccounts() {
  const res = await fetch(`${BASE}/accounts/seed`, crmFetchInit({ method: 'POST' }));
  return readJson(res, '기본 계정 생성에 실패했습니다.');
}

export async function fetchPeriods(params = {}) {
  const res = await fetch(`${BASE}/periods${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '회계기간을 불러오지 못했습니다.');
}

export async function createPeriod(body) {
  const res = await fetch(
    `${BASE}/periods`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '회계기간 등록에 실패했습니다.');
}

export async function closePeriod(id, key = newIdempotencyKey()) {
  const res = await fetch(
    `${BASE}/periods/${encodeURIComponent(id)}/close`,
    crmFetchInit({
      method: 'POST',
      headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
      body: '{}'
    })
  );
  return readJson(res, '마감에 실패했습니다.');
}

export async function fetchJournals(params = {}) {
  const res = await fetch(`${BASE}/journals${buildQuery(params)}`, crmFetchInit());
  return readJson(res, '전표를 불러오지 못했습니다.');
}

export async function postJournal(body, key = newIdempotencyKey()) {
  const res = await fetch(
    `${BASE}/journals`,
    crmFetchInit({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': key
      },
      body: JSON.stringify(body)
    })
  );
  return readJson(res, '전표 전기에 실패했습니다.');
}

export { newIdempotencyKey };
