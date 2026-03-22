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

export default function Subscription() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
        }
      } catch (e) {
        if (!cancelled) setError(e.message || '오류가 발생했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** 토스 리다이렉트 후 빌링키 발급 + 첫 결제 */
  useEffect(() => {
    const billing = searchParams.get('billing');
    const authKey = searchParams.get('authKey');
    const customerKey = searchParams.get('customerKey');
    const failCode = searchParams.get('code');
    const failMessage = searchParams.get('message');

    if (billing === '0') {
      setActionMsg(failMessage || failCode || '카드 인증이 취소되었거나 실패했습니다.');
      setSearchParams({}, { replace: true });
      return;
    }

    if (billing !== '1' || !authKey || !customerKey) return;
    const dedupeKey = `sub_billing_done_${authKey}`;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(dedupeKey)) return;
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(dedupeKey, '1');

    let cancelled = false;
    (async () => {
      setConfirming(true);
      setError('');
      try {
        const res = await fetch(`${API_BASE}/subscription/confirm-billing`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ authKey, customerKey })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || '빌링 등록에 실패했습니다.');
        if (!cancelled) {
          setActionMsg(`첫 월 구독 결제가 완료되었습니다. (결제키: ${json.subscription?.paymentKey || '—'})`);
          await refresh();
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || '처리에 실패했습니다.');
          try {
            sessionStorage.removeItem(dedupeKey);
          } catch (_) {}
        }
      } finally {
        if (!cancelled) {
          setConfirming(false);
          setSearchParams({}, { replace: true });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, refresh]);

  const handleRequestBillingAuth = async () => {
    if (!config?.clientKey || !config?.customerKey) return;
    setBillingLoading(true);
    setError('');
    try {
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

  if (loading) {
    return (
      <div className="page subscription-page">
        <header className="page-header">
          <h1 className="page-title">구독 관리</h1>
        </header>
        <div className="page-content">
          <p className="subscription-loading">불러오는 중...</p>
        </div>
      </div>
    );
  }

  const hasActive = status?.hasSubscription && status?.status === 'active';

  return (
    <div className="page subscription-page">
      <header className="page-header">
        <h1 className="page-title">구독 관리</h1>
      </header>
      <div className="page-content">
        {error && <div className="subscription-error" role="alert">{error}</div>}
        {confirming && <p className="subscription-loading">카드 등록 결과를 처리하는 중...</p>}
        {actionMsg && !error && <div className="subscription-note">{actionMsg}</div>}

        <section className="subscription-hero">
          <h2>Nexvia CRM 월 구독</h2>
          <p>
            토스페이먼츠 자동결제(빌링)로 카드를 한 번 등록하면 매월 같은 금액이 청구됩니다.
            개발·테스트 단계에서는 월 <strong>1,000원</strong>으로 설정되어 있습니다.
          </p>
          <div className="subscription-price">
            <strong>{config?.planAmount ?? 1000}</strong>
            <span>원 / 월 (부가세 포함 방식은 토스·상점 설정에 따름)</span>
          </div>
        </section>

        <section className="subscription-card">
          <h3>현재 상태</h3>
          <dl className="subscription-dl">
            <dt>구독</dt>
            <dd>{hasActive ? '이용 중' : '미등록'}</dd>
            <dt>다음 결제 예정</dt>
            <dd>{formatDate(status?.nextBillingAt)}</dd>
            <dt>마지막 결제</dt>
            <dd>{formatDate(status?.lastBillingAt)}</dd>
            <dt>등록 카드</dt>
            <dd>
              {status?.cardCompany && status?.cardNumberMasked
                ? `${status.cardCompany} ${status.cardNumberMasked}`
                : '—'}
            </dd>
          </dl>

          <div className="subscription-actions">
            {!hasActive && (
              <button
                type="button"
                className="subscription-btn subscription-btn-primary"
                onClick={handleRequestBillingAuth}
                disabled={billingLoading || confirming || !config?.clientKey}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '1.15rem' }}>credit_card</span>
                {billingLoading ? '결제창 여는 중...' : '카드 등록 및 첫 달 결제 (1,000원)'}
              </button>
            )}
            {hasActive && (
              <button
                type="button"
                className="subscription-btn subscription-btn-secondary"
                onClick={handleDevCharge}
                disabled={billingLoading || confirming}
              >
                개발용: 지금 즉시 한 번 더 결제
              </button>
            )}
          </div>

          <p className="subscription-note">
            테스트 키(TOSS_CLIENT_KEY / TOSS_SECRET_KEY)를 사용하면 실제 출금 없이 시뮬레이션됩니다.
            자동결제(빌링) 계약이 없는 키로 연동하면 토스에서 NOT_SUPPORTED_METHOD가 날 수 있습니다.
            서버가 잠들면(Railway 등) 정기 결제는 매시간 깨어난 뒤 처리되며, 운영 시 외부 크론으로
            <code style={{ margin: '0 0.25rem' }}>POST /api/subscription/cron/process-due</code>
            호출을 권장합니다.
          </p>
        </section>
      </div>
    </div>
  );
}
