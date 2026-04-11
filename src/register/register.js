import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import './register.css';
import { formatPhone, phoneDigitsOnly } from './phoneFormat';
import AddCompany from './add-company';
import SearchCompany from './search-company';

import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyAddressDetail, setCompanyAddressDetail] = useState('');
  const [companyDepartment, setCompanyDepartment] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [departmentOptions, setDepartmentOptions] = useState([]);
  const [departmentLoading, setDepartmentLoading] = useState(false);

  const [addCompanyModalOpen, setAddCompanyModalOpen] = useState(false);
  const [companySearchModalOpen, setCompanySearchModalOpen] = useState(false);
  const [companyConfirmed, setCompanyConfirmed] = useState(false);
  const [companyBusinessNumber, setCompanyBusinessNumber] = useState('');
  const [companyRepresentativeName, setCompanyRepresentativeName] = useState('');
  const [companyNeedsCreate, setCompanyNeedsCreate] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  /** 로컬에서 고른 파일(가입·프로필 저장 후 Cloudinary 업로드 — lead-capture 명함 패턴) */
  const [avatarFile, setAvatarFile] = useState(null);
  /** 미리보기: 서버 URL 또는 blob: */
  const [avatarPreview, setAvatarPreview] = useState(null);
  /** 서버에 저장된 아바타(선택 취소 시 복원) */
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(null);
  /** 파일을 끌어다 놓을 때 영역 강조 */
  const [avatarDropActive, setAvatarDropActive] = useState(false);
  const avatarInputRef = useRef(null);
  const avatarObjectUrlRef = useRef(null);

  const clearAvatarObjectUrl = useCallback(() => {
    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
      avatarObjectUrlRef.current = null;
    }
  }, []);

  const applyServerAvatar = useCallback((url) => {
    clearAvatarObjectUrl();
    const u = url && String(url).trim() ? String(url).trim() : null;
    setSavedAvatarUrl(u);
    setAvatarPreview(u);
    setAvatarFile(null);
  }, [clearAvatarObjectUrl]);

  useEffect(() => () => {
    clearAvatarObjectUrl();
  }, [clearAvatarObjectUrl]);

  const tryUploadProfilePhoto = async (token, file) => {
    if (!token || !file) return null;
    await pingBackendHealth(() => ({ Authorization: `Bearer ${token}` }));
    const formData = new FormData();
    formData.append('image', file, file.name || 'profile.jpg');
    const res = await fetch(`${API_BASE}/auth/profile-photo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '프로필 사진 업로드에 실패했습니다.');
    return data;
  };

  const applyAvatarFile = useCallback((f) => {
    setError('');
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('이미지 파일만 선택할 수 있습니다.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('사진은 5MB 이하로 올려 주세요.');
      return;
    }
    clearAvatarObjectUrl();
    const url = URL.createObjectURL(f);
    avatarObjectUrlRef.current = url;
    setAvatarPreview(url);
    setAvatarFile(f);
  }, [clearAvatarObjectUrl]);

  const onAvatarFileChange = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    applyAvatarFile(f);
  };

  const preventAvatarDragDefaults = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onAvatarDragOver = useCallback(
    (e) => {
      preventAvatarDragDefaults(e);
      try {
        e.dataTransfer.dropEffect = 'copy';
      } catch (_) {
        /* ignore */
      }
    },
    [preventAvatarDragDefaults]
  );

  const onAvatarDragEnter = useCallback(
    (e) => {
      preventAvatarDragDefaults(e);
      const types = e.dataTransfer?.types;
      const hasFiles = types && [...types].includes('Files');
      if (hasFiles) setAvatarDropActive(true);
    },
    [preventAvatarDragDefaults]
  );

  const onAvatarDragLeave = useCallback(
    (e) => {
      preventAvatarDragDefaults(e);
      if (e.currentTarget.contains(e.relatedTarget)) return;
      setAvatarDropActive(false);
    },
    [preventAvatarDragDefaults]
  );

  const onAvatarDrop = useCallback(
    (e) => {
      preventAvatarDragDefaults(e);
      setAvatarDropActive(false);
      const f = e.dataTransfer?.files?.[0];
      applyAvatarFile(f);
    },
    [applyAvatarFile, preventAvatarDragDefaults]
  );

  const authHeader = () => {
    const t = tokenFromUrl || localStorage.getItem('crm_token');
    return t ? { Authorization: `Bearer ${t}` } : {};
  };

  /** DB에 사용자 없음(삭제됨)·토큰 무효 시 브라우저에 남은 세션 정리 */
  const clearStoredSession = () => {
    localStorage.removeItem('crm_token');
    localStorage.removeItem('crm_user');
  };

  const resolveDepartmentValue = (raw, options) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    const hitById = options.find((o) => String(o.id) === s);
    if (hitById) return String(hitById.id);
    const hitByLabel = options.find((o) => o.label === s || o.name === s);
    if (hitByLabel) return String(hitByLabel.id);
    return s;
  };

  const getDepartmentForSubmit = () => String(companyDepartment || '').trim();
  const getDepartmentDisplayText = () => {
    const s = String(companyDepartment || '').trim();
    if (!s) return '';
    const hit = departmentOptions.find((o) => String(o.id) === s);
    return hit ? hit.label : s;
  };

  useEffect(() => {
    if (tokenFromUrl && needsRegister) {
      setMode('google-complete');
      fetch(`${API_BASE}/auth/me?token=${encodeURIComponent(tokenFromUrl)}`)
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.user) {
            clearStoredSession();
            setError(data.error || '계정을 찾을 수 없습니다. DB에서 삭제되었거나 토큰이 잘못되었을 수 있습니다.');
            navigate('/login', { replace: true });
            return;
          }
          setEmail(data.user.email || '');
          setName(data.user.name || '');
          applyServerAvatar(data.user.avatar);
          setPhone(data.user.phone ? formatPhone(data.user.phone) : '');
          setCompanyName(data.user.companyName || '');
          setCompanyAddress(data.user.companyAddress || '');
          setCompanyAddressDetail(data.user.companyAddressDetail || '');
          setCompanyDepartment(data.user.companyDepartment || '');
          setSelectedCompanyId(data.user.companyId ? String(data.user.companyId) : '');
          setCompanyNeedsCreate(false);
          setCompanyRepresentativeName('');
          if (data.user.companyName) {
            setCompanyConfirmed(true);
            fetch(`${API_BASE}/companies/search?q=${encodeURIComponent(data.user.companyName)}&limit=5`)
              .then((r) => r.json())
              .then((d) => {
                const match = (d.items || []).find((c) => c.name === data.user.companyName);
                if (match?.businessNumber) setCompanyBusinessNumber(match.businessNumber);
                if (match?._id || match?.id) setSelectedCompanyId(String(match._id || match.id));
              })
              .catch(() => {});
          }
        })
        .catch(() => {
          clearStoredSession();
          setError('로그인 정보를 불러오지 못했습니다.');
          navigate('/login', { replace: true });
        });
    }
  }, [tokenFromUrl, needsRegister, navigate, applyServerAvatar]);

  useEffect(() => {
    if (isEditMode) {
      if (!localStorage.getItem('crm_token')) {
        navigate('/login', { replace: true });
        return;
      }
      setMode('google-complete');
      fetch(`${API_BASE}/auth/me`, { headers: authHeader() })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.user) {
            clearStoredSession();
            setError(data.error || '계정을 찾을 수 없습니다.');
            navigate('/login', { replace: true });
            return;
          }
          setEmail(data.user.email || '');
          setName(data.user.name || '');
          applyServerAvatar(data.user.avatar);
          setPhone(data.user.phone ? formatPhone(data.user.phone) : '');
          setCompanyName(data.user.companyName || '');
          setCompanyAddress(data.user.companyAddress || '');
          setCompanyAddressDetail(data.user.companyAddressDetail || '');
          setCompanyDepartment(data.user.companyDepartment || '');
          setSelectedCompanyId(data.user.companyId ? String(data.user.companyId) : '');
          setCompanyNeedsCreate(false);
          setCompanyRepresentativeName('');
          if (data.user.companyName) {
            setCompanyConfirmed(true);
            fetch(`${API_BASE}/companies/search?q=${encodeURIComponent(data.user.companyName)}&limit=5`)
              .then((r) => r.json())
              .then((d) => {
                const match = (d.items || []).find((c) => c.name === data.user.companyName);
                if (match?.businessNumber) setCompanyBusinessNumber(match.businessNumber);
                if (match?._id || match?.id) setSelectedCompanyId(String(match._id || match.id));
              })
              .catch(() => {});
          }
        })
        .catch(() => {
          clearStoredSession();
          setError('내 정보를 불러오지 못했습니다.');
          navigate('/login', { replace: true });
        });
    }
  }, [isEditMode, navigate, applyServerAvatar]);

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
    const companyId = typeof company === 'object' && company ? (company._id || company.id || '') : '';
    setCompanyName(name);
    setCompanyConfirmed(true);
    setCompanyBusinessNumber(businessNumber);
    setCompanyRepresentativeName(representativeName);
    setCompanyNeedsCreate(isNewDraft);
    setSelectedCompanyId(isNewDraft ? '' : String(companyId || ''));
    setDepartmentOptions([]);
    setCompanyDepartment('');
    setCompanySearchModalOpen(false);
    if (address !== undefined) setCompanyAddress(address);
    if (addressDetail !== undefined) setCompanyAddressDetail(addressDetail);
  };

  useEffect(() => {
    const cid = String(selectedCompanyId || '').trim();
    if (!cid) {
      setDepartmentOptions([]);
      return;
    }
    let cancelled = false;
    setDepartmentLoading(true);
    fetch(`${API_BASE}/companies/${encodeURIComponent(cid)}/public-organization-chart`)
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        const options = Array.isArray(data.departments) ? data.departments : [];
        setDepartmentOptions(options);
        setCompanyDepartment((prev) => resolveDepartmentValue(prev, options));
      })
      .catch(() => {
        if (!cancelled) setDepartmentOptions([]);
      })
      .finally(() => {
        if (!cancelled) setDepartmentLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedCompanyId]);

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
    const departmentValue = getDepartmentForSubmit();
    if (!departmentValue) {
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
          name: name.trim(),
          phone: phone.trim(),
          companyName: companyName.trim(),
          companyAddress: companyAddress.trim(),
          companyAddressDetail: companyAddressDetail.trim(),
          companyDepartment: departmentValue,
          companyBusinessNumber: companyBusinessNumber.trim(),
          companyRepresentativeName: companyNeedsCreate ? companyRepresentativeName.trim() : '',
          createCompanyOnSave: companyNeedsCreate
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('crm_token', data.token);
        if (data.user) localStorage.setItem('crm_user', JSON.stringify(data.user));
        if (avatarFile) {
          try {
            const up = await tryUploadProfilePhoto(data.token, avatarFile);
            if (up?.user) localStorage.setItem('crm_user', JSON.stringify(up.user));
            else if (up?.avatar) {
              const prev = data.user ? { ...data.user, avatar: up.avatar } : { avatar: up.avatar };
              localStorage.setItem('crm_user', JSON.stringify(prev));
            }
          } catch (upErr) {
            console.warn('[register] profile photo:', upErr.message || upErr);
          }
        }
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
    const departmentValue = getDepartmentForSubmit();
    if (!departmentValue) {
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
        companyDepartment: departmentValue,
        companyBusinessNumber: companyBusinessNumber.trim(),
        companyRepresentativeName: companyNeedsCreate ? companyRepresentativeName.trim() : '',
        createCompanyOnSave: companyNeedsCreate
      };
      const res = await fetch(`${API_BASE}/auth/complete-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem('crm_token', data.token);
        if (data.user) localStorage.setItem('crm_user', JSON.stringify(data.user));
        if (avatarFile) {
          try {
            const up = await tryUploadProfilePhoto(data.token, avatarFile);
            if (up?.user) localStorage.setItem('crm_user', JSON.stringify(up.user));
            else if (up?.avatar) {
              const prev = data.user ? { ...data.user, avatar: up.avatar } : { avatar: up.avatar };
              localStorage.setItem('crm_user', JSON.stringify(prev));
            }
          } catch (upErr) {
            console.warn('[register] profile photo:', upErr.message || upErr);
          }
        }
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

  /** 헤더 — 큰 원형 미리보기 */
  const registerAvatarHeaderTap = (
    <div className="register-avatar-header-stack">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="register-avatar-input-hidden"
        onChange={onAvatarFileChange}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div
        className={`register-logo register-logo-avatar ${avatarDropActive ? 'is-dragover' : ''}`}
        onDragEnter={onAvatarDragEnter}
        onDragLeave={onAvatarDragLeave}
        onDragOver={onAvatarDragOver}
        onDrop={onAvatarDrop}
      >
        <button
          type="button"
          className="register-avatar-tap register-avatar-tap--header"
          onClick={() => avatarInputRef.current?.click()}
          aria-label="개인 사진 선택 또는 변경"
        >
          {avatarPreview ? (
            <img src={avatarPreview} alt="" className="register-avatar-preview" />
          ) : (
            <span className="register-avatar-placeholder-inner" aria-hidden>
              <span className="material-symbols-outlined">person</span>
            </span>
          )}
        </button>
      </div>
    </div>
  );

  if (mode === 'google-complete') {
    return (
      <div className="register-page">
        <div className="register-container">
          <div className="register-card">
            <div className="register-header">
              {registerAvatarHeaderTap}
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
                      <span className="material-symbols-outlined">hourglass_top</span>
                      검색으로 기존 회사로 바꾸면 승인 후 이용(권한 대기)될 수 있습니다. 회사 추가로 새 회사를 처음 등록하면 저장자에게 Owner가 부여됩니다.
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
                  <label htmlFor="reg-dept-select">부서명 *</label>
                  <select
                    id="reg-dept-select"
                    className="register-select"
                    value={departmentOptions.some((o) => String(o.id) === String(companyDepartment)) ? String(companyDepartment) : ''}
                    onChange={(e) => setCompanyDepartment(e.target.value)}
                    disabled={departmentLoading || departmentOptions.length === 0}
                  >
                    <option value="">
                      {departmentLoading ? '부서 목록 불러오는 중…' : (departmentOptions.length ? '부서 선택 (직접 입력도 가능)' : '부서 목록 없음 (직접 입력)')}
                    </option>
                    {departmentOptions.map((opt) => (
                      <option key={String(opt.id)} value={String(opt.id)}>{opt.label}</option>
                    ))}
                  </select>
                  <input
                    id="reg-dept"
                    type="text"
                    value={getDepartmentDisplayText()}
                    onChange={(e) => setCompanyDepartment(e.target.value)}
                    placeholder="직접 부서명 입력 가능"
                    required
                  />
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
              {registerAvatarHeaderTap}
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
                  <label htmlFor="form-dept-select">부서명 *</label>
                  <select
                    id="form-dept-select"
                    className="register-select"
                    value={departmentOptions.some((o) => String(o.id) === String(companyDepartment)) ? String(companyDepartment) : ''}
                    onChange={(e) => setCompanyDepartment(e.target.value)}
                    disabled={departmentLoading || departmentOptions.length === 0}
                  >
                    <option value="">
                      {departmentLoading ? '부서 목록 불러오는 중…' : (departmentOptions.length ? '부서 선택 (직접 입력도 가능)' : '부서 목록 없음 (직접 입력)')}
                    </option>
                    {departmentOptions.map((opt) => (
                      <option key={String(opt.id)} value={String(opt.id)}>{opt.label}</option>
                    ))}
                  </select>
                  <input
                    id="form-dept"
                    type="text"
                    value={getDepartmentDisplayText()}
                    onChange={(e) => setCompanyDepartment(e.target.value)}
                    placeholder="직접 부서명 입력 가능"
                    required
                  />
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
