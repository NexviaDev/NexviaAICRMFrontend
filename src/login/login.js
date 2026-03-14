import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { API_BASE } from '@/config';
import './login.css';

const getGoogleAuthUrl = () => `${API_BASE}/auth/google`;

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = searchParams.get('token');
    const needsRegister = searchParams.get('needsRegister') === '1';
    if (token) {
      localStorage.setItem('crm_token', token);
      if (needsRegister) {
        navigate('/register?token=' + encodeURIComponent(token) + '&needsRegister=1', { replace: true });
        return;
      }
      fetch(`${API_BASE}/auth/me`, { headers: { Authorization: 'Bearer ' + token } })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            localStorage.setItem('crm_user', JSON.stringify(data.user));
            navigate('/', { replace: true });
          }
        })
        .catch(() => setError('로그인 정보를 불러오지 못했습니다.'));
    }
    const err = searchParams.get('error');
    if (err) setError(decodeURIComponent(err));
  }, [navigate, searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('crm_token', data.token);
        if (data.user) localStorage.setItem('crm_user', JSON.stringify(data.user));
        navigate('/', { replace: true });
        return;
      }
      if (res.ok && data.user) {
        localStorage.setItem('crm_user', JSON.stringify(data.user));
        navigate('/', { replace: true });
        return;
      }
      setError(data.error || '로그인에 실패했습니다.');
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <span className="material-symbols-outlined">hub</span>
            </div>
            <h2>Nexvia CRM</h2>
            <p>시스템에 로그인하세요</p>
          </div>
          <div className="login-body">
            <button
              type="button"
              className="login-google"
              onClick={() => { window.location.href = getGoogleAuthUrl(); }}
            >
              <svg className="google-icon" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" />
              </svg>
              <span>Google 계정으로 로그인</span>
            </button>
            <div className="login-divider">
              <span>또는 이메일로 로그인</span>
            </div>
            <form onSubmit={handleSubmit} className="login-form">
              {error && <p className="login-error">{error}</p>}
              <div className="login-field">
                <label htmlFor="email">이메일</label>
                <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@company.com" required />
              </div>
              <div className="login-field">
                <label htmlFor="password">비밀번호</label>
                <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <div className="login-options">
                <label className="login-remember">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  <span>로그인 상태 유지</span>
                </label>
                <a href="#forgot">비밀번호를 잊으셨나요?</a>
              </div>
              <button type="submit" className="login-submit" disabled={loading}>{loading ? '로그인 중...' : '로그인'}</button>
            </form>
          </div>
          <div className="login-footer">
            <p>계정이 없으신가요? <Link to="/register">회원가입</Link></p>
          </div>
        </div>
      </div>
      <div className="login-top-bar" />
    </div>
  );
}
