import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import FindIdModal from './find-id-modal';
import './login.css';

/** Login.html — minimalist workspace header (same asset as sample design) */
const LOGIN_HEADER_IMAGE =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCLAPf7mgJCRxfncK1ByeOSnIUgTscHJJ_Z1Y5pAV7m0W4RZPu_ZgMUSDbkm6_DV9ue4bcDlg-8a1qJ47_5rJ5YZY3jZVbV9We-00c_pNrPXrUwXipEXyps8PaKmB5SiY8KdeWaew9bAqtvP1FpRQmHWQXNZ7ILnGBLZMA_kDBVlkponveSuY61imHvxkdTZx9Y18VQhjso5Ehb6TJDCEyofsQyXDDSzbGbO_gAc_v51yiyiMwNGV9B-D89h_cr_wdQx2Gs7aLM_MA';

/** 구 OAuth 콘솔·북마크용: /login?legal=* → /legal/* (공개 문서 전용 라우트) */
const LEGAL_QUERY = 'legal';
const LEGAL_VALUES = /** @type {const} */ (['privacy', 'terms', 'google']);

const getGoogleAuthUrl = () => `${API_BASE}/auth/google`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ECOSYSTEM_ICONS = [
  { icon: 'mail', title: '메일 작성' },
  { icon: 'calendar_today', title: 'Calendar Sync' },
  { icon: 'mic', title: 'Voice Notes & Summaries' },
  { icon: 'map', title: 'Location Mapping' },
  { icon: 'person_add', title: 'Automated Lead Capture' },
  { icon: 'hub', title: 'Data Visualization' }
];

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginCodeSent, setLoginCodeSent] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [findIdOpen, setFindIdOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [searchParams]);

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) return;
    const v = searchParams.get(LEGAL_QUERY);
    if (LEGAL_VALUES.includes(v)) {
      navigate(`/legal/${v}`, { replace: true });
    }
  }, [navigate, searchParams]);

  useEffect(() => {
    const token = searchParams.get('token');
    const needsRegister = searchParams.get('needsRegister') === '1';
    if (token) {
      localStorage.setItem('crm_token', token);
      if (needsRegister) {
        navigate('/register?token=' + encodeURIComponent(token) + '&needsRegister=1', { replace: true });
        return;
      }
      fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            localStorage.setItem('crm_user', JSON.stringify(data.user));
            navigate(data.user.role === 'pending' ? '/company-overview' : '/', { replace: true });
          }
        })
        .catch(() => setError('로그인 정보를 불러오지 못했습니다.'));
    }
    const err = searchParams.get('error');
    if (err) setError(decodeURIComponent(err));
  }, [navigate, searchParams]);

  const sendLoginOtp = async () => {
    setError('');
    const e = loginEmail.trim().toLowerCase();
    if (!e) {
      setError('아이디(이메일)를 입력해 주세요.');
      return;
    }
    if (!EMAIL_REGEX.test(e)) {
      setError('올바른 이메일 형식이 아닙니다.');
      return;
    }
    setLoginBusy(true);
    try {
      await pingBackendHealth();
      const res = await fetch(`${API_BASE}/auth/send-login-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '인증 번호를 보내지 못했습니다.');
        setLoginCodeSent(false);
        return;
      }
      setLoginCodeSent(true);
      setLoginCode('');
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
      setLoginCodeSent(false);
    } finally {
      setLoginBusy(false);
    }
  };

  const submitPasswordLogin = async (e) => {
    e.preventDefault();
    setError('');
    const eVal = loginEmail.trim().toLowerCase();
    if (!eVal || !EMAIL_REGEX.test(eVal)) {
      setError('아이디(이메일)를 확인해 주세요.');
      return;
    }
    if (!loginCodeSent) {
      setError('먼저 옆의 로그인 버튼으로 이메일 인증 번호를 받아 주세요.');
      return;
    }
    const code = loginCode.trim();
    if (!code) {
      setError('이메일로 받은 인증 번호를 입력해 주세요.');
      return;
    }
    setLoginBusy(true);
    try {
      await pingBackendHealth();
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: eVal,
          verificationCode: code
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('crm_token', data.token);
        if (data.user) localStorage.setItem('crm_user', JSON.stringify(data.user));
        navigate(data.user?.role === 'pending' ? '/company-overview' : '/', { replace: true });
        return;
      }
      setError(data.error || '로그인에 실패했습니다.');
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoginBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg-decor" aria-hidden>
        <div className="login-bg-decor-blob login-bg-decor-blob--tr" />
        <div className="login-bg-decor-blob login-bg-decor-blob--bl" />
      </div>

      <main className="login-main-wrap">
        <section className="login-card-shell">
          <div className="login-card-visual">
            <img
              className="login-card-visual-img"
              src={LOGIN_HEADER_IMAGE}
              alt=""
              decoding="async"
            />
          </div>
          <div className="login-card-body">
            <div className="login-brand">
              <h1 className="login-brand-title">Nexvia CRM</h1>
            </div>

            {error && <p className="login-error">{error}</p>}

            <form className="login-email-panel" onSubmit={submitPasswordLogin}>
              <p className="login-email-panel-title">이메일 로그인</p>
              <div className="login-email-row">
                <label className="login-sr-only" htmlFor="login-email-input">아이디(이메일)</label>
                <input
                  id="login-email-input"
                  type="email"
                  className="login-email-input"
                  value={loginEmail}
                  onChange={(ev) => {
                    setLoginEmail(ev.target.value);
                    setLoginCodeSent(false);
                    setLoginCode('');
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter') return;
                    ev.preventDefault();
                    if (loginBusy) return;
                    void sendLoginOtp();
                  }}
                  placeholder="아이디(이메일)"
                  autoComplete="username"
                  disabled={loginBusy}
                />
                <button
                  type="button"
                  className="login-send-code-btn"
                  onClick={sendLoginOtp}
                  disabled={loginBusy}
                >
                  {loginBusy && !loginCodeSent ? (
                    <span className="login-inline-spinner login-inline-spinner--dark" aria-hidden />
                  ) : null}
                  로그인
                </button>
              </div>
              {loginCodeSent ? (
                <>
                  <label className="login-field-label" htmlFor="login-code-input">인증 번호</label>
                  <input
                    id="login-code-input"
                    type="text"
                    className="login-field-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={loginCode}
                    onChange={(ev) => setLoginCode(ev.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6자리"
                    disabled={loginBusy}
                  />
                  <div className="login-email-actions">
                    <button type="button" className="login-linkish" onClick={sendLoginOtp} disabled={loginBusy}>
                      인증 번호 다시 받기
                    </button>
                    <button type="submit" className="login-submit-email-btn" disabled={loginBusy}>
                      {loginBusy ? (
                        <span className="login-inline-spinner login-inline-spinner--dark" aria-hidden />
                      ) : null}
                      이메일로 로그인 완료
                    </button>
                  </div>
                </>
              ) : null}
            </form>

            <div className="login-subnav">
              <Link to="/register" className="login-subnav-link">회원가입</Link>
              <span className="login-subnav-sep" aria-hidden>|</span>
              <button type="button" className="login-subnav-link login-subnav-btn" onClick={() => setFindIdOpen(true)}>
                아이디 찾기
              </button>
            </div>

            <div className="login-oauth-divider">
              <span>또는</span>
            </div>

            <button
              type="button"
              className="login-google"
              onClick={() => {
                window.location.href = getGoogleAuthUrl();
              }}
            >
              <svg className="login-google-icon" viewBox="0 0 24 24" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span className="login-google-label">Google 계정으로 로그인</span>
            </button>

            <div className="login-ecosystem">
              <p className="login-ecosystem-heading">Seamlessly Connected Ecosystem</p>
              <div className="login-ecosystem-grid">
                {ECOSYSTEM_ICONS.map(({ icon, title }) => (
                  <div key={icon} className="login-ecosystem-cell" title={title}>
                    <div className="login-ecosystem-icon-wrap">
                      <span className="material-symbols-outlined login-ecosystem-icon">{icon}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="login-footer">
          <div className="login-footer-links">
            <Link to="/legal/privacy" className="login-footer-link">
              Privacy Policy
            </Link>
            <Link to="/legal/terms" className="login-footer-link">
              Terms of Service
            </Link>
            <Link to="/legal/google" className="login-footer-link">
              Security
            </Link>
          </div>
          <p className="login-footer-copy">
            © {new Date().getFullYear()} Nexvia CRM. All services integrated via Google Cloud.
          </p>
        </footer>
      </main>

      <FindIdModal open={findIdOpen} onClose={() => setFindIdOpen(false)} />
    </div>
  );
}
