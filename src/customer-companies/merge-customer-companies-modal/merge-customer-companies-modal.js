import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { geocodeAddressForCompanySave } from '@/lib/geocode-company-address';
import './merge-customer-companies-modal.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatBusinessNumberInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`;
}

const STATUS_OPTIONS = [
  { value: 'active', label: '활성' },
  { value: 'inactive', label: '비활성' },
  { value: 'lead', label: '리드' }
];

/**
 * 고객사 2곳 이상을 한 건으로 병합 (POST /api/customer-companies/merge)
 */
export default function MergeCustomerCompaniesModal({
  open,
  onClose,
  companies = [],
  onMerged
}) {
  const [name, setName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [industry, setIndustry] = useState('');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('active');
  const [memo, setMemo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** 모달이 열릴 때 자동 채운 주소 — 주소를 수정했는지 판별해 지오코딩 여부 결정 */
  const initialMergedAddressRef = useRef('');

  const list = Array.isArray(companies) ? companies : [];

  useEffect(() => {
    if (!open) return;
    const rows = Array.isArray(companies) ? companies : [];
    if (rows.length < 2) return;
    setError('');
    const first = rows[0] || {};
    setName(String(first.name || '').trim() || '병합 고객사');
    setBusinessNumber(formatBusinessNumberInput(first.businessNumber || ''));
    const rep = rows.map((c) => c.representativeName).find((r) => String(r || '').trim());
    setRepresentativeName(rep ? String(rep).trim() : '');
    const ind = rows.map((c) => c.industry).find((r) => String(r || '').trim());
    setIndustry(ind ? String(ind).trim() : '');
    const addr = rows.map((c) => c.address).find((r) => String(r || '').trim());
    const addrTrimmed = addr ? String(addr).trim() : '';
    initialMergedAddressRef.current = addrTrimmed;
    setAddress(addrTrimmed);
    const st = (first.status || 'active').toLowerCase();
    setStatus(['active', 'inactive', 'lead'].includes(st) ? st : 'active');
    setMemo('');
  }, [open, companies]);

  const handleSubmit = useCallback(async () => {
    if (list.length < 2) return;
    const mergedName = String(name || '').trim();
    if (!mergedName) {
      setError('병합 후 기업명을 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await pingBackendHealth(getAuthHeader);
      const sourceIds = list.map((c) => c._id).filter(Boolean);
      const addressTrimmed = address.trim();
      const addrMatch = addressTrimmed
        ? list.find((c) => String(c.address || '').trim() === addressTrimmed)
        : null;
      const seed = addrMatch || list[0] || {};
      let latitudeNum =
        seed.latitude != null && Number.isFinite(Number(seed.latitude)) ? Number(seed.latitude) : null;
      let longitudeNum =
        seed.longitude != null && Number.isFinite(Number(seed.longitude)) ? Number(seed.longitude) : null;
      /** add-company-modal과 동일: 주소만 있고 위·경도 없으면 geocode; 병합 폼에서 주소를 바꾼 경우에도 최종 주소 기준 */
      const needsGeocode =
        !!addressTrimmed &&
        (latitudeNum == null ||
          longitudeNum == null ||
          addressTrimmed !== (initialMergedAddressRef.current || ''));
      if (needsGeocode) {
        const coords = await geocodeAddressForCompanySave(addressTrimmed);
        if (coords?.latitude != null && coords?.longitude != null) {
          latitudeNum = coords.latitude;
          longitudeNum = coords.longitude;
        }
      }
      const body = {
        sourceIds,
        name: mergedName,
        businessNumber: businessNumber.replace(/\D/g, '') || undefined,
        representativeName: representativeName.trim() || undefined,
        industry: industry.trim() || undefined,
        address: addressTrimmed || undefined,
        latitude: latitudeNum != null ? latitudeNum : undefined,
        longitude: longitudeNum != null ? longitudeNum : undefined,
        status,
        memo: memo.trim() || undefined
      };
      const res = await fetch(`${API_BASE}/customer-companies/merge`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '병합에 실패했습니다.');
      }
      const next = data.company || data;
      if (next && next._id && onMerged) onMerged(next);
      onClose();
    } catch (e) {
      setError(e?.message || '병합에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }, [
    list,
    name,
    businessNumber,
    representativeName,
    industry,
    address,
    status,
    memo,
    onClose,
    onMerged
  ]);

  if (!open) return null;

  return (
    <div className="mccm-overlay" role="dialog" aria-modal="true" aria-labelledby="mccm-title">
      <div className="mccm-panel">
        <div className="mccm-head">
          <h2 id="mccm-title" className="mccm-title">고객사 병합</h2>
          <p className="mccm-lead">
            선택한 {list.length}곳을 하나의 고객사로 합칩니다. 직원(연락처), 업무 기록, 판매·캘린더 연결은 새 고객사로 옮기며,
            Google Drive가 연동된 경우 폴더도 가능한 범위에서 새 루트 아래로 모읍니다.
          </p>
          <p className="mccm-warning">
            병합 후에는 기존 고객사 카드가 삭제되며 되돌리기 어렵습니다. 기업명·사업자번호를 반드시 확인해 주세요.
          </p>
          <ul className="mccm-source-list">
            {list.map((c) => (
              <li key={String(c._id)}>
                {c.name || '—'}
                {c.businessNumber ? ` · 사업자 ${formatBusinessNumberInput(c.businessNumber)}` : ''}
              </li>
            ))}
          </ul>
        </div>

        <div className="mccm-form">
          <div className="mccm-field">
            <label htmlFor="mccm-name">병합 후 기업명 (필수)</label>
            <input
              id="mccm-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="organization"
            />
          </div>
          <div className="mccm-field">
            <label htmlFor="mccm-bn">사업자 등록번호</label>
            <input
              id="mccm-bn"
              type="text"
              inputMode="numeric"
              value={businessNumber}
              onChange={(e) => setBusinessNumber(formatBusinessNumberInput(e.target.value))}
              placeholder="10자리 숫자"
            />
            <p className="mccm-field-hint">합병 후 법인의 번호로 맞추면 다른 고객사와 중복되지 않는지 서버에서 검사합니다.</p>
          </div>
          <div className="mccm-field">
            <label htmlFor="mccm-rep">대표자</label>
            <input
              id="mccm-rep"
              type="text"
              value={representativeName}
              onChange={(e) => setRepresentativeName(e.target.value)}
            />
          </div>
          <div className="mccm-field">
            <label htmlFor="mccm-ind">업종</label>
            <input
              id="mccm-ind"
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
          </div>
          <div className="mccm-field">
            <label htmlFor="mccm-addr">주소</label>
            <input
              id="mccm-addr"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="mccm-field">
            <label htmlFor="mccm-status">상태</label>
            <select id="mccm-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="mccm-field">
            <label htmlFor="mccm-memo">메모 (비워 두면 기존 고객사 메모를 이어 붙입니다)</label>
            <textarea
              id="mccm-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={3}
            />
          </div>
          {error ? <p className="mccm-error" role="alert">{error}</p> : null}
        </div>

        <div className="mccm-actions">
          <button type="button" className="mccm-btn mccm-btn--ghost" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button type="button" className="mccm-btn mccm-btn--primary" onClick={handleSubmit} disabled={submitting || list.length < 2}>
            {submitting ? '병합 중…' : '병합 실행'}
          </button>
        </div>
      </div>
    </div>
  );
}
