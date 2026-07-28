import { useEffect, useState } from 'react';
import { fetchSalesTrace, formatMoneyDisplay, formatDateDisplay } from '@/lib/erp-sales-api';
import {
  labelOf,
  statusTone,
  QUOTATION_STATUS_LABELS,
  SALES_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  SALES_INVOICE_STATUS_LABELS,
  RECEIPT_STATUS_LABELS,
  CREDIT_NOTE_STATUS_LABELS,
  AR_STATUS_LABELS,
  FULFILLMENT_STATUS_LABELS,
  INVOICE_PROGRESS_LABELS,
  RECEIPT_METHOD_LABELS,
  CREDIT_REASON_LABELS
} from '../erp-sales-config';
import './erp-sales-trace-modal.css';

/**
 * 리드 → 수금 추적 타임라인.
 * 영업기회 또는 판매주문을 기준으로 견적·주문·출고·매출·수금·대변전표를 한 화면에 모읍니다.
 * URL 파라미터(traceOrderId / traceOpportunityId)로 열리며 목록 없이 단독 조회합니다.
 */

function Badge({ value, labels }) {
  if (!value) return null;
  return <span className={`erp-trace-badge is-${statusTone(value)}`}>{labelOf(labels, value)}</span>;
}

function Stage({ icon, title, count, children, empty }) {
  return (
    <section className="erp-trace-stage">
      <div className="erp-trace-stage-head">
        <span className="material-symbols-outlined" aria-hidden>
          {icon}
        </span>
        <h3>{title}</h3>
        <span className="erp-trace-count">{count}건</span>
      </div>
      {count === 0 ? <p className="erp-trace-empty">{empty}</p> : <ul className="erp-trace-items">{children}</ul>}
    </section>
  );
}

export default function ErpSalesTraceModal({ salesOrderId, salesOpportunityId, onClose, onOpenDocument }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchSalesTrace(
      salesOpportunityId ? { salesOpportunityId } : { salesOrderId }
    )
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '추적 정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [salesOrderId, salesOpportunityId]);

  const open = (documentKey, id) => {
    if (typeof onOpenDocument === 'function') onOpenDocument(documentKey, String(id));
  };

  const summary = data?.summary;

  return (
    /** 오버레이 클릭으로 닫지 않습니다 (프로젝트 규칙) */
    <div className="erp-trace-overlay" role="presentation">
      <div className="erp-trace-modal" role="dialog" aria-modal="true" aria-labelledby="erp-trace-title">
        <div className="erp-trace-header">
          <div>
            <h2 className="erp-trace-title" id="erp-trace-title">
              리드 → 수금 추적
            </h2>
            <p className="erp-trace-subtitle">
              하나의 거래가 영업기회부터 수금까지 어떻게 이어졌는지 보여줍니다.
            </p>
          </div>
          <button type="button" className="erp-trace-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="erp-trace-body">
          {loading ? (
            <p className="erp-trace-loading">
              <span className="erp-spinner erp-spinner--dark" aria-hidden />
              불러오는 중입니다…
            </p>
          ) : error ? (
            <p className="erp-trace-error" role="alert">
              {error}
            </p>
          ) : !data ? null : (
            <>
              {summary ? (
                <dl className="erp-trace-summary">
                  <div>
                    <dt>매출 합계</dt>
                    <dd>{formatMoneyDisplay(summary.invoicedTotal, summary.currency)}</dd>
                  </div>
                  <div>
                    <dt>수금 합계</dt>
                    <dd>{formatMoneyDisplay(summary.paidTotal, summary.currency)}</dd>
                  </div>
                  <div>
                    <dt>대변 합계</dt>
                    <dd>{formatMoneyDisplay(summary.creditedTotal, summary.currency)}</dd>
                  </div>
                  <div className="is-strong">
                    <dt>미수 잔액</dt>
                    <dd>{formatMoneyDisplay(summary.outstandingTotal, summary.currency)}</dd>
                  </div>
                </dl>
              ) : null}

              {data.opportunity ? (
                <section className="erp-trace-stage">
                  <div className="erp-trace-stage-head">
                    <span className="material-symbols-outlined" aria-hidden>
                      flag
                    </span>
                    <h3>영업기회</h3>
                  </div>
                  <ul className="erp-trace-items">
                    <li>
                      <div className="erp-trace-item-main">
                        <strong>{data.opportunity.title || '제목 없음'}</strong>
                        {data.opportunity.stage ? (
                          <span className="erp-trace-chip">{data.opportunity.stage}</span>
                        ) : null}
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(data.opportunity.saleDate || data.opportunity.createdAt)}</span>
                        {data.opportunity.assignedToName ? <span>{data.opportunity.assignedToName}</span> : null}
                        <span className="erp-trace-amount">
                          {formatMoneyDisplay(
                            data.opportunity.value == null ? null : String(data.opportunity.value),
                            data.opportunity.currency || ''
                          )}
                        </span>
                      </div>
                    </li>
                  </ul>
                </section>
              ) : null}

              <Stage
                icon="request_quote"
                title="견적"
                count={(data.quotations || []).length}
                empty="연결된 견적이 없습니다."
              >
                {(data.quotations || []).map((item) => (
                  <li key={item._id}>
                    <button type="button" className="erp-trace-item-btn" onClick={() => open('quotations', item._id)}>
                      <div className="erp-trace-item-main">
                        <strong>{item.code}</strong>
                        <Badge value={item.status} labels={QUOTATION_STATUS_LABELS} />
                        {item.revision > 1 ? <span className="erp-trace-chip">{item.revision}차</span> : null}
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(item.documentDate)}</span>
                        <span className="erp-trace-amount">
                          {formatMoneyDisplay(item.totalAmount, item.currency)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </Stage>

              <Stage
                icon="shopping_cart"
                title="판매주문"
                count={(data.salesOrders || []).length}
                empty="연결된 판매주문이 없습니다."
              >
                {(data.salesOrders || []).map((item) => (
                  <li key={item._id}>
                    <button type="button" className="erp-trace-item-btn" onClick={() => open('sales-orders', item._id)}>
                      <div className="erp-trace-item-main">
                        <strong>{item.code}</strong>
                        <Badge value={item.status} labels={SALES_ORDER_STATUS_LABELS} />
                        <Badge value={item.fulfillmentStatus} labels={FULFILLMENT_STATUS_LABELS} />
                        <Badge value={item.invoiceStatus} labels={INVOICE_PROGRESS_LABELS} />
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(item.documentDate)}</span>
                        {item.partnerSnapshot?.name ? <span>{item.partnerSnapshot.name}</span> : null}
                        <span className="erp-trace-amount">
                          {formatMoneyDisplay(item.totalAmount, item.currency)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </Stage>

              <Stage
                icon="local_shipping"
                title="출고"
                count={(data.shipments || []).length}
                empty="아직 출고가 없습니다."
              >
                {(data.shipments || []).map((item) => (
                  <li key={item._id}>
                    <button type="button" className="erp-trace-item-btn" onClick={() => open('shipments', item._id)}>
                      <div className="erp-trace-item-main">
                        <strong>{item.code}</strong>
                        <Badge value={item.status} labels={SHIPMENT_STATUS_LABELS} />
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(item.documentDate)}</span>
                        {item.carrier ? <span>{item.carrier}</span> : null}
                        {item.trackingNumber ? <span>{item.trackingNumber}</span> : null}
                      </div>
                    </button>
                  </li>
                ))}
              </Stage>

              <Stage
                icon="receipt"
                title="매출"
                count={(data.salesInvoices || []).length}
                empty="아직 매출이 없습니다."
              >
                {(data.salesInvoices || []).map((item) => (
                  <li key={item._id}>
                    <button
                      type="button"
                      className="erp-trace-item-btn"
                      onClick={() => open('sales-invoices', item._id)}
                    >
                      <div className="erp-trace-item-main">
                        <strong>{item.code}</strong>
                        <Badge value={item.status} labels={SALES_INVOICE_STATUS_LABELS} />
                        <Badge value={item.arStatus} labels={AR_STATUS_LABELS} />
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(item.documentDate)}</span>
                        <span>수금예정 {formatDateDisplay(item.dueDate)}</span>
                        <span className="erp-trace-amount">
                          {formatMoneyDisplay(item.totalAmount, item.currency)} · 잔액{' '}
                          {formatMoneyDisplay(item.balanceAmount, item.currency)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </Stage>

              <Stage icon="payments" title="수금" count={(data.receipts || []).length} empty="아직 수금이 없습니다.">
                {(data.receipts || []).map((item) => (
                  <li key={item._id}>
                    <button type="button" className="erp-trace-item-btn" onClick={() => open('receipts', item._id)}>
                      <div className="erp-trace-item-main">
                        <strong>{item.code}</strong>
                        <Badge value={item.status} labels={RECEIPT_STATUS_LABELS} />
                        <span className="erp-trace-chip">{labelOf(RECEIPT_METHOD_LABELS, item.method)}</span>
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(item.receiptDate)}</span>
                        {(item.allocations || []).map((allocation, index) => (
                          <span key={index}>
                            {allocation.salesInvoiceCode || '배부'}{' '}
                            {formatMoneyDisplay(allocation.amount, item.currency)}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                ))}
              </Stage>

              <Stage
                icon="assignment_return"
                title="대변전표"
                count={(data.creditNotes || []).length}
                empty="발행된 대변전표가 없습니다."
              >
                {(data.creditNotes || []).map((item) => (
                  <li key={item._id}>
                    <button type="button" className="erp-trace-item-btn" onClick={() => open('credit-notes', item._id)}>
                      <div className="erp-trace-item-main">
                        <strong>{item.code}</strong>
                        <Badge value={item.status} labels={CREDIT_NOTE_STATUS_LABELS} />
                        <span className="erp-trace-chip">{labelOf(CREDIT_REASON_LABELS, item.reasonType)}</span>
                      </div>
                      <div className="erp-trace-item-meta">
                        <span>{formatDateDisplay(item.documentDate)}</span>
                        <span className="erp-trace-amount">
                          {formatMoneyDisplay(item.totalAmount, item.currency)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </Stage>
            </>
          )}
        </div>

        <div className="erp-trace-footer">
          <button type="button" className="btn-outline" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
