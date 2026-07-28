import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { fetchErpPermissions } from '@/lib/erp-master-api';
import {
  fetchSalesList,
  fetchSalesPicker,
  formatMoneyDisplay,
  formatDateDisplay
} from '@/lib/erp-sales-api';
import {
  SALES_TABS,
  DEFAULT_TAB_KEY,
  findSalesTab,
  labelOf,
  readPath,
  statusTone
} from './erp-sales-config';
import ErpSalesDocumentModal from './erp-sales-document-modal/erp-sales-document-modal';
import ErpSalesTraceModal from './erp-sales-trace-modal/erp-sales-trace-modal';
import ErpArAging from './erp-ar-aging/erp-ar-aging';
import './erp-sales.css';

const LIMIT = 20;
const TAB_PARAM = 'doc';
const MODAL_PARAM = 'modal';
const MODAL_DOCUMENT = 'document';
const MODAL_TRACE = 'trace';
const DETAIL_ID_PARAM = 'id';
const TRACE_ORDER_PARAM = 'traceOrderId';
const TRACE_OPPORTUNITY_PARAM = 'traceOpportunityId';
const NEW_RECORD_ID = 'new';

/** 탭을 바꿀 때 남으면 안 되는(스키마가 다른) 파라미터 */
const RESETTABLE_PARAMS = ['page', 'search', 'partnerId', 'dateFrom', 'dateTo'];

function renderCell(row, column) {
  const value = readPath(row, column.key);

  if (column.badge) {
    if (!value) return <span className="erp-sales-muted">-</span>;
    return (
      <span className={`erp-sales-row-badge is-${statusTone(value)}`}>{labelOf(column.badge, value)}</span>
    );
  }
  if (column.labels) return labelOf(column.labels, value);
  if (column.format === 'date') return formatDateDisplay(value);
  if (column.format === 'money') return formatMoneyDisplay(value, row.currency || '');
  return value === '' || value == null ? '-' : String(value);
}

export default function ErpSales() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tabKey = searchParams.get(TAB_PARAM) || DEFAULT_TAB_KEY;
  const tab = useMemo(() => findSalesTab(tabKey), [tabKey]);
  const isAnalytics = Boolean(tab.analytics);

  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const appliedSearch = searchParams.get('search') || '';
  const partnerFilter = searchParams.get('partnerId') || '';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  const modalParam = searchParams.get(MODAL_PARAM);
  const detailId = searchParams.get(DETAIL_ID_PARAM) || '';
  const traceOrderId = searchParams.get(TRACE_ORDER_PARAM) || '';
  const traceOpportunityId = searchParams.get(TRACE_OPPORTUNITY_PARAM) || '';

  const filterValues = useMemo(() => {
    const out = {};
    for (const filter of tab.filters || []) {
      const v = searchParams.get(filter.key);
      if (v) out[filter.key] = v;
    }
    return out;
  }, [tab, searchParams]);

  const [searchInput, setSearchInput] = useState(appliedSearch);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [partners, setPartners] = useState([]);

  const requestIdRef = useRef(0);

  const canWrite = permissions.includes('masterdata.write');
  const canDelete = permissions.includes('masterdata.delete');

  useEffect(() => {
    setSearchInput(appliedSearch);
  }, [appliedSearch, tab.key]);

  useEffect(() => {
    let cancelled = false;
    fetchErpPermissions()
      .then((data) => {
        if (!cancelled) setPermissions(Array.isArray(data.permissions) ? data.permissions : []);
      })
      .catch(() => {
        if (!cancelled) setPermissions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 거래처 필터 선택지 — 사용 중인 거래처만 */
  useEffect(() => {
    let cancelled = false;
    fetchSalesPicker('business-partners')
      .then((items) => {
        if (!cancelled) setPartners(items);
      })
      .catch(() => {
        if (!cancelled) setPartners([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadList = useCallback(async () => {
    if (isAnalytics) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setListError('');
    try {
      const data = await fetchSalesList(tab.path, {
        page,
        limit: LIMIT,
        search: appliedSearch,
        partnerId: partnerFilter,
        dateFrom,
        dateTo,
        ...filterValues
      });
      /** 탭·페이지를 빠르게 바꿀 때 이전 응답이 나중에 도착해 덮어쓰는 것을 막는다 */
      if (requestIdRef.current !== requestId) return;
      setRows(Array.isArray(data.items) ? data.items : []);
      setPagination(data.pagination || { page, limit: LIMIT, total: 0, totalPages: 1 });
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setRows([]);
      setListError(err.message || '목록을 불러오지 못했습니다.');
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [isAnalytics, tab.path, page, appliedSearch, partnerFilter, dateFrom, dateTo, filterValues]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const patchParams = useCallback(
    (changes, { replace = false } = {}) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value == null || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace }
      );
    },
    [setSearchParams]
  );

  /** 탭을 바꾸면 다른 스키마의 필터가 남지 않도록 초기화합니다 */
  const selectTab = (key) => setSearchParams({ [TAB_PARAM]: key });

  const submitSearch = (e) => {
    e.preventDefault();
    patchParams({ search: searchInput.trim(), page: 1 });
  };

  const resetFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of RESETTABLE_PARAMS) next.delete(key);
      for (const filter of tab.filters || []) next.delete(filter.key);
      return next;
    });
  };

  const openNew = () =>
    patchParams({ [MODAL_PARAM]: MODAL_DOCUMENT, [DETAIL_ID_PARAM]: NEW_RECORD_ID });

  const openDetail = (row) =>
    patchParams({ [MODAL_PARAM]: MODAL_DOCUMENT, [DETAIL_ID_PARAM]: row._id });

  const closeModal = useCallback(
    () => patchParams({ [MODAL_PARAM]: '', [DETAIL_ID_PARAM]: '' }, { replace: true }),
    [patchParams]
  );

  const openTrace = useCallback(
    ({ salesOrderId, salesOpportunityId }) =>
      patchParams({
        [MODAL_PARAM]: MODAL_TRACE,
        [TRACE_ORDER_PARAM]: salesOrderId || '',
        [TRACE_OPPORTUNITY_PARAM]: salesOpportunityId || ''
      }),
    [patchParams]
  );

  /** 추적을 닫으면 열려 있던 문서 모달로 돌아갑니다 */
  const closeTrace = useCallback(
    () =>
      patchParams(
        {
          [MODAL_PARAM]: detailId ? MODAL_DOCUMENT : '',
          [TRACE_ORDER_PARAM]: '',
          [TRACE_OPPORTUNITY_PARAM]: ''
        },
        { replace: true }
      ),
    [patchParams, detailId]
  );

  /** 추적에서 다른 종류의 문서를 열면 탭까지 함께 옮깁니다 */
  const openDocumentFromTrace = useCallback(
    (documentKey, id) => {
      setSearchParams({
        [TAB_PARAM]: documentKey,
        [MODAL_PARAM]: MODAL_DOCUMENT,
        [DETAIL_ID_PARAM]: id
      });
    },
    [setSearchParams]
  );

  /** 수정은 해당 행만 교체하고, 신규·삭제는 목록을 다시 계산합니다 */
  const handleSaved = useCallback(
    (saved, { created }) => {
      if (created) {
        void loadList();
        return;
      }
      setRows((prev) => prev.map((row) => (row._id === saved._id ? saved : row)));
    },
    [loadList]
  );

  const handleDeleted = useCallback(() => {
    void loadList();
  }, [loadList]);

  const documentModalOpen =
    !isAnalytics && modalParam === MODAL_DOCUMENT && Boolean(detailId) && !tab.analytics;
  const traceModalOpen = modalParam === MODAL_TRACE && Boolean(traceOrderId || traceOpportunityId);

  const hasActiveFilter =
    Boolean(appliedSearch || partnerFilter || dateFrom || dateTo) || Object.keys(filterValues).length > 0;

  return (
    <div className="page erp-sales-page">
      <header className="page-header">
        <div className="erp-sales-header-text">
          <h1 className="erp-sales-page-title">판매·수금</h1>
          <p className="page-desc">
            견적에서 시작해 판매주문·출고·매출·수금까지 하나의 원장으로 이어지는 ERP 판매 모듈입니다.
          </p>
        </div>
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
        <nav className="erp-sales-tabs" aria-label="판매 문서 종류">
          {SALES_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`erp-sales-tab ${item.key === tab.key ? 'is-active' : ''}`}
              aria-current={item.key === tab.key ? 'page' : undefined}
              onClick={() => selectTab(item.key)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <p className="erp-sales-tab-desc">{tab.description}</p>

        {!canWrite ? (
          <p className="erp-sales-readonly-note">
            조회 권한만 있어 등록·확정 버튼이 비활성화되어 있습니다. 관리자에게 문의해 주세요.
          </p>
        ) : null}

        {isAnalytics ? (
          <ErpArAging />
        ) : (
          <>
            <div className="erp-sales-toolbar">
              <form className="erp-sales-search-form" onSubmit={submitSearch}>
                <span className="material-symbols-outlined erp-sales-search-icon">search</span>
                <input
                  type="text"
                  name="erp-sales-search"
                  autoComplete="off"
                  placeholder={tab.searchPlaceholder || `${tab.label} 검색`}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                <button type="submit" className="btn-outline">
                  검색
                </button>
              </form>

              <div className="erp-sales-toolbar-actions">
                {tab.createEnabled ? (
                  <button type="button" className="btn-primary" disabled={!canWrite} onClick={openNew}>
                    <span className="material-symbols-outlined">add</span>
                    {tab.label} 등록
                  </button>
                ) : null}
              </div>
            </div>

            <div className="erp-sales-filters">
              {(tab.filters || []).map((filter) => (
                <label key={filter.key} className="erp-sales-filter">
                  <span className="erp-sales-filter-label">{filter.label}</span>
                  <select
                    value={filterValues[filter.key] || ''}
                    onChange={(e) => patchParams({ [filter.key]: e.target.value, page: 1 })}
                  >
                    <option value="">전체</option>
                    {filter.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              <label className="erp-sales-filter">
                <span className="erp-sales-filter-label">거래처</span>
                <select
                  value={partnerFilter}
                  onChange={(e) => patchParams({ partnerId: e.target.value, page: 1 })}
                >
                  <option value="">전체</option>
                  {partners.map((partner) => (
                    <option key={partner._id} value={partner._id}>
                      {partner.code} · {partner.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="erp-sales-filter">
                <span className="erp-sales-filter-label">시작일</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => patchParams({ dateFrom: e.target.value, page: 1 })}
                />
              </label>
              <label className="erp-sales-filter">
                <span className="erp-sales-filter-label">종료일</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => patchParams({ dateTo: e.target.value, page: 1 })}
                />
              </label>

              {hasActiveFilter ? (
                <button type="button" className="btn-outline erp-sales-reset" onClick={resetFilters}>
                  조건 초기화
                </button>
              ) : null}
            </div>

            {tab.createHint && !tab.createEnabled ? (
              <p className="erp-sales-hint">{tab.createHint}</p>
            ) : null}

            <div className="panel">
              <div className="table-wrap">
                <table className="data-table erp-sales-table">
                  <thead>
                    <tr>
                      {tab.columns.map((column) => (
                        <th
                          key={column.key}
                          style={column.width ? { width: column.width } : undefined}
                          className={column.align === 'right' ? 'is-right' : undefined}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={tab.columns.length} className="text-center erp-sales-table-state">
                          <span className="erp-spinner erp-spinner--dark" aria-hidden />
                          불러오는 중입니다…
                        </td>
                      </tr>
                    ) : listError ? (
                      <tr>
                        <td
                          colSpan={tab.columns.length}
                          className="text-center erp-sales-table-state erp-sales-table-error"
                        >
                          {listError}
                          <button type="button" className="btn-outline erp-sales-retry" onClick={() => loadList()}>
                            다시 시도
                          </button>
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td colSpan={tab.columns.length} className="text-center erp-sales-table-state">
                          {hasActiveFilter
                            ? '조건에 맞는 문서가 없습니다.'
                            : `등록된 ${tab.label} 문서가 없습니다.`}
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={row._id}
                          className="erp-sales-row"
                          tabIndex={0}
                          role="button"
                          onClick={() => openDetail(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openDetail(row);
                            }
                          }}
                        >
                          {tab.columns.map((column) => (
                            <td key={column.key} className={column.align === 'right' ? 'is-right' : undefined}>
                              {renderCell(row, column)}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pagination-bar">
                <p className="pagination-info">
                  전체 {pagination.total}건 · {pagination.page}/{pagination.totalPages} 페이지
                </p>
                <ListPaginationButtons
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={(next) => patchParams({ page: next })}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {documentModalOpen ? (
        <ErpSalesDocumentModal
          key={`${tab.key}-${detailId}`}
          documentConfig={tab}
          recordId={detailId === NEW_RECORD_ID ? null : detailId}
          canWrite={canWrite}
          canDelete={canDelete}
          onClose={closeModal}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onOpenTrace={openTrace}
        />
      ) : null}

      {traceModalOpen ? (
        <ErpSalesTraceModal
          salesOrderId={traceOrderId}
          salesOpportunityId={traceOpportunityId}
          onClose={closeTrace}
          onOpenDocument={openDocumentFromTrace}
        />
      ) : null}
    </div>
  );
}
