import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import './subscription.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function loadTossScript() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.TossPayments) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[data-toss-sdk="v2"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.tosspayments.com/v2/standard';
    s.async = true;
    s.dataset.tossSdk = 'v2';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('토스 SDK를 불러오지 못했습니다.'));
    document.body.appendChild(s);
  });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatRenewalShort(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  } catch {
    return '—';
  }
}

const MIN_SEATS = 3;

function clampSeat(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < MIN_SEATS) return MIN_SEATS;
  return Math.min(x, 500);
}

/** 서버 subscriptionPricing.js 와 동일한 월 요금(원) */
function monthlyKrwForSeats(seatCount) {
  const s = clampSeat(seatCount);
  if (s <= 3) return 240000;
  return 240000 + (s - 3) * 40000;
}

function seatBreakdown(seatCount) {
  const s = clampSeat(seatCount);
  const extra = Math.max(0, s - 3);
  return {
    baseKrw: 240000,
    extraSeats: extra,
    additionalKrw: extra * 40000,
    totalKrw: monthlyKrwForSeats(s)
  };
}

const PENDING_SEAT_KEY = 'sub_pending_seat_count';

export default function Subscription() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [seatsInput, setSeatsInput] = useState(MIN_SEATS);
  const [seatApplyLoading, setSeatApplyLoading] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`${API_BASE}/subscription/status`, { headers: { ...getAuthHeader(), 'Content-Type': 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '상태를 불러오지 못했습니다.');
    setStatus(json);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [cfgRes, stRes] = await Promise.all([
          fetch(`${API_BASE}/subscription/config`, { headers: getAuthHeader() }),
          fetch(`${API_BASE}/subscription/status`, { headers: getAuthHeader() })
        ]);
        const cfgJson = await cfgRes.json().catch(() => ({}));
        const stJson = await stRes.json().catch(() => ({}));
        if (!cfgRes.ok) throw new Error(cfgJson.error || '구독 설정을 불러오지 못했습니다.');
        if (!stRes.ok) throw new Error(stJson.error || '상태를 불러오지 못했습니다.');
        if (!cancelled) {
          setConfig(cfgJson);
          setStatus(stJson);
          const s = stJson?.seatCount ?? cfgJson?.seatCount ?? MIN_SEATS;
          setSeatsInput(clampSeat(s));
        }
      } catch (e) {
        if (!cancelled) setError(e.message || '오류가 발생했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const billing = searchParams.get('billing');
    const authKey = searchParams.get('authKey');
    const customerKey = searchParams.get('customerKey');
    const failMessage = searchParams.get('message');

    if (billing === '0') {
      setActionMsg(failMessage || searchParams.get('code') || '카드 인증이 취소되었거나 실패했습니다.');
      setSearchParams({}, { replace: true });
      return;
    }

    if (billing !== '1' || !authKey || !customerKey) return;

    const dedupeKey = `sub_billing_done_${authKey}`;
    /** 이미 이 authKey로 서버 처리까지 끝난 경우 — URL만 정리하고 상태만 동기화 */
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(dedupeKey)) {
      setConfirming(false);
      setSearchParams({}, { replace: true });
      refresh().catch(() => {});
      return;
    }

    let cancelled = false;
    (async () => {
      setConfirming(true);
      setError('');
      try {
        let seatCount = MIN_SEATS;
        try {
          const raw = sessionStorage.getItem(PENDING_SEAT_KEY);
          if (raw) seatCount = clampSeat(parseInt(raw, 10));
        } catch (_) {}
        const res = await fetch(`${API_BASE}/subscription/confirm-billing`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ authKey, customerKey, seatCount })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || '빌링 등록에 실패했습니다.');
        try {
          if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(dedupeKey, '1');
        } catch (_) {}
        try {
          sessionStorage.removeItem(PENDING_SEAT_KEY);
        } catch (_) {}
        setActionMsg(`첫 구독 결제가 완료되었습니다. (이용 ${seatCount}명, 결제키: ${json.subscription?.paymentKey || '—'})`);
        await refresh();
      } catch (e) {
        if (!cancelled) {
          setError(e.message || '처리에 실패했습니다.');
        }
      } finally {
        /** Strict Mode 등으로 effect가 두 번 돌아도 UI가 '처리 중'에 고이지 않도록 항상 해제 */
        setConfirming(false);
        if (!cancelled) {
          setSearchParams({}, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, refresh]);

  const handleRequestBillingAuth = async () => {
    if (!config?.clientKey || !config?.customerKey) return;
    const seats = clampSeat(seatsInput);
    setBillingLoading(true);
    setError('');
    try {
      try {
        sessionStorage.setItem(PENDING_SEAT_KEY, String(seats));
      } catch (_) {}
      await loadTossScript();
      const TossPayments = window.TossPayments;
      if (!TossPayments) throw new Error('토스 결제 SDK를 찾을 수 없습니다.');
      const tossPayments = TossPayments(config.clientKey);
      const payment = tossPayments.payment({ customerKey: config.customerKey });
      const userRaw = localStorage.getItem('crm_user');
      let email = '';
      let name = '';
      try {
        const u = userRaw ? JSON.parse(userRaw) : {};
        email = u.email || '';
        name = u.name || '';
      } catch (_) {}
      await payment.requestBillingAuth({
        method: 'CARD',
        successUrl: config.successUrl,
        failUrl: config.failUrl,
        customerEmail: email || 'customer@example.com',
        customerName: name || '고객'
      });
    } catch (e) {
      try {
        sessionStorage.removeItem(PENDING_SEAT_KEY);
      } catch (_) {}
      if (e?.code === 'USER_CANCEL' || e?.message?.includes('취소')) {
        setActionMsg('결제창이 닫혔습니다.');
      } else {
        setError(e.message || '결제창을 열 수 없습니다.');
      }
    } finally {
      setBillingLoading(false);
    }
  };

  const handleDevCharge = async () => {
    setBillingLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/subscription/dev-charge-now`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' }
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '결제에 실패했습니다.');
      setActionMsg(`테스트 결제가 완료되었습니다. 다음 결제 예정: ${formatDate(json.nextBillingAt)}`);
      await refresh();
    } catch (e) {
      setError(e.message || '결제에 실패했습니다.');
    } finally {
      setBillingLoading(false);
    }
  };

  const handleApplySeats = async () => {
    const target = clampSeat(seatsInput);
    const hasActive = status?.hasSubscription && status?.status === 'active';
    if (!hasActive) {
      setError('먼저 구독을 등록해 주세요.');
      return;
    }
    const current = clampSeat(status?.seatCount ?? MIN_SEATS);
    if (target === current) {
      setActionMsg('변경할 인원이 없습니다.');
      return;
    }

    if (target < current) {
      const ok = window.confirm(
        `인원을 ${current}명 → ${target}명으로 줄입니다.\n\n` +
          `다음 정기 결제일부터는 ${target}명 기준으로 월 요금이 청구됩니다.\n` +
          `이전에 인원을 늘릴 때 이미 낸 비례(일회) 금액은 환불되지 않습니다.\n\n` +
          '진행할까요?'
      );
      if (!ok) return;
    }

    setSeatApplyLoading(true);
    setError('');
    try {
      if (target > current) {
        const prev = await fetch(
          `${API_BASE}/subscription/seat-change-preview?seatCount=${encodeURIComponent(target)}`,
          { headers: getAuthHeader() }
        );
        const pv = await prev.json().catch(() => ({}));
        if (!prev.ok) throw new Error(pv.error || '미리보기에 실패했습니다.');
        const add = pv.additionalChargeKrw ?? 0;
        if (add > 0) {
          const ok = window.confirm(
            `인원을 ${current}명 → ${target}명으로 늘립니다.\n추가 결제(비례): ${add.toLocaleString('ko-KR')}원\n구간: ${pv.tierLabel || '—'}\n정기 결제 예정일은 바뀌지 않습니다. 진행할까요?`
          );
          if (!ok) {
            setSeatApplyLoading(false);
            return;
          }
        }
      }

      const res = await fetch(`${API_BASE}/subscription/seats`, {
        method: 'PUT',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatCount: target })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || '인원 변경에 실패했습니다.');
      setActionMsg(json.message || '이용 인원이 반영되었습니다.');
      await refresh();
    } catch (e) {
      setError(e.message || '인원 변경에 실패했습니다.');
    } finally {
      setSeatApplyLoading(false);
    }
  };

  const handleCancelChanges = () => {
    const active = status?.hasSubscription && status?.status === 'active';
    if (active) {
      setSeatsInput(clampSeat(status?.seatCount ?? MIN_SEATS));
      setActionMsg('입력을 등록 인원 기준으로 되돌렸습니다.');
    } else {
      setSeatsInput(MIN_SEATS);
      setActionMsg('인원 입력을 초기화했습니다.');
    }
  };

  const bumpSeat = (delta) => {
    setSeatsInput((prev) => clampSeat(prev + delta));
  };

  if (loading) {
    return (
      <div className="page subscription-page">
        <div className="page-content">
          <p className="subscription-loading">불러오는 중...</p>
        </div>
      </div>
    );
  }

  const hasActive = status?.hasSubscription && status?.status === 'active';
  const previewMonthly = monthlyKrwForSeats(seatsInput);
  const breakdown = seatBreakdown(seatsInput);
  const autoOn = config?.autoBillingEnabled === true || status?.autoBillingEnabled === true;
  const currentSeats = clampSeat(status?.seatCount ?? MIN_SEATS);
  const seatsDirty = hasActive && clampSeat(seatsInput) !== currentSeats;
  const nextRenewalPhrase = status?.nextBillingAt
    ? `월간 (다음 갱신 ${formatRenewalShort(status.nextBillingAt)})`
    : '월간';

  const primarySidebarDisabled = hasActive
    ? (seatApplyLoading || billingLoading || confirming || !seatsDirty)
    : (billingLoading || confirming || !config?.clientKey);

  const invRef = status?.lastOrderId || status?.lastPaymentKey || '';
  const invShort = invRef ? String(invRef).slice(-10).toUpperCase() : '—';

  return (
    <div className="page subscription-page">
      <div className="page-content">
        {error && <div className="subscription-error" role="alert">{error}</div>}
        {confirming && <p className="subscription-loading">카드 등록 결과를 처리하는 중...</p>}
        {actionMsg && !error && <div className="subscription-toast-note">{actionMsg}</div>}

        <nav className="subscription-breadcrumb" aria-label="위치">
          <span>워크스페이스</span>
          <span className="material-symbols-outlined">chevron_right</span>
          <span className="current">구독</span>
        </nav>

        <header className="subscription-title-block">
          <h1 className="subscription-headline">구독 및 인원</h1>
        </header>

        <div className="subscription-layout">
          <div className="subscription-main">
            <section className="subscription-status-card" aria-labelledby="sub-status-title">
              <div className="subscription-status-head">
                <div>
                  <h2 id="sub-status-title">{hasActive ? '이용 중인 구독' : '구독 상태'}</h2>
                  <p className="sub">
                    {hasActive ? (
                      <>
                        귀사는 현재 <span className="tier">Nexvia CRM 표준 플랜</span>을 사용 중입니다.
                      </>
                    ) : (
                      '카드를 등록하고 인원을 선택하면 첫 결제로 구독이 시작됩니다.'
                    )}
                  </p>
                </div>
                <span
                  className={`subscription-badge ${hasActive ? 'subscription-badge--active' : 'subscription-badge--inactive'}`}
                >
                  {hasActive ? (
                    <>
                      <span className="material-symbols-outlined" style={{ fontSize: '0.95rem', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      Active
                    </>
                  ) : (
                    '미등록'
                  )}
                </span>
              </div>
              <div className="subscription-status-grid">
                <div>
                  <p className="subscription-stat-label">청구 주기</p>
                  <p className="subscription-stat-value">{hasActive ? nextRenewalPhrase : '—'}</p>
                </div>
                <div>
                  <p className="subscription-stat-label">다음 정기 결제 금액</p>
                  <p className="subscription-stat-value">
                    {hasActive && status?.planAmount != null
                      ? `${Number(status.planAmount).toLocaleString('ko-KR')}원`
                      : `${previewMonthly.toLocaleString('ko-KR')}원`}
                  </p>
                </div>
                <div>
                  <p className="subscription-stat-label">등록 인원</p>
                  <p className="subscription-stat-value">
                    {hasActive ? `${currentSeats}명` : '—'}
                  </p>
                </div>
              </div>
            </section>

            <section className="subscription-seat-card" aria-labelledby="seat-widget-title">
              <div className="subscription-seat-card-header">
                <div>
                  <h3 id="seat-widget-title">인원 조정</h3>
                  <p className="sub">팀 규모에 맞게 조정하세요. 월 요금은 아래에 즉시 반영됩니다.</p>
                </div>
                <div className="subscription-stepper">
                  <button
                    type="button"
                    aria-label="인원 한 명 줄이기"
                    onClick={() => bumpSeat(-1)}
                    disabled={clampSeat(seatsInput) <= MIN_SEATS}
                  >
                    <span className="material-symbols-outlined">remove</span>
                  </button>
                  <input
                    type="number"
                    min={MIN_SEATS}
                    max={500}
                    value={seatsInput}
                    onChange={(e) => setSeatsInput(clampSeat(e.target.value))}
                    aria-label="이용 인원"
                  />
                  <button
                    type="button"
                    aria-label="인원 한 명 늘리기"
                    onClick={() => bumpSeat(1)}
                    disabled={clampSeat(seatsInput) >= 500}
                  >
                    <span className="material-symbols-outlined">add</span>
                  </button>
                </div>
              </div>

              <div className="subscription-cost-grid">
                <div className="subscription-rules-box">
                  <p className="label">요금 구성</p>
                  <ul className="subscription-rules-list">
                    <li>
                      <span>기본 (1~3명)</span>
                      <span>{breakdown.baseKrw.toLocaleString('ko-KR')}원</span>
                    </li>
                    <li>
                      <span>
                        {breakdown.extraSeats > 0
                          ? `추가 (+${breakdown.extraSeats}명)`
                          : '추가 인원'}
                      </span>
                      <span>
                        {breakdown.additionalKrw > 0
                          ? `+${breakdown.additionalKrw.toLocaleString('ko-KR')}원`
                          : '0원'}
                      </span>
                    </li>
                    <li className="total-row">
                      <span>월 합계 (정기)</span>
                      <span>{breakdown.totalKrw.toLocaleString('ko-KR')}원</span>
                    </li>
                  </ul>
                </div>
                <div className="subscription-estimate-box">
                  <p className="label">예상 월 합계</p>
                  <p className="amount">
                    {previewMonthly.toLocaleString('ko-KR')}
                    <span className="unit">원</span>
                  </p>
                  <p className="hint">인원 추가 시 비례 요금은 별도 청구됩니다.</p>
                </div>
              </div>

              <div className="subscription-policy-banner">
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>info</span>
                <div>
                  <p className="banner-title">정책 안내</p>
                  <p>
                    인원 추가만으로 정기 결제 주기는 바뀌지 않습니다.
                    {hasActive && status?.nextBillingAt
                      ? ` 다음 갱신 예정일은 ${formatRenewalShort(status.nextBillingAt)} 입니다.`
                      : ' 구독 시작 후 다음 갱신일이 표시됩니다.'}
                  </p>
                  <p className="subscription-policy-banner-second">
                    인원을 줄이면 <strong>다음 정기 결제일부터</strong> 줄인 인원 기준으로 월 요금이 청구됩니다(예: 10명→5명이면 이후 정기일부터 5명 요금).
                    그동안 인원을 늘릴 때 발생한 비례(일회) 결제 금액은 <strong>환불되지 않습니다</strong>.
                  </p>
                </div>
              </div>
            </section>

            <section className="subscription-prorate-section" aria-labelledby="prorate-heading">
              <h3 id="prorate-heading">비례 요금표 (월 중 인원 추가)</h3>
              <div className="subscription-prorate-table-wrap">
                <table className="subscription-prorate-table">
                  <caption>마지막 정기 결제 이후 경과 기간별 인당 일회 요금</caption>
                  <thead>
                    <tr>
                      <th scope="col">남은 기간(정기 결제 기준)</th>
                      <th scope="col">인당 요금</th>
                      <th scope="col">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>7일 이내</td>
                      <td>40,000원</td>
                      <td className="muted">마지막 정기 결제 직후 구간</td>
                    </tr>
                    <tr>
                      <td>7일 초과 ~ 14일 이하</td>
                      <td>30,000원</td>
                      <td className="muted">중간 구간</td>
                    </tr>
                    <tr>
                      <td>14일 초과 ~ 21일 이하</td>
                      <td>20,000원</td>
                      <td className="muted">중간 구간</td>
                    </tr>
                    <tr>
                      <td>21일 초과</td>
                      <td>10,000원</td>
                      <td className="muted">갱신 직전 구간</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="subscription-sidebar">
            <div className="subscription-finalize-card">
              <h3>변경 확정</h3>
              <p className="sub">
                {hasActive
                  ? '인원을 조정한 뒤 저장하면 반영됩니다. 증원 시 비례 금액이 즉시 결제되고, 감소 시에는 다음 정기일부터 요금만 조정되며 과거 비례 결제는 환불되지 않습니다.'
                  : '인원을 선택한 뒤 카드 등록으로 첫 결제를 진행하세요.'}
              </p>
              <div className="subscription-finalize-actions">
                {hasActive ? (
                  <>
                    <button
                      type="button"
                      className="subscription-btn-primary-lg"
                      onClick={handleApplySeats}
                      disabled={primarySidebarDisabled}
                    >
                      <span className="material-symbols-outlined">payments</span>
                      {seatApplyLoading ? '처리 중...' : '저장 및 결제'}
                    </button>
                    <button
                      type="button"
                      className="subscription-btn-outline"
                      onClick={handleCancelChanges}
                      disabled={seatApplyLoading || billingLoading || confirming}
                    >
                      변경 취소
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="subscription-btn-primary-lg"
                      onClick={handleRequestBillingAuth}
                      disabled={primarySidebarDisabled}
                    >
                      <span className="material-symbols-outlined">credit_card</span>
                      {billingLoading ? '결제창 여는 중...' : '카드 등록 및 첫 결제'}
                    </button>
                    <button
                      type="button"
                      className="subscription-btn-outline"
                      onClick={handleCancelChanges}
                      disabled={billingLoading || confirming}
                    >
                      입력 초기화
                    </button>
                  </>
                )}
              </div>
              <div className="subscription-mail-note">
                <span className="material-symbols-outlined">mail</span>
                <p>결제가 완료되면 등록 이메일로 안내 메일이 발송됩니다 (Nodemailer·Gmail 등 서버 설정 시).</p>
              </div>
            </div>

            <div className="subscription-history-section">
              <h3>결제 내역</h3>
              {hasActive && status?.lastBillingAt ? (
                <div className="subscription-history-item">
                  <div className="row-top">
                    <span className="inv">{invShort !== '—' ? `REF-${invShort}` : '최근 결제'}</span>
                    <span className="paid">완료</span>
                  </div>
                  <div className="row-bottom">
                    <div>
                      <p className="date">{formatDate(status.lastBillingAt)}</p>
                      <p className="desc">{currentSeats}명 기준 월 구독</p>
                    </div>
                    <p className="amt">
                      {status?.planAmount != null
                        ? `${Number(status.planAmount).toLocaleString('ko-KR')}원`
                        : '—'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="subscription-history-empty">아직 표시할 결제 내역이 없습니다.</p>
              )}
            </div>

            {hasActive && (
              <div className="subscription-dev-row">
                <button
                  type="button"
                  className="subscription-btn-ghost"
                  onClick={handleDevCharge}
                  disabled={billingLoading || confirming}
                >
                  개발용: 즉시 월 정기 금액 테스트 결제
                </button>
              </div>
            )}
          </aside>
        </div>

        <p className="subscription-footnote">
          테스트 키(TOSS_CLIENT_KEY / TOSS_SECRET_KEY) 사용 시 실제 출금 없이 시뮬레이션될 수 있습니다.
          정기 자동결제는 <code>SUBSCRIPTION_AUTO_BILLING_ENABLED=true</code> 일 때만 서버 스케줄·크론으로 청구됩니다.
          현재: {autoOn ? '자동결제 설정됨' : '보류(수동·크론만)'}.
        </p>
      </div>
    </div>
  );
}
