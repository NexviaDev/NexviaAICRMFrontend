import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE } from '@/config';
import nexviaLogo from '../../img/Nexvia Logo(1).png';
import './login.css';

const getGoogleAuthUrl = () => `${API_BASE}/auth/google`;

/** Sample Design/CDN ref.txt — Cloudinary */
const FEATURE_BG = {
  gmailCalendar:
    'https://res.cloudinary.com/djcsvvhly/image/upload/v1773987515/Perfect_integration_of_Gmail_Calendar_saxql4.png',
  aiVoice:
    'https://res.cloudinary.com/djcsvvhly/image/upload/v1773987510/AI_Voice_Summary_tmnrm5.png',
  map: 'https://res.cloudinary.com/djcsvvhly/image/upload/v1773987510/Map-based_Management_mbxueh.png',
  dataMapping:
    'https://res.cloudinary.com/djcsvvhly/image/upload/v1773987509/Data_Mapping_xksvxp.png',
  businessCards:
    'https://res.cloudinary.com/djcsvvhly/image/upload/v1773987526/Business_Cards_Company_Management_nbrymi.png'
};

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [searchParams]);

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

  return (
    <div className="login-page">
      <div className="login-top-logo">
        <img src={nexviaLogo} alt="Nexvia" className="login-top-logo-img" />
      </div>

      <main className="login-site-main">
        <section className="login-hero" id="login-hero" aria-labelledby="login-hero-title">
          <h1 id="login-hero-title" className="login-hero-title">
            가장 선명한 워크스페이스
          </h1>
          <p className="login-hero-lead">
            Google 계정 하나로 시작하는 데이터 중심의 고객 관리. Nexvia CRM으로 비즈니스를 동기화하세요.
          </p>
          <div className="login-card" id="login-card">
            <div className="login-card-inner">
              {error && <p className="login-error">{error}</p>}
              <button
                type="button"
                className="login-google"
                onClick={() => {
                  window.location.href = getGoogleAuthUrl();
                }}
              >
                <svg className="google-icon" viewBox="0 0 24 24" aria-hidden>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" />
                </svg>
                <span>Google 계정으로 로그인</span>
              </button>
              <p className="login-google-note">Nexvia CRM은 Google Workspace 전용 서비스입니다.</p>
            </div>
          </div>
        </section>

        <section className="login-features" id="features" aria-label="주요 기능">
          <div className="login-features-grid">
            <article
              className="login-feature login-feature-bg login-feature-wide"
              style={{ backgroundImage: `url(${FEATURE_BG.gmailCalendar})` }}
            >
              <span className="material-symbols-outlined login-feature-icon">calendar_today</span>
              <h3 className="login-feature-title">Gmail &amp; Calendar 완벽 통합</h3>
              <p className="login-feature-desc">
                이메일 대화 내역과 캘린더 일정이 자동으로 고객 데이터와 연결됩니다. 스위칭 없이 모든 소통을 한 곳에서 관리하세요.
              </p>
            </article>

            <article
              className="login-feature login-feature-bg login-feature-voice"
              style={{ backgroundImage: `url(${FEATURE_BG.aiVoice})` }}
            >
              <span className="material-symbols-outlined login-feature-icon">mic</span>
              <h3 className="login-feature-title">AI 보이스 요약</h3>
              <p className="login-feature-desc">
                회의 녹음 파일을 업로드하면 핵심 내용을 요약하고 다음 행동을 제안합니다.
              </p>
            </article>

            <article
              className="login-feature login-feature-bg login-feature-map"
              style={{ backgroundImage: `url(${FEATURE_BG.map})` }}
            >
              <span className="material-symbols-outlined login-feature-icon">map</span>
              <h3 className="login-feature-title">지도 기반 관리</h3>
              <p className="login-feature-desc">
                지역별 고객 밀집도와 방문 경로를 지도로 시각화하여 영업 효율을 극대화합니다.
              </p>
            </article>

            <article
              className="login-feature login-feature-bg login-feature-data"
              style={{ backgroundImage: `url(${FEATURE_BG.dataMapping})` }}
            >
              <span className="material-symbols-outlined login-feature-icon">database</span>
              <h3 className="login-feature-title">데이터 매핑</h3>
              <p className="login-feature-desc">
                기존 레거시 DB와 손쉽게 연결하여 복잡한 데이터 구조를 직관적인 UI로 변환합니다.
              </p>
            </article>

            <article
              className="login-feature login-feature-bg login-feature-cardscan"
              style={{ backgroundImage: `url(${FEATURE_BG.businessCards})` }}
            >
              <span className="material-symbols-outlined login-feature-icon">contact_page</span>
              <h3 className="login-feature-title">명함 &amp; 회사 관리</h3>
              <p className="login-feature-desc">
                스캔 한 번으로 기업 정보를 자동 업데이트하고 AI가 담당자 정보를 최신화합니다.
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="login-site-footer">
        <p className="login-site-footer-copy">© 2026 Nexvia CRM. All rights reserved.</p>
        <div className="login-site-footer-links">
          <a href="#features">Privacy</a>
          <a href="#features">Terms</a>
          <a href="#features">Google Cloud</a>
          <a href="#features">Support</a>
        </div>
        <p className="login-site-footer-photo-credit">기능 카드 이미지: Cloudinary (CDN ref)</p>
      </footer>
    </div>
  );
}
