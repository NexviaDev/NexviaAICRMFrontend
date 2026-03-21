import { Link, Navigate, useParams } from 'react-router-dom';
import PrivacyPolicyBody from '../login/legal-modals/legal-content/PrivacyPolicyBody';
import TermsOfServiceBody from '../login/legal-modals/legal-content/TermsOfServiceBody';
import GoogleApiTermsBody from '../login/legal-modals/legal-content/GoogleApiTermsBody';
import '../login/legal-modals/legal-modal.css';
import './legal-public-page.css';

const DOCS = {
  privacy: { title: '개인정보 보호정책', Body: PrivacyPolicyBody },
  terms: { title: '이용약관', Body: TermsOfServiceBody },
  google: { title: 'Google API 및 연동 약관·고지', Body: GoogleApiTermsBody }
};

/**
 * 로그인 없이 접근 가능한 법적 문서 전용 페이지 (OAuth 콘솔·Google 심사용 URL로 등록 가능)
 */
export default function LegalPublicPage() {
  const { doc } = useParams();
  const config = DOCS[doc];
  if (!config) return <Navigate to="/login" replace />;

  const { title, Body } = config;

  return (
    <div className="legal-public-page">
      <header className="legal-public-header">
        <Link to="/login" className="legal-public-back">
          <span className="material-symbols-outlined" aria-hidden>arrow_back</span>
          로그인으로
        </Link>
        <h1 className="legal-public-title">{title}</h1>
      </header>
      <main className="legal-public-main">
        <article className="legal-modal-body legal-public-article">
          <Body />
        </article>
      </main>
    </div>
  );
}
