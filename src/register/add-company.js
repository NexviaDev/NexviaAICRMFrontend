import { useState } from 'react';
import './add-company.css';

/** 입력 중 사업자등록번호: 숫자만 받아 XXX-XX-XXXXX 형태로 표시 (최대 10자리) */
function formatBusinessNumberInput(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`;
}

/**
 * 회사 추가 모달 (회원가입 등에서 사용)
 * 회사명, 주소, 상세주소, 사업자 번호, 대표자 성함 필수
 */
export default function AddCompany({ isOpen, onClose, onSuccess, setError }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [representativeName, setRepresentativeName] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setName('');
    setAddress('');
    setAddressDetail('');
    setBusinessNumber('');
    setRepresentativeName('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const n = name.trim();
    const a = address.trim();
    const ad = addressDetail.trim();
    const bn = businessNumber.trim();
    const bnDigits = bn.replace(/\D/g, '');
    const rn = representativeName.trim();
    if (!n || !a || !ad || !bn || !rn) {
      if (setError) setError('회사명, 주소, 상세주소, 사업자 번호, 대표자 성함을 모두 입력해 주세요.');
      return;
    }
    if (bnDigits.length !== 10) {
      if (setError) setError('사업자 번호는 숫자 10자리를 입력해 주세요.');
      return;
    }
    if (setError) setError('');
    setLoading(true);
    try {
      onSuccess({
        name: n,
        address: a,
        addressDetail: ad,
        businessNumber: bn,
        representativeName: rn,
        isNewDraft: true
      });
      handleClose();
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="add-company-overlay">
      <div className="add-company-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-company-title">회사 추가</h3>
        <p className="add-company-desc">등록할 회사 정보를 입력해 주세요. (전부 필수)</p>
        <p className="add-company-desc">이 회사는 회원 정보 저장 시 함께 등록되며, 최초 저장자가 Owner 권한을 받습니다.</p>
        <form onSubmit={handleSubmit} className="add-company-form">
          <div className="add-company-field">
            <label htmlFor="ac-name">회사명 *</label>
            <input id="ac-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="회사명" required />
          </div>
          <div className="add-company-field">
            <label htmlFor="ac-address">주소 *</label>
            <input id="ac-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="주소" required />
          </div>
          <div className="add-company-field">
            <label htmlFor="ac-address-detail">상세주소 *</label>
            <input id="ac-address-detail" type="text" value={addressDetail} onChange={(e) => setAddressDetail(e.target.value)} placeholder="상세주소" required />
          </div>
          <div className="add-company-field">
            <label htmlFor="ac-business-number">사업자 번호 *</label>
            <input
              id="ac-business-number"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              value={businessNumber}
              onChange={(e) => setBusinessNumber(formatBusinessNumberInput(e.target.value))}
              placeholder="000-00-00000"
              required
            />
          </div>
          <div className="add-company-field">
            <label htmlFor="ac-representative">대표자 성함 *</label>
            <input id="ac-representative" type="text" value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} placeholder="대표자 성함" required />
          </div>
          <div className="add-company-actions">
            <button type="button" className="add-company-btn add-company-btn-cancel" onClick={handleClose}>취소</button>
            <button type="submit" className="add-company-btn add-company-btn-submit" disabled={loading}>{loading ? '확인 중...' : '추가'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
