import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import './register.css';
import { formatPhone, phoneDigitsOnly } from './phoneFormat';
import AddCompany from './add-company';
import SearchCompany from './search-company';

import { API_BASE } from '@/config';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_HINT = '대문자, 소문자, 숫자, 특수문자 각 1개 이상, 6자 이상';

function validatePasswordFront(password) {
  if (!password || password.length < 6) return { ok: false, error: '비밀번호는 6자 이상이어야 합니다.' };
  if (!/[A-Z]/.test(password)) return { ok: false, error: '비밀번호에 대문자를 1개 이상 포함해 주세요.' };
  if (!/[a-z]/.test(password)) return { ok: false, error: '비밀번호에 소문자를 1개 이상 포함해 주세요.' };
  if (!/\d/.test(password)) return { ok: false, error: '비밀번호에 숫자를 1개 이상 포함해 주세요.' };
  if (!/[^A-Za-z0-9]/.test(password)) return { ok: false, error: '비밀번호에 특수문자를 1개 이상 포함해 주세요.' };
  return { ok: true };
}

/** 비밀번호 조건 목록 (밑에 표시용) */
function getPasswordConditions(password) {
  return [
    { ok: !!(password && password.length >= 6), label: '6자 이상' },
    { ok: /[A-Z]/.test(password || ''), label: '대문자 1개 이상' },
    { ok: /[a-z]/.test(password || ''), label: '소문자 1개 이상' },
    { ok: /\d/.test(password || ''), label: '숫자 1개 이상' },
    { ok: /[^A-Za-z0-9]/.test(password || ''), label: '특수문자 1개 이상' }
  ];
}

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token');
  const needsRegister = searchParams.get('needsRegister') === '1';
  const isEditMode = searchParams.get('edit') === '1';

  const [mode, setMode] = useState('email'); // 'email' | 'verify' | 'form' | 'google-complete'
  const [email, setEmail] = useState('');
  const [emailChecked, setEmailChecked] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyAddressDetail, setCompanyAddressDetail] = useState('');
  const [companyDepartment, setCompanyDepartment] = useState('');

  const [addCompanyModalOpen, setAddCompanyModalOpen] = useState(false);
  const [companySearchModalOpen, setCompanySearchModalOpen] = useState(false);
  const [companyConfirmed, setCompanyConfirmed] = useState(false);
  const [companyBusinessNumber, setCompanyBusinessNumber] = useState('');
  const [companyRepresentativeName, setCompanyRepresentativeName] = useState('');
  const [companyNeedsCreate, setCompanyNeedsCreate] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const authHeader = () => {
    const t = tokenFromUrl || localStorage.getItem('crm_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  useEffect(() => {
    if (tokenFromUrl && needsRegister) {
      setMode('google-complete');
      fetch(`${API_BASE}/auth/me?token=${encodeURIComponent(tokenFromUrl)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            setEmail(data.user.email || '');
            setName(data.user.name || '');
            setPhone(data.user.phone ? formatPhone(data.user.phone) : '');
            setCompanyName(data.user.companyName || '');
            setCompanyAddress(data.user.companyAddress || '');
            setCompanyAddressDetail(data.user.companyAddressDetail || '');
            setCompanyDepartment(data.user.companyDepartment || '');
            setCompanyNeedsCreate(false);
            setCompanyRepresentativeName('');
            if (data.user.companyName) {
              setCompanyConfirmed(true);
              fetch(`${API_BASE}/companies/search?q=${encodeURIComponent(data.user.companyName)}&limit=5`)
                .then((r) => r.json())
                .then((d) => {
                  const match = (d.items || []).find((c) => c.name === data.user.companyName);
                  if (match?.businessNumber) setCompanyBusinessNumber(match.businessNumber);
                })
                .catch(() => {});
            }
          }
        })
        .catch(() => setError('로그인 정보를 불러오지 못했습니다.'));
    }
  }, [tokenFromUrl, needsRegister]);

  useEffect(() => {
    if (isEditMode) {
      if (!localStorage.getItem('crm_token')) {
        navigate('/login', { replace: true });
        return;
      }
      setMode('google-complete');
      fetch(`${API_BASE}/auth/me`, { headers: authHeader() })
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            setEmail(data.user.email || '');
            setName(data.user.name || '');
            setPhone(data.user.phone ? formatPhone(data.user.phone) : '');
            setCompanyName(data.user.companyName || '');
            setCompanyAddress(data.user.companyAddress || '');
            setCompanyAddressDetail(data.user.companyAddressDetail || '');
            setCompanyDepartment(data.user.companyDepartment || '');
            setCompanyNeedsCreate(false);
            setCompanyRepresentativeName('');
            if (data.user.companyName) {
              setCompanyConfirmed(true);
              fetch(`${API_BASE}/companies/search?q=${encodeURIComponent(data.user.companyName)}&limit=5`)
                .then((r) => r.json())
                .then((d) => {
                  const match = (d.items || []).find((c) => c.name === data.user.companyName);
                  if (match?.businessNumber) setCompanyBusinessNumber(match.businessNumber);
                })
                .catch(() => {});
            }
          }
        })
        .catch(() => setError('내 정보를 불러오지 못했습니다.'));
    }
  }, [isEditMode, navigate]);

  const handlePhoneChange = (value) => {
    setPhone(formatPhone(value));
  };

  const handleCompanySelect = (company) => {
    const name = typeof company === 'string' ? company : (company?.name ?? '');
    const address = typeof company === 'object' && company ? (company.address ?? '') : '';
    const addressDetail = typeof company === 'object' && company ? (company.addressDetail ?? '') : '';
    const businessNumber = typeof company === 'object' && company ? (company.businessNumber ?? '') : '';
    const representativeName = typeof company === 'object' && company ? (company.representativeName ?? '') : '';
    const isNewDraft = !!(typeof company === 'object' && company?.isNewDraft);
    setCompanyName(name);
    setCompanyConfirmed(true);
    setCompanyBusinessNumber(businessNumber);
    setCompanyRepresentativeName(representativeName);
    setCompanyNeedsCreate(isNewDraft);
    setCompanySearchModalOpen(false);
    if (address !== undefined) setCompanyAddress(address);
    if (addressDetail !== undefined) setCompanyAddressDetail(addressDetail);
  };

  const handleCheckEmail = async () => {
    setError('');
    setSuccess('');
    const e = email.trim().toLowerCase();
    if (!e) {
      setError('이메일을 입력해 주세요.');
      return;
    }
    if (!EMAIL_REGEX.test(e)) {
      setError('올바른 이메일 형식이 아닙니다.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setEmail(e);
        setEmailChecked(true);
        setSuccess('사용 가능한 이메일입니다. 인증 번호를 발송합니다.');
        setMode('verify');
        fetch(`${API_BASE}/auth/send-verification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: e })
        }).then((r) => r.json()).then((d) => { if (!d.ok) setError(d.error || '인증 번호 발송에 실패했습니다.'); }).catch(() => {});
        return;
      }
      setError(data.error || '이메일 중복 검사에 실패했습니다.');
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess('인증 번호가 발송되었습니다. (SMTP 미설정 시 서버 콘솔에 출력됩니다)');
      } else {
        setError(data.error || '인증 번호 발송에 실패했습니다.');
      }
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndGoForm = () => {
    if (!verificationCode.trim()) {
      setError('인증 번호를 입력해 주세요.');
      return;
    }
    setError('');
    setMode('form');
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const eVal = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(eVal)) {
      setError('올바른 이메일 형식을 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!verificationCode.trim()) {
      setError('인증 번호를 입력해 주세요.');
      setLoading(false);
      return;
    }
    const pwdCheck = validatePasswordFront(password);
    if (!pwdCheck.ok) {
      setError(pwdCheck.error);
      setLoading(false);
      return;
    }
    if (password !== passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      setLoading(false);
      return;
    }
    if (!name.trim()) {
      setError('이름을 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (phoneDigitsOnly(phone).length < 9) {
      setError('연락처를 9자리 이상 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyConfirmed || !companyName.trim()) {
      setError('회사를 검색하여 선택하거나, 회사 추가 버튼으로 등록해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyAddress.trim()) {
      setError('회사 주소를 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyAddressDetail.trim()) {
      setError('회사 상세주소를 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyDepartment.trim()) {
      setError('회사 부서명을 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (companyNeedsCreate && !companyBusinessNumber.trim()) {
      setError('새 회사 저장을 위해 사업자 번호가 필요합니다.');
      setLoading(false);
      return;
    }
    if (companyNeedsCreate && !companyRepresentativeName.trim()) {
      setError('새 회사 저장을 위해 대표자 성함이 필요합니다.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: eVal,
          verificationCode: verificationCode.trim(),
          password,
          name: name.trim(),
          phone: phone.trim(),
          companyName: companyName.trim(),
          companyAddress: companyAddress.trim(),
          companyAddressDetail: companyAddressDetail.trim(),
          companyDepartment: companyDepartment.trim(),
          companyBusinessNumber: companyBusinessNumber.trim(),
          companyRepresentativeName: companyNeedsCreate ? companyRepresentativeName.trim() : '',
          createCompanyOnSave: companyNeedsCreate
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('crm_token', data.token);
        if (data.user) localStorage.setItem('crm_user', JSON.stringify(data.user));
        navigate('/', { replace: true });
        return;
      }
      setError(data.error || '회원가입에 실패했습니다.');
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteProfileSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (!isEditMode) {
      const pwdCheckComplete = validatePasswordFront(password);
      if (!pwdCheckComplete.ok) {
        setError(pwdCheckComplete.error);
        setLoading(false);
        return;
      }
      if (password !== passwordConfirm) {
        setError('비밀번호가 일치하지 않습니다.');
        setLoading(false);
        return;
      }
    } else if (password || passwordConfirm) {
      const pwdCheckComplete = validatePasswordFront(password);
      if (!pwdCheckComplete.ok) {
        setError(pwdCheckComplete.error);
        setLoading(false);
        return;
      }
      if (password !== passwordConfirm) {
        setError('비밀번호가 일치하지 않습니다.');
        setLoading(false);
        return;
      }
    }
    if (!name.trim()) {
      setError('이름을 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (phoneDigitsOnly(phone).length < 9) {
      setError('연락처를 9자리 이상 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyConfirmed || !companyName.trim()) {
      setError('회사를 검색하여 선택하거나, 회사 추가 버튼으로 등록해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyAddress.trim()) {
      setError('회사 주소를 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyAddressDetail.trim()) {
      setError('회사 상세주소를 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (!companyDepartment.trim()) {
      setError('회사 부서명을 입력해 주세요.');
      setLoading(false);
      return;
    }
    if (companyNeedsCreate && !companyBusinessNumber.trim()) {
      setError('새 회사 저장을 위해 사업자 번호가 필요합니다.');
      setLoading(false);
      return;
    }
    if (companyNeedsCreate && !companyRepresentativeName.trim()) {
      setError('새 회사 저장을 위해 대표자 성함이 필요합니다.');
      setLoading(false);
      return;
    }
    try {
      const body = {
        name: name.trim(),
        phone: phone.trim(),
        companyName: companyName.trim(),
        companyAddress: companyAddress.trim(),
        companyAddressDetail: companyAddressDetail.trim(),
        companyDepartment: companyDepartment.trim(),
        companyBusinessNumber: companyBusinessNumber.trim(),
        companyRepresentativeName: companyNeedsCreate ? companyRepresentativeName.trim() : '',
        createCompanyOnSave: companyNeedsCreate
      };
      if (password) body.password = password;
      const res = await fetch(`${API_BASE}/auth/complete-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('crm_token', data.token);
        if (data.user) localStorage.setItem('crm_user', JSON.stringify(data.user));
        navigate('/', { replace: true });
        return;
      }
      setError(data.error || '정보 저장에 실패했습니다.');
    } catch (_) {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'google-complete') {
    return (
      <div className="register-page">
        <div className="register-container">
          <div className="register-card">
            <div className="register-header">
              <div className="register-logo">
                <span className="material-symbols-outlined">hub</span>
              </div>
              <h2>{isEditMode ? '내 정보 수정' : '추가 정보 입력'}</h2>
              <p>{isEditMode ? '회원 정보를 수정할 수 있습니다' : 'Google 로그인 후 부가 정보를 입력해 주세요'}</p>
            </div>
            <div className="register-body">
              {error && <p className="register-error">{error}</p>}
              <form onSubmit={handleCompleteProfileSubmit} className="register-form">
                <div className="register-field">
                  <label>이메일 (아이디)</label>
                  <input type="email" value={email} readOnly />
                </div>
                <div className="register-field">
                  <label htmlFor="reg-password">{isEditMode ? '비밀번호 (변경 시에만 입력)' : '비밀번호 *'}</label>
                  <input id="reg-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEditMode ? '변경할 경우에만 입력' : '비밀번호 입력'} required={!isEditMode} />
                </div>
                <div className="register-field">
                  <label htmlFor="reg-password-confirm">{isEditMode ? '비밀번호 확인' : '비밀번호 확인 *'}</label>
                  <input id="reg-password-confirm" type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder={isEditMode ? '변경할 경우에만 입력' : '비밀번호 다시 입력'} required={!isEditMode} />
                </div>
                <div className="register-password-conditions">
                  <p className="register-conditions-title">비밀번호 조건</p>
                  <ul className="register-conditions-list">
                    {getPasswordConditions(password).map((c, i) => (
                      <li key={i} className={c.ok ? 'ok' : ''}><span className="material-symbols-outlined">{c.ok ? 'check_circle' : 'cancel'}</span>{c.label}</li>
                    ))}
                    <li className={passwordConfirm && password === passwordConfirm ? 'ok' : ''}><span className="material-symbols-outlined">{passwordConfirm && password === passwordConfirm ? 'check_circle' : 'cancel'}</span>비밀번호 일치</li>
                  </ul>
                </div>
                <div className="register-field">
                  <label htmlFor="reg-name">이름 *</label>
                  <input id="reg-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" required />
                </div>
                <div className="register-field">
                  <label htmlFor="reg-phone">연락처 *</label>
                  <input id="reg-phone" type="tel" value={phone} onChange={(e) => handlePhoneChange(e.target.value)} placeholder="010-1234-5678" required />
                </div>
                <div className="register-field register-company-wrap">
                  <label>회사 *</label>
                  <div className="register-company-input-row">
                    <input type="text" value={companyName} readOnly placeholder="돋보기를 눌러 회사를 검색하세요" />
                    <button type="button" className="register-company-search-btn" onClick={() => setCompanySearchModalOpen(true)}>
                      <span className="material-symbols-outlined">search</span>
                    </button>
                  </div>
                  {companyConfirmed && companyBusinessNumber && (
                    <span className="register-company-biz-number">
                      <span className="material-symbols-outlined">badge</span> 사업자번호: {companyBusinessNumber}
                    </span>
                  )}
                  {!companyConfirmed && (
                    <span className="register-company-status unconfirmed">
                      <span className="material-symbols-outlined">info</span> 돋보기를 눌러 검색하거나, 회사 추가를 이용해 주세요
                    </span>
                  )}
                  {isEditMode && companyConfirmed && (
                    <span className="register-company-status unconfirmed">
                      <span className="material-symbols-outlined">hourglass_top</span> 회사를 변경하면 권한이 `권한 대기` 상태로 전환됩니다.
                    </span>
                  )}
                  <button type="button" className="register-company-add-btn" onClick={() => setAddCompanyModalOpen(true)}>+ 회사 추가</button>
                </div>
                <div className="register-field">
                  <label>회사 주소</label>
                  <input type="text" value={companyAddress} readOnly placeholder="회사 선택 시 자동 입력" />
                </div>
                <div className="register-field">
                  <label>회사 상세주소</label>
                  <input type="text" value={companyAddressDetail} readOnly placeholder="회사 선택 시 자동 입력" />
                </div>
                <div className="register-field">
                  <label htmlFor="reg-dept">부서명 *</label>
                  <input id="reg-dept" type="text" value={companyDepartment} onChange={(e) => setCompanyDepartment(e.target.value)} placeholder="부서명" required />
                </div>
                <button type="submit" className="register-submit" disabled={loading}>{loading ? '저장 중...' : '저장'}</button>
              </form>
            </div>
            <div className="register-footer">
              {isEditMode ? <p><Link to="/">메인으로 돌아가기</Link></p> : <p>이미 계정이 있으신가요? <Link to="/login">로그인</Link></p>}
            </div>
          </div>
        </div>
        <SearchCompany
          isOpen={companySearchModalOpen}
          onClose={() => setCompanySearchModalOpen(false)}
          onSelect={handleCompanySelect}
        />
        <AddCompany
          isOpen={addCompanyModalOpen}
          onClose={() => setAddCompanyModalOpen(false)}
          onSuccess={(company) => { handleCompanySelect(company); setAddCompanyModalOpen(false); }}
          setError={setError}
        />
        <div className="register-top-bar" />
      </div>
    );
  }

  if (mode === 'form') {
    return (
      <div className="register-page">
        <div className="register-container">
          <div className="register-card">
            <div className="register-header">
              <div className="register-logo">
                <span className="material-symbols-outlined">hub</span>
              </div>
              <h2>회원가입</h2>
              <p>정보를 입력해 주세요</p>
            </div>
            <div className="register-body">
              <span className="register-step-badge">2/2</span>
              {error && <p className="register-error">{error}</p>}
              <form onSubmit={handleRegisterSubmit} className="register-form">
                <div className="register-field">
                  <label>이메일 (인증 완료)</label>
                  <input type="email" value={email} readOnly />
                </div>
                <div className="register-field">
                  <label htmlFor="form-code">인증 번호 *</label>
                  <input id="form-code" type="text" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="6자리 인증 번호" maxLength={6} required />
                </div>
                <div className="register-field">
                  <label htmlFor="form-password">비밀번호 *</label>
                  <input id="form-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 입력" required />
                </div>
                <div className="register-field">
                  <label htmlFor="form-password-confirm">비밀번호 확인 *</label>
                  <input id="form-password-confirm" type="password" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} placeholder="비밀번호 다시 입력" required />
                </div>
                <div className="register-password-conditions">
                  <p className="register-conditions-title">비밀번호 조건</p>
                  <ul className="register-conditions-list">
                    {getPasswordConditions(password).map((c, i) => (
                      <li key={i} className={c.ok ? 'ok' : ''}><span className="material-symbols-outlined">{c.ok ? 'check_circle' : 'cancel'}</span>{c.label}</li>
                    ))}
                    <li className={passwordConfirm && password === passwordConfirm ? 'ok' : ''}><span className="material-symbols-outlined">{passwordConfirm && password === passwordConfirm ? 'check_circle' : 'cancel'}</span>비밀번호 일치</li>
                  </ul>
                </div>
                <div className="register-field">
                  <label htmlFor="form-name">이름 *</label>
                  <input id="form-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" required />
                </div>
                <div className="register-field">
                  <label htmlFor="form-phone">연락처 *</label>
                  <input id="form-phone" type="tel" value={phone} onChange={(e) => handlePhoneChange(e.target.value)} placeholder="010-1234-5678" required />
                </div>
                <div className="register-field register-company-wrap">
                  <label>회사 *</label>
                  <div className="register-company-input-row">
                    <input type="text" value={companyName} readOnly placeholder="돋보기를 눌러 회사를 검색하세요" />
                    <button type="button" className="register-company-search-btn" onClick={() => setCompanySearchModalOpen(true)}>
                      <span className="material-symbols-outlined">search</span>
                    </button>
                  </div>
                  {companyConfirmed && companyBusinessNumber && (
                    <span className="register-company-biz-number">
                      <span className="material-symbols-outlined">badge</span> 사업자번호: {companyBusinessNumber}
                    </span>
                  )}
                  {!companyConfirmed && (
                    <span className="register-company-status unconfirmed">
                      <span className="material-symbols-outlined">info</span> 돋보기를 눌러 검색하거나, 회사 추가를 이용해 주세요
                    </span>
                  )}
                  {companyConfirmed && (
                    <span className="register-company-status confirmed">
                      <span className="material-symbols-outlined">verified_user</span> 새 회사라면 저장 시 최초 저장자에게 자동으로 `Owner` 권한이 부여됩니다.
                    </span>
                  )}
                  <button type="button" className="register-company-add-btn" onClick={() => setAddCompanyModalOpen(true)}>+ 회사 추가</button>
                </div>
                <div className="register-field">
                  <label>회사 주소</label>
                  <input type="text" value={companyAddress} readOnly placeholder="회사 선택 시 자동 입력" />
                </div>
                <div className="register-field">
                  <label>회사 상세주소</label>
                  <input type="text" value={companyAddressDetail} readOnly placeholder="회사 선택 시 자동 입력" />
                </div>
                <div className="register-field">
                  <label htmlFor="form-dept">부서명 *</label>
                  <input id="form-dept" type="text" value={companyDepartment} onChange={(e) => setCompanyDepartment(e.target.value)} placeholder="부서명" required />
                </div>
                <button type="submit" className="register-submit" disabled={loading}>{loading ? '가입 중...' : '가입하기'}</button>
              </form>
            </div>
            <div className="register-footer">
              <p>이미 계정이 있으신가요? <Link to="/login">로그인</Link></p>
            </div>
          </div>
        </div>
        <SearchCompany
          isOpen={companySearchModalOpen}
          onClose={() => setCompanySearchModalOpen(false)}
          onSelect={handleCompanySelect}
        />
        <AddCompany
          isOpen={addCompanyModalOpen}
          onClose={() => setAddCompanyModalOpen(false)}
          onSuccess={(company) => { handleCompanySelect(company); setAddCompanyModalOpen(false); }}
          setError={setError}
        />
        <div className="register-top-bar" />
      </div>
    );
  }

  if (mode === 'verify') {
    return (
      <div className="register-page">
        <div className="register-container">
          <div className="register-card">
            <div className="register-header">
              <div className="register-logo">
                <span className="material-symbols-outlined">hub</span>
              </div>
              <h2>이메일 인증</h2>
              <p>{email} 로 인증 번호를 발송합니다</p>
            </div>
            <div className="register-body">
              <span className="register-step-badge">1/2</span>
              {error && <p className="register-error">{error}</p>}
              {success && <p className="register-success">{success}</p>}
              <div className="register-form">
                <div className="register-field">
                  <label htmlFor="verify-code">인증 번호 *</label>
                  <input id="verify-code" type="text" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="6자리 인증 번호" maxLength={6} />
                </div>
                <div className="register-actions">
                  <button type="button" className="register-btn register-btn-secondary" onClick={handleSendCode} disabled={loading}>인증 번호 다시 받기</button>
                  <button type="button" className="register-btn register-btn-primary" onClick={handleVerifyAndGoForm} disabled={loading}>인증 후 다음</button>
                </div>
              </div>
            </div>
            <div className="register-footer">
              <p>다른 이메일로 하시려면 <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', fontWeight: 700 }} onClick={() => { setMode('email'); setEmailChecked(false); setVerificationCode(''); setSuccess(''); setError(''); }}>처음으로</button></p>
            </div>
          </div>
        </div>
        <div className="register-top-bar" />
      </div>
    );
  }

  return (
    <div className="register-page">
      <div className="register-container">
        <div className="register-card">
          <div className="register-header">
            <div className="register-logo">
              <span className="material-symbols-outlined">hub</span>
            </div>
            <h2>회원가입</h2>
            <p>이메일 인증 후 가입을 진행합니다</p>
          </div>
          <div className="register-body">
            <span className="register-step-badge">1/2</span>
            {error && <p className="register-error">{error}</p>}
            {success && <p className="register-success">{success}</p>}
            <div className="register-form">
              <div className="register-field">
                <label htmlFor="reg-email">아이디 (이메일) *</label>
                <input id="reg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@company.com" disabled={!!emailChecked} />
              </div>
              <div className="register-actions">
                <button type="button" className="register-btn register-btn-primary" onClick={handleCheckEmail} disabled={loading}>{loading ? '확인 중...' : '중복 검사'}</button>
              </div>
            </div>
          </div>
          <div className="register-footer">
            <p>이미 계정이 있으신가요? <Link to="/login">로그인</Link></p>
          </div>
        </div>
      </div>
      <div className="register-top-bar" />
    </div>
  );
}
