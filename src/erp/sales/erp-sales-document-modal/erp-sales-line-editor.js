import { estimateLineAmount, formatMoneyDisplay } from '@/lib/erp-sales-api';
import './erp-sales-line-editor.css';

/**
 * 판매 문서 라인 편집기.
 *
 * - 초안 상태에서만 편집할 수 있고 그 외 상태에서는 서버가 확정한 금액을 읽기 전용으로 보여줍니다.
 * - 화면의 금액은 **참고용 예상치**입니다. 저장하면 서버가 다시 계산한 값이 진실이 됩니다.
 *   그래서 프론트에서 계산한 합계는 서버로 보내지 않습니다.
 */

export function emptyLine() {
  return {
    itemId: '',
    itemName: '',
    description: '',
    quantity: '1',
    unitPrice: '0',
    discountRatePercent: '0',
    discountAmount: '0',
    taxCodeId: ''
  };
}

/** 서버 응답 라인 → 편집용 폼 라인 */
export function toFormLines(record) {
  const lines = Array.isArray(record?.lines) ? record.lines : [];
  return lines.map((line) => ({
    itemId: line.itemId ? String(line.itemId) : '',
    itemName: line.itemSnapshot?.name || '',
    description: line.description || '',
    quantity: line.quantity == null ? '' : String(line.quantity),
    unitPrice: line.unitPrice == null ? '' : String(line.unitPrice),
    discountRatePercent: String(line.discountRatePercent || 0),
    discountAmount: line.discountAmount == null ? '0' : String(line.discountAmount),
    taxCodeId: line.taxCodeId ? String(line.taxCodeId) : ''
  }));
}

/** 폼 라인 → 서버 입력 형식 (금액은 보내지 않습니다 — 서버가 계산합니다) */
export function toPayloadLines(formLines) {
  return (formLines || []).map((line) => ({
    itemId: line.itemId || null,
    itemName: line.itemName || '',
    description: line.description || '',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountRatePercent: Number(line.discountRatePercent || 0),
    discountAmount: line.discountAmount || '0',
    taxCodeId: line.taxCodeId || null
  }));
}

function ReadOnlyLines({ lines, currency }) {
  if (!lines || lines.length === 0) {
    return <p className="erp-line-empty">등록된 품목이 없습니다.</p>;
  }
  return (
    <div className="erp-line-scroll">
      <table className="erp-line-table">
        <thead>
          <tr>
            <th className="erp-line-no">#</th>
            <th>품목</th>
            <th className="is-right">수량</th>
            <th className="is-right">단가</th>
            <th className="is-right">할인</th>
            <th className="is-right">공급가액</th>
            <th className="is-right">세액</th>
            <th className="is-right">합계</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.lineNo}>
              <td className="erp-line-no">{line.lineNo}</td>
              <td>
                <span className="erp-line-name">{line.itemSnapshot?.name || line.description || '-'}</span>
                {line.itemSnapshot?.code ? (
                  <span className="erp-line-sub">{line.itemSnapshot.code}</span>
                ) : null}
                {line.taxCodeSnapshot?.name ? (
                  <span className="erp-line-sub">{line.taxCodeSnapshot.name}</span>
                ) : null}
              </td>
              <td className="is-right">{formatMoneyDisplay(line.quantity)}</td>
              <td className="is-right">{formatMoneyDisplay(line.unitPrice)}</td>
              <td className="is-right">{formatMoneyDisplay(line.lineDiscountAmount)}</td>
              <td className="is-right">{formatMoneyDisplay(line.netAmount)}</td>
              <td className="is-right">{formatMoneyDisplay(line.taxAmount)}</td>
              <td className="is-right erp-line-total">{formatMoneyDisplay(line.totalAmount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ErpSalesLineEditor({
  formLines,
  serverLines,
  readOnly,
  disabled,
  items,
  taxCodes,
  currency,
  onChange
}) {
  if (readOnly) return <ReadOnlyLines lines={serverLines} currency={currency} />;

  const setLine = (index, key, value) => {
    onChange(formLines.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  };

  /** 품목을 고르면 품목명을 함께 채웁니다 (미등록 품목은 이름만 직접 입력) */
  const selectItem = (index, itemId) => {
    const item = items.find((i) => String(i._id) === itemId);
    onChange(
      formLines.map((line, i) =>
        i === index
          ? {
              ...line,
              itemId,
              itemName: item ? item.name : line.itemName,
              unitPrice:
                item && item.standardPrice != null && (!line.unitPrice || line.unitPrice === '0')
                  ? String(item.standardPrice)
                  : line.unitPrice
            }
          : line
      )
    );
  };

  const addLine = () => onChange([...formLines, emptyLine()]);
  const removeLine = (index) => onChange(formLines.filter((_, i) => i !== index));

  return (
    <div className="erp-line-editor">
      <div className="erp-line-scroll">
        <table className="erp-line-table is-editable">
          <thead>
            <tr>
              <th className="erp-line-no">#</th>
              <th className="erp-line-col-item">품목</th>
              <th className="erp-line-col-qty">수량</th>
              <th className="erp-line-col-price">단가</th>
              <th className="erp-line-col-rate">할인율%</th>
              <th className="erp-line-col-price">차감액</th>
              <th className="erp-line-col-tax">세금구분</th>
              <th className="is-right erp-line-col-est">예상 공급가액</th>
              <th className="erp-line-col-remove" aria-label="삭제" />
            </tr>
          </thead>
          <tbody>
            {formLines.length === 0 ? (
              <tr>
                <td colSpan={9} className="erp-line-empty-cell">
                  품목을 한 줄 이상 추가해 주세요.
                </td>
              </tr>
            ) : (
              formLines.map((line, index) => {
                const estimate = estimateLineAmount(
                  line.quantity,
                  line.unitPrice,
                  line.discountRatePercent,
                  line.discountAmount
                );
                return (
                  <tr key={index}>
                    <td className="erp-line-no">{index + 1}</td>
                    <td>
                      <select
                        aria-label={`${index + 1}번 라인 품목`}
                        value={line.itemId}
                        disabled={disabled}
                        onChange={(e) => selectItem(index, e.target.value)}
                      >
                        <option value="">직접 입력</option>
                        {items.map((item) => (
                          <option key={item._id} value={item._id}>
                            {item.code} · {item.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        autoComplete="off"
                        aria-label={`${index + 1}번 라인 품목명`}
                        placeholder="품목명"
                        value={line.itemName}
                        disabled={disabled || Boolean(line.itemId)}
                        onChange={(e) => setLine(index, 'itemName', e.target.value)}
                      />
                      <input
                        type="text"
                        autoComplete="off"
                        aria-label={`${index + 1}번 라인 설명`}
                        placeholder="설명(선택)"
                        value={line.description}
                        disabled={disabled}
                        onChange={(e) => setLine(index, 'description', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${index + 1}번 라인 수량`}
                        value={line.quantity}
                        disabled={disabled}
                        onChange={(e) => setLine(index, 'quantity', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${index + 1}번 라인 단가`}
                        value={line.unitPrice}
                        disabled={disabled}
                        onChange={(e) => setLine(index, 'unitPrice', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${index + 1}번 라인 할인율`}
                        value={line.discountRatePercent}
                        disabled={disabled}
                        onChange={(e) => setLine(index, 'discountRatePercent', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${index + 1}번 라인 차감액`}
                        value={line.discountAmount}
                        disabled={disabled}
                        onChange={(e) => setLine(index, 'discountAmount', e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`${index + 1}번 라인 세금구분`}
                        value={line.taxCodeId}
                        disabled={disabled}
                        onChange={(e) => setLine(index, 'taxCodeId', e.target.value)}
                      >
                        <option value="">품목·기본값 사용</option>
                        {taxCodes.map((tax) => (
                          <option key={tax._id} value={tax._id}>
                            {tax.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="is-right erp-line-estimate">
                      {estimate == null ? '-' : formatMoneyDisplay(String(estimate), currency)}
                    </td>
                    <td className="erp-line-col-remove">
                      <button
                        type="button"
                        className="erp-line-remove"
                        aria-label={`${index + 1}번 라인 삭제`}
                        disabled={disabled}
                        onClick={() => removeLine(index)}
                      >
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="erp-line-actions">
        <button type="button" className="btn-outline" disabled={disabled} onClick={addLine}>
          <span className="material-symbols-outlined">add</span>
          품목 줄 추가
        </button>
        <p className="erp-line-note">
          표시된 금액은 참고용 예상치입니다. 할인·세액을 포함한 확정 금액은 저장 후 서버 계산 결과로 갱신됩니다.
        </p>
      </div>
    </div>
  );
}
