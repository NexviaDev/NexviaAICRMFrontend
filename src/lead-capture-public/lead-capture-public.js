import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE, BACKEND_BASE_URL } from '@/config';
import './lead-capture-public.css';

function configUrl(secret) {
  const enc = encodeURIComponent(secret);
  if (BACKEND_BASE_URL) {
    return `${BACKEND_BASE_URL.replace(/\/$/, '')}/api/lead-capture-public/${enc}/config`;
  }
  return `${API_BASE}/lead-capture-public/${enc}/config`;
}

function webhookSubmitUrl(secret) {
  const enc = encodeURIComponent(secret);
  if (BACKEND_BASE_URL) {
    return `${BACKEND_BASE_URL.replace(/\/$/, '')}/api/lead-capture-webhook/${enc}`;
  }
  return `${API_BASE}/lead-capture-webhook/${enc}`;
}

function formatPhoneForSave(value) {
  if (value == null || value === '') return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length === 11 && digits.startsWith('010')) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 9 && digits.startsWith('2')) return `02-${digits.slice(1, 4)}-${digits.slice(4)}`;
  if (digits.length === 10 && digits.startsWith('01')) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length >= 9 && digits.length <= 11) return digits.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1-$2-$3');
  return digits;
}

/** 입력란용: 숫자만 반영하고 하이픈만 표시 (최대 11자리) */
function formatPhoneInput(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('82') && d.length > 2) d = `0${d.slice(2)}`.slice(0, 11);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}`;
  }
  if (d.startsWith('01')) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** 사업자등록번호: 숫자만, 10자리까지 XXX-XX-XXXXX */
function formatBusinessNumberInput(raw) {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 10);
  if (!d) return '';
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function formatBusinessNumberForSave(value) {
  const s = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (!s) return '';
  if (s.length <= 3) return s;
  if (s.length <= 5) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`;
}

function fieldChoices(def) {
  const o = def.options;
  if (!o) return [];
  if (Array.isArray(o.choices)) return o.choices;
  if (Array.isArray(o)) return o;
  return [];
}

/**
 * 임베드 HTML(`lead-capture-shared/lead-capture-embed-snippet.js`)과 동일하게
 * POST …/api/lead-capture-webhook/:secret 로 접수합니다. 공개 페이지는 API로 필드 정의를 받아
 * select·multiselect·checkbox 등을 지원하고, 임베드는 커스텀 필드를 주로 text 위주로 넣습니다.
 */
export default function LeadCapturePublic() {
  const { secret: secretParam } = useParams();
  const secret = secretParam ? decodeURIComponent(secretParam) : '';

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [formName, setFormName] = useState('');
  const [customDefs, setCustomDefs] = useState([]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [company, setCompany] = useState('');
  const [address, setAddress] = useState('');
  const [customValues, setCustomValues] = useState({});
  const [cardFile, setCardFile] = useState(null);
  const [cardFileDrag, setCardFileDrag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const cardFileInputRef = useRef(null);
  const cardFileId = useId();

  useEffect(() => {
    if (!secret) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(configUrl(secret))
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) {
            setNotFound(true);
            setLoading(false);
          }
          return null;
        }
        return r.json().catch(() => ({}));
      })
      .then((data) => {
        if (cancelled || !data) return;
        if (data.error || data.formName == null) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setFormName(data.formName || '문의');
        setCustomDefs(Array.isArray(data.customFields) ? data.customFields : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [secret]);

  const setCustom = useCallback((key, val) => {
    setCustomValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const acceptCardFile = useCallback((file) => {
    if (!file) return;
    const ok = file.type.startsWith('image/') || /\.pdf$/i.test(file.name);
    if (!ok) {
      setMessage({ type: 'err', text: '이미지 또는 PDF만 첨부할 수 있습니다.' });
      return;
    }
    setCardFile(file);
  }, []);

  const handleCardFileInputChange = useCallback((e) => {
    acceptCardFile(e.target.files?.[0] || null);
  }, [acceptCardFile]);

  const handleClearCardFile = useCallback(() => {
    setCardFile(null);
    if (cardFileInputRef.current) cardFileInputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setMessage(null);
    if (!secret) return;

    const nameTrim = String(name || '').trim();
    const emailTrim = String(email || '').trim();
    if (!nameTrim || !emailTrim) {
      setMessage({ type: 'err', text: '이름과 이메일을 입력해 주세요.' });
      return;
    }

    const extra = {};
    const phoneFmt = formatPhoneForSave(phone);
    if (phoneFmt) extra.phone = phoneFmt;
    const bnFmt = formatBusinessNumberForSave(businessNumber);
    if (bnFmt) extra.business_number = bnFmt;
    const co = String(company || '').trim();
    if (co) extra.company = co;
    const adr = String(address || '').trim();
    if (adr) extra.address = adr;

    for (const def of customDefs) {
      const k = def.key;
      const v = customValues[k];
      if (def.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
        setMessage({ type: 'err', text: `"${def.label || k}" 항목을 입력해 주세요.` });
        return;
      }
      if (v !== undefined && v !== null && v !== '') {
        if (def.type === 'multiselect' && Array.isArray(v)) extra[k] = v;
        else if (def.type === 'checkbox') extra[k] = !!v;
        else extra[k] = v;
      }
    }

    const sendJson = async (businessCardDataUrl) => {
      if (businessCardDataUrl) extra.business_card = businessCardDataUrl;
      const body = {
        name: nameTrim,
        email: emailTrim,
        source: 'public_link',
        customFields: extra
      };
      try {
        const res = await fetch(webhookSubmitUrl(secret), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setMessage({ type: 'ok', text: '등록되었습니다. 감사합니다.' });
          setName('');
          setEmail('');
          setPhone('');
          setBusinessNumber('');
          setCompany('');
          setAddress('');
          setCustomValues({});
          setCardFile(null);
          if (cardFileInputRef.current) cardFileInputRef.current.value = '';
        } else {
          setMessage({ type: 'err', text: data.error || '전송에 실패했습니다.' });
        }
      } catch (_) {
        setMessage({ type: 'err', text: '네트워크 오류로 전송하지 못했습니다.' });
      } finally {
        setSubmitting(false);
      }
    };

    setSubmitting(true);
    if (cardFile) {
      const reader = new FileReader();
      reader.onload = () => {
        sendJson(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => {
        setSubmitting(false);
        setMessage({ type: 'err', text: '첨부 파일을 읽지 못했습니다.' });
      };
      reader.readAsDataURL(cardFile);
    } else {
      await sendJson(null);
    }
  }, [secret, name, email, phone, businessNumber, company, address, customDefs, customValues, cardFile]);

  const customFieldInputs = useMemo(() => {
    return customDefs.map((def) => {
      const k = def.key;
      const choices = fieldChoices(def);
      const val = customValues[k];

      if (def.type === 'select' && choices.length) {
        return (
          <div key={k}>
            <div className="lead-form-custom-label">{def.label}{def.required ? ' *' : ''}</div>
            <select
              className="lead-form-select"
              required={!!def.required}
              value={val ?? ''}
              onChange={(e) => setCustom(k, e.target.value)}
            >
              <option value="">선택</option>
              {choices.map((c) => (
                <option key={String(c)} value={String(c)}>{String(c)}</option>
              ))}
            </select>
          </div>
        );
      }

      if (def.type === 'multiselect' && choices.length) {
        const selected = Array.isArray(val) ? val : [];
        return (
          <fieldset key={k} className="lead-form-fieldset">
            <legend>{def.label}{def.required ? ' *' : ''}</legend>
            <div className="lead-form-checklist">
              {choices.map((c) => {
                const id = `lcp-${k}-${String(c)}`;
                const on = selected.includes(c);
                return (
                  <label key={String(c)} htmlFor={id} className="lead-form-check">
                    <input
                      id={id}
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = on ? selected.filter((x) => x !== c) : [...selected, c];
                        setCustom(k, next);
                      }}
                    />
                    {String(c)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      }

      if (def.type === 'checkbox') {
        return (
          <label key={k} className="lead-form-checkbox-row">
            <input
              type="checkbox"
              checked={!!val}
              onChange={(e) => setCustom(k, e.target.checked)}
            />
            <span>{def.label}{def.required ? ' *' : ''}</span>
          </label>
        );
      }

      const inputType = def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text';
      return (
        <div key={k}>
          <div className="lead-form-custom-label">{def.label}{def.required ? ' *' : ''}</div>
          <input
            type={inputType}
            required={!!def.required}
            value={val ?? ''}
            onChange={(e) => setCustom(k, e.target.value)}
          />
        </div>
      );
    });
  }, [customDefs, customValues, setCustom]);

  if (loading) {
    return (
      <div className="lcp-page">
        <div className="lead-form-wrapper">
          <p className="lcp-muted">불러오는 중…</p>
        </div>
      </div>
    );
  }

  if (notFound || !secret) {
    return (
      <div className="lcp-page">
        <div className="lead-form-wrapper">
          <h1 className="lead-form-title">문의 폼</h1>
          <p className="lcp-muted">폼을 찾을 수 없거나 비활성 상태입니다. 링크를 확인해 주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lcp-page">
      <div className="lead-form-wrapper">
        <h1 className="lead-form-title">{formName}</h1>
        <p className="lead-form-sub-hint">아래 정보를 남겨 주시면 담당자가 연락드립니다.</p>
        <form className="lead-form" onSubmit={handleSubmit}>
          <input type="text" name="name" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} required />
          <input
            type="text"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            spellCheck={false}
            placeholder="연락처 (숫자만, 하이픈 자동)"
            maxLength={15}
            value={phone}
            onInput={(e) => setPhone(formatPhoneInput(e.currentTarget.value))}
          />
          <input type="email" name="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="text" name="company" placeholder="회사명" value={company} onChange={(e) => setCompany(e.target.value)} />
          <input
            type="text"
            name="business_number"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="사업자등록번호 (선택, 숫자만)"
            maxLength={12}
            value={businessNumber}
            onInput={(e) => setBusinessNumber(formatBusinessNumberInput(e.currentTarget.value))}
          />
          <input type="text" name="address" placeholder="회사 주소" value={address} onChange={(e) => setAddress(e.target.value)} />
          <div>
            <div className="lead-form-file-caption">명함 (이미지)</div>
            <div
              className={`lead-form-file-zone ${cardFileDrag ? 'lead-form-file-zone--drag' : ''} ${cardFile ? 'lead-form-file-zone--filled' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setCardFileDrag(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (e.currentTarget.contains(e.relatedTarget)) return;
                setCardFileDrag(false);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                e.preventDefault();
                setCardFileDrag(false);
                acceptCardFile(e.dataTransfer.files?.[0] || null);
              }}
            >
              <input
                ref={cardFileInputRef}
                id={cardFileId}
                className="lead-form-file-hidden"
                type="file"
                accept="image/*,.pdf"
                onChange={handleCardFileInputChange}
              />
              {!cardFile ? (
                <label htmlFor={cardFileId} className="lead-form-file-empty">
                  <span className="lead-form-file-illu" aria-hidden>
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
                      <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
                      <path
                        d="M3 17l5.5-5.5a1.2 1.2 0 011.7 0L14 15l3.5-3.5a1.2 1.2 0 011.7 0L21 14"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="lead-form-file-title">명함 이미지 첨부</span>
                  <span className="lead-form-file-hint">눌러서 선택하거나 파일을 여기에 놓기</span>
                  <span className="lead-form-file-badges">
                    <span>JPG</span>
                    <span>PNG</span>
                    <span>PDF</span>
                  </span>
                </label>
              ) : (
                <div className="lead-form-file-filled">
                  <span className="lead-form-file-check" aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </span>
                  <div className="lead-form-file-info">
                    <span className="lead-form-file-name" title={cardFile.name}>{cardFile.name}</span>
                    <span className="lead-form-file-meta">
                      {cardFile.size >= 1048576
                        ? `${(cardFile.size / 1048576).toFixed(2)} MB`
                        : `${(cardFile.size / 1024).toFixed(1)} KB`}
                    </span>
                  </div>
                  <div className="lead-form-file-actions">
                    <button type="button" className="lead-form-file-btn" onClick={() => cardFileInputRef.current?.click()}>
                      변경
                    </button>
                    <button type="button" className="lead-form-file-btn lead-form-file-btn-muted" onClick={handleClearCardFile}>
                      제거
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {customFieldInputs}
          {message && (
            <p className={message.type === 'ok' ? 'lead-form-msg lead-form-msg-ok' : 'lead-form-msg lead-form-msg-err'} role="status">
              {message.text}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? '전송 중…' : '문의 보내기'}
          </button>
        </form>
      </div>
    </div>
  );
}
