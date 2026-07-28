import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchErpList } from '@/lib/erp-master-api';
import { newIdempotencyKey, postInventoryAdjust } from '@/lib/erp-inventory-api';
import './erp-inventory-adjust-modal.css';

/**
 * 수동 재고 조정 모달.
 * 오버레이 클릭으로 닫지 않음. URL 파라미터는 부모가 관리합니다.
 */
export default function ErpInventoryAdjustModal({ open, onClose, onSaved, warehouses, items }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const idemRef = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    idemRef.current = newIdempotencyKey();
    setWarehouseId(warehouses[0]?._id || warehouses[0]?.id || '');
    setItemId('');
    setQuantity('');
    setMemo('');
    setError('');
    setSaving(false);
  }, [open, warehouses]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await postInventoryAdjust(
        {
          warehouseId,
          itemId,
          quantity: String(quantity || '').trim(),
          memo: memo.trim()
        },
        idemRef.current
      );
      onSaved?.(result);
      onClose?.();
    } catch (err) {
      setError(err.message || '조정에 실패했습니다.');
      /** 실패 시 같은 키로 재시도 가능하도록(서버가 실패 기록을 지움) — 키 유지 */
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="erp-inv-adjust-overlay" role="presentation">
      <div
        className="erp-inv-adjust-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="erp-inv-adjust-title"
      >
        <header className="erp-inv-adjust-header">
          <h2 id="erp-inv-adjust-title">재고 조정</h2>
          <button type="button" className="erp-inv-adjust-close" onClick={onClose} disabled={saving} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form className="erp-inv-adjust-body" onSubmit={handleSubmit}>
          <p className="erp-inv-adjust-hint">
            양수는 입고성 증가, 음수는 출고성 감소입니다. 조정은 수불 원장에 남으며 삭제할 수 없습니다.
          </p>

          <label className="erp-inv-adjust-field">
            <span>창고</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required disabled={saving}>
              <option value="">선택</option>
              {(warehouses || []).map((w) => (
                <option key={w._id || w.id} value={w._id || w.id}>
                  {w.code ? `${w.code} · ${w.name}` : w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="erp-inv-adjust-field">
            <span>품목</span>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} required disabled={saving}>
              <option value="">선택</option>
              {(items || []).map((it) => (
                <option key={it._id || it.id} value={it._id || it.id}>
                  {it.code ? `${it.code} · ${it.name}` : it.name}
                </option>
              ))}
            </select>
          </label>

          <label className="erp-inv-adjust-field">
            <span>수량 (+/-)</span>
            <input
              type="text"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="예: 10 또는 -3"
              required
              disabled={saving}
            />
          </label>

          <label className="erp-inv-adjust-field">
            <span>사유</span>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={3} disabled={saving} />
          </label>

          {error ? <p className="erp-inv-adjust-error">{error}</p> : null}

          <footer className="erp-inv-adjust-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? (
                <>
                  <span className="erp-inv-spinner" aria-hidden />
                  처리 중…
                </>
              ) : (
                '조정 확정'
              )}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body
  );
}

/** 창고·재고품 선택지 로드 헬퍼 */
export async function loadAdjustPickers() {
  const [wh, items] = await Promise.all([
    fetchErpList('warehouses', { status: 'active', limit: 200 }),
    fetchErpList('items', { status: 'active', limit: 500 })
  ]);
  const warehouses = Array.isArray(wh.items) ? wh.items : Array.isArray(wh) ? wh : [];
  const allItems = Array.isArray(items.items) ? items.items : Array.isArray(items) ? items : [];
  return {
    warehouses,
    items: allItems.filter((it) => it.stockManaged !== false && it.itemType !== 'service')
  };
}
