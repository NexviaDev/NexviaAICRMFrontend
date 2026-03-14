import { useState } from 'react';
import './add-company.css';

import { API_BASE } from '@/config';

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
    const rn = representativeName.trim();
    if (!n || !a || !ad || !bn || !rn) {
      if (setError) setError('회사명, 주소, 상세주소, 사업자 번호, 대표자 성함을 모두 입력해 주세요.');
      return;
    }
    setLoading(true);
    if (setError) setError('');
    try {
      const res = await fetch(`${API_BASE}/companies/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: n,
          address: a,
          addressDetail: ad,
          businessNumber: bn,
          representativeName: rn
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.name) {
        onSuccess({
          name: data.name,
          address: data.address || '',
          addressDetail: data.addressDetail || '',
          businessNumber: data.businessNumber || bn
        });
        handleClose();
      } else {
        if (setError) setError(data.error || '회사 추가에 실패했습니다.');
      }
    } catch (_) {
      if (setError) setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="add-company-overlay">
      <div className="add-company-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="add-company-title">회사 추가</h3>
        <p className="add-company-desc">등록된 회사 정보를 입력해 주세요. (전부 필수)</p>
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
            <input id="ac-business-number" type="text" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} placeholder="사업자 번호 (숫자 10자리)" required />
          </div>
          <div className="add-company-field">
            <label htmlFor="ac-representative">대표자 성함 *</label>
            <input id="ac-representative" type="text" value={representativeName} onChange={(e) => setRepresentativeName(e.target.value)} placeholder="대표자 성함" required />
          </div>
          <div className="add-company-actions">
            <button type="button" className="add-company-btn add-company-btn-cancel" onClick={handleClose}>취소</button>
            <button type="submit" className="add-company-btn add-company-btn-submit" disabled={loading}>{loading ? '추가 중...' : '추가'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
