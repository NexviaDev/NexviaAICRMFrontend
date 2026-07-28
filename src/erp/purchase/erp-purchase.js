import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { fetchErpPermissions, fetchErpList, formatMoneyDisplay } from '@/lib/erp-master-api';
import {
  fetchPurchaseList,
  createPurchaseDocument,
  postPurchaseCommand,
  createChildFromPo,
  newIdempotencyKey
} from '@/lib/erp-purchase-api';
import './erp-purchase.css';

const LIMIT = 20;

const TABS = [
  {
    key: 'purchase-orders',
    path: 'purchase-orders',
    label: '구매발주',
    statuses: { draft: '작성중', confirmed: '확정', closed: '종료', cancelled: '취소' }
  },
  {
    key: 'goods-receipts',
    path: 'goods-receipts',
    label: '입고',
    statuses: { draft: '작성중', confirmed: '입고완료', cancelled: '취소' }
  },
  {
    key: 'purchase-invoices',
    path: 'purchase-invoices',
    label: '매입',
    statuses: { draft: '작성중', issued: '확정', cancelled: '취소' }
  },
  {
    key: 'supplier-payments',
    path: 'supplier-payments',
    label: '지급',
    statuses: { draft: '작성중', confirmed: '지급완료', cancelled: '취소' }
  }
];

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ErpPurchase() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabKey = searchParams.get('doc') || 'purchase-orders';
  const tab = useMemo(() => TABS.find((t) => t.key === tabKey) || TABS[0], [tabKey]);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [partners, setPartners] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ partnerId: '', title: '', memo: '' });
  const reqRef = useRef(0);

  const canWrite = permissions.includes('purchase.write');

  useEffect(() => {
    fetchErpPermissions()
      .then((d) => setPermissions(Array.isArray(d.permissions) ? d.permissions : []))
      .catch(() => setPermissions([]));
    fetchErpList('business-partners', { status: 'active', limit: 200 })
      .then((d) => setPartners(Array.isArray(d.items) ? d.items : []))
      .catch(() => setPartners([]));
  }, []);

  const loadList = useCallback(async () => {
    const id = ++reqRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await fetchPurchaseList(tab.path, { page, limit: LIMIT });
      if (id !== reqRef.current) return;
      setRows(Array.isArray(data.items) ? data.items : []);
      setPagination(data.pagination || { page: 1, limit: LIMIT, total: 0, totalPages: 1 });
    } catch (err) {
      if (id !== reqRef.current) return;
      setRows([]);
      setError(err.message || '목록을 불러오지 못했습니다.');
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, [tab.path, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  function patchParams(mutator) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutator(next);
        return next;
      },
      { replace: true }
    );
  }

  async function runCommand(row, command, body = {}) {
    if (busyId) return;
    setBusyId(row._id);
    setError('');
    try {
      await postPurchaseCommand(tab.path, row._id, command, body, newIdempotencyKey());
      await loadList();
    } catch (err) {
      setError(err.message || '처리에 실패했습니다.');
    } finally {
      setBusyId('');
    }
  }

  async function handleCreatePo(e) {
    e.preventDefault();
    if (creating || !canWrite) return;
    setCreating(true);
    setError('');
    try {
      await createPurchaseDocument('purchase-orders', {
        partnerId: form.partnerId,
        title: form.title,
        memo: form.memo,
        lines: [
          {
            description: form.title || '구매 품목',
            quantity: '1',
            unitPrice: '0',
            discountRatePercent: 0
          }
        ]
      });
      setForm({ partnerId: '', title: '', memo: '' });
      patchParams((n) => {
        n.set('doc', 'purchase-orders');
        n.delete('page');
      });
      await loadList();
    } catch (err) {
      setError(err.message || '발주 등록에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  }

  async function createChild(row, kind) {
    if (busyId) return;
    setBusyId(row._id);
    setError('');
    try {
      await createChildFromPo(row._id, kind, {}, newIdempotencyKey());
      patchParams((n) => {
        n.set('doc', kind === 'receipt' ? 'goods-receipts' : 'purchase-invoices');
        n.delete('page');
      });
    } catch (err) {
      setError(err.message || '하위 문서 생성에 실패했습니다.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="page erp-purchase-page">
      <header className="page-header">
        <div className="erp-purchase-header-text">
          <h1 className="erp-purchase-title">구매</h1>
          <p className="page-desc">
            발주 → 입고(재고 증가) → 매입(채무) → 지급. 확정은 명령으로만 처리되며, 금액은 서버가 다시 계산합니다.
          </p>
        </div>
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
      <div className="erp-purchase-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`erp-purchase-tab${t.key === tab.key ? ' is-active' : ''}`}
            onClick={() =>
              patchParams((n) => {
                n.set('doc', t.key);
                n.delete('page');
              })
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {canWrite && tab.key === 'purchase-orders' ? (
        <form className="erp-purchase-create" onSubmit={handleCreatePo}>
          <select
            required
            value={form.partnerId}
            onChange={(e) => setForm((f) => ({ ...f, partnerId: e.target.value }))}
            disabled={creating}
          >
            <option value="">공급 거래처 선택</option>
            {partners.map((p) => (
              <option key={p._id} value={p._id}>
                {p.code ? `${p.code} · ${p.name}` : p.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="발주 제목"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            disabled={creating}
          />
          <button type="submit" className="erp-purchase-primary" disabled={creating}>
            {creating ? '등록 중…' : '발주 초안'}
          </button>
        </form>
      ) : null}

      {error ? <p className="erp-purchase-error">{error}</p> : null}

      <div className="erp-purchase-table-wrap">
        {loading ? (
          <p className="erp-purchase-muted">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="erp-purchase-muted">문서가 없습니다.</p>
        ) : (
          <table className="erp-purchase-table">
            <thead>
              <tr>
                <th>번호</th>
                <th>거래처</th>
                <th>일자</th>
                <th>상태</th>
                <th>금액</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td>{row.code}</td>
                  <td>{row.partnerSnapshot?.name || '-'}</td>
                  <td>{formatDate(row.documentDate || row.paymentDate)}</td>
                  <td>{tab.statuses[row.status] || row.status}</td>
                  <td>{formatMoneyDisplay(row.totalAmount || row.paidAmount || '0', row.currency)}</td>
                  <td className="erp-purchase-actions">
                    {canWrite && tab.key === 'purchase-orders' && row.status === 'draft' ? (
                      <button type="button" disabled={busyId === row._id} onClick={() => runCommand(row, 'confirm')}>
                        확정
                      </button>
                    ) : null}
                    {canWrite && tab.key === 'purchase-orders' && row.status === 'confirmed' ? (
                      <>
                        <button type="button" disabled={busyId === row._id} onClick={() => createChild(row, 'receipt')}>
                          입고
                        </button>
                        <button type="button" disabled={busyId === row._id} onClick={() => createChild(row, 'invoice')}>
                          매입
                        </button>
                      </>
                    ) : null}
                    {canWrite && tab.key === 'goods-receipts' && row.status === 'draft' ? (
                      <button type="button" disabled={busyId === row._id} onClick={() => runCommand(row, 'confirm')}>
                        입고확정
                      </button>
                    ) : null}
                    {canWrite && tab.key === 'purchase-invoices' && row.status === 'draft' ? (
                      <button type="button" disabled={busyId === row._id} onClick={() => runCommand(row, 'issue')}>
                        매입확정
                      </button>
                    ) : null}
                    {canWrite &&
                    ['draft'].includes(row.status) === false &&
                    row.status !== 'cancelled' &&
                    row.status !== 'closed' ? (
                      <button
                        type="button"
                        disabled={busyId === row._id}
                        onClick={() => runCommand(row, 'cancel', { reason: '사용자 취소' })}
                      >
                        취소
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ListPaginationButtons
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(nextPage) => {
          patchParams((n) => {
            if (nextPage <= 1) n.delete('page');
            else n.set('page', String(nextPage));
          });
        }}
      />
      </div>
    </div>
  );
}
