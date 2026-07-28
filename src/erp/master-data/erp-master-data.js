import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { pingBackendHealth } from '@/lib/backend-wake';
import {
  fetchErpList,
  fetchErpPermissions,
  fetchErpSyncStatus,
  runErpSync,
  formatBusinessNumberDisplay,
  formatMoneyDisplay
} from '@/lib/erp-master-api';
import { ERP_ENTITIES, DEFAULT_ENTITY_KEY, findEntity, labelOf } from './erp-master-config';
import ErpMasterDetailModal from './erp-master-detail-modal/erp-master-detail-modal';
import './erp-master-data.css';

const LIMIT = 20;
const MODAL_PARAM = 'modal';
const MODAL_DETAIL = 'detail';
const DETAIL_ID_PARAM = 'id';
const NEW_RECORD_ID = 'new';

/** 한 번 요청에 200건씩, 남은 건이 없을 때까지 반복 (Railway 요청 시간 제한 회피) */
const SYNC_BATCH_LIMIT = 200;
const SYNC_MAX_ROUNDS = 50;

function renderCell(row, column, entity) {
  const value = row[column.key];

  if (column.labels) return labelOf(column.labels, value);
  if (column.format === 'businessNumber') return formatBusinessNumberDisplay(value) || '-';
  if (column.format === 'money') return formatMoneyDisplay(value, row.currency || '');
  if (column.format === 'percent') return value == null ? '-' : `${value}%`;
  if (column.format === 'bool') {
    return value ? <span className="erp-chip erp-chip--on">기본</span> : <span className="erp-muted">-</span>;
  }
  if (column.badge) {
    const on = value === 'active';
    return (
      <span className={`erp-status-badge ${on ? 'is-active' : 'is-inactive'}`}>
        {on ? '사용' : '미사용'}
      </span>
    );
  }
  if (column.key === 'name' && entity.key === 'partners' && !row.businessNumber) {
    /** 사업자번호 없는 거래처는 목록에서 구분해 보여준다 (개인·미확인 거래처) */
    return (
      <span className="erp-name-cell">
        {value || '-'}
        <span className="erp-name-note">사업자번호 미등록</span>
      </span>
    );
  }
  return value === '' || value == null ? '-' : String(value);
}

export default function ErpMasterData() {
  const [searchParams, setSearchParams] = useSearchParams();

  const entityKey = searchParams.get('entity') || DEFAULT_ENTITY_KEY;
  const entity = useMemo(() => findEntity(entityKey), [entityKey]);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const appliedSearch = searchParams.get('search') || '';
  const modalParam = searchParams.get(MODAL_PARAM);
  const detailId = searchParams.get(DETAIL_ID_PARAM) || '';

  const filterValues = useMemo(() => {
    const out = {};
    for (const filter of entity.filters || []) {
      const v = searchParams.get(filter.key);
      if (v) out[filter.key] = v;
    }
    return out;
  }, [entity, searchParams]);

  const [searchInput, setSearchInput] = useState(appliedSearch);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const requestIdRef = useRef(0);

  const canWrite = permissions.includes('masterdata.write');
  const canDelete = permissions.includes('masterdata.delete');
  const canSync = permissions.includes('masterdata.sync');

  useEffect(() => {
    setSearchInput(appliedSearch);
  }, [appliedSearch, entity.key]);

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

  const loadList = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setListError('');
    try {
      const data = await fetchErpList(entity.path, {
        page,
        limit: LIMIT,
        search: appliedSearch,
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
  }, [entity.path, page, appliedSearch, filterValues]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  /** CRM 동기화 대상 건수 — 거래처·품목 탭에서만 */
  const loadSyncStatus = useCallback(async () => {
    if (!entity.crmSync) {
      setSyncStatus(null);
      return;
    }
    try {
      setSyncStatus(await fetchErpSyncStatus(entity.path));
    } catch {
      setSyncStatus(null);
    }
  }, [entity]);

  useEffect(() => {
    setSyncMessage('');
    void loadSyncStatus();
  }, [loadSyncStatus]);

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

  const selectEntity = (key) => {
    /** 탭을 바꾸면 페이지·검색·필터를 초기화한다 (다른 스키마의 필터가 남지 않도록) */
    setSearchParams({ entity: key });
  };

  const submitSearch = (e) => {
    e.preventDefault();
    patchParams({ search: searchInput.trim(), page: 1 });
  };

  const openNew = () => patchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: NEW_RECORD_ID });
  const openDetail = (row) => patchParams({ [MODAL_PARAM]: MODAL_DETAIL, [DETAIL_ID_PARAM]: row._id });
  const closeModal = useCallback(
    () => patchParams({ [MODAL_PARAM]: '', [DETAIL_ID_PARAM]: '' }, { replace: true }),
    [patchParams]
  );

  /** 저장 결과를 목록에 부분 반영 — 수정은 해당 행만 교체, 신규·삭제는 목록을 다시 계산 */
  const handleSaved = useCallback(
    (saved, { created }) => {
      if (created) {
        void loadList();
        void loadSyncStatus();
        return;
      }
      setRows((prev) => prev.map((row) => (row._id === saved._id ? saved : row)));
    },
    [loadList, loadSyncStatus]
  );

  const handleDeleted = useCallback(() => {
    void loadList();
    void loadSyncStatus();
  }, [loadList, loadSyncStatus]);

  const runSync = async (mode) => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage('가져오는 중입니다…');
    try {
      /** Railway 콜드 스타트(약 30초) 동안 첫 요청이 실패하지 않도록 먼저 깨운다 */
      await pingBackendHealth(() => ({}));

      const totals = { created: 0, updated: 0, skipped: 0 };
      const conflicts = [];
      let afterId = null;

      for (let round = 0; round < SYNC_MAX_ROUNDS; round += 1) {
        const result = await runErpSync(entity.path, { mode, limit: SYNC_BATCH_LIMIT, afterId });
        totals.created += result.created || 0;
        totals.updated += result.updated || 0;
        totals.skipped += result.skipped || 0;
        if (Array.isArray(result.conflicts)) conflicts.push(...result.conflicts);

        setSyncMessage(
          `가져오는 중… 신규 ${totals.created}건 · 갱신 ${totals.updated}건 (남은 ${result.remaining || 0}건)`
        );

        if (!result.nextAfterId) break;
        afterId = result.nextAfterId;
      }

      const conflictNote = conflicts.length
        ? ` · 확인 필요 ${conflicts.length}건 (${conflicts[0].reason})`
        : '';
      setSyncMessage(
        `완료 — 신규 ${totals.created}건 · 갱신 ${totals.updated}건 · 건너뜀 ${totals.skipped}건${conflictNote}`
      );
      await loadList();
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message || '가져오기에 실패했습니다.');
    } finally {
      setSyncing(false);
    }
  };

  const detailOpen = modalParam === MODAL_DETAIL && Boolean(detailId);

  return (
    <div className="page erp-master-page">
      <header className="page-header">
        <div className="erp-header-text">
          <h1 className="erp-page-title">기준정보</h1>
          <p className="page-desc">ERP 판매·구매·재고·회계가 공통으로 참조하는 마스터 데이터입니다.</p>
        </div>
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
        <nav className="erp-tabs" aria-label="기준정보 종류">
          {ERP_ENTITIES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`erp-tab ${item.key === entity.key ? 'is-active' : ''}`}
              aria-current={item.key === entity.key ? 'page' : undefined}
              onClick={() => selectEntity(item.key)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <p className="erp-entity-desc">{entity.description}</p>

        <div className="erp-toolbar">
          <form className="erp-search-form" onSubmit={submitSearch}>
            <span className="material-symbols-outlined erp-search-icon">search</span>
            <input
              type="text"
              name="erp-master-search"
              autoComplete="off"
              placeholder={`${entity.label} 코드·명칭 검색`}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn-outline">
              검색
            </button>
          </form>

          <div className="erp-filters">
            {(entity.filters || []).map((filter) => (
              <label key={filter.key} className="erp-filter">
                <span className="erp-filter-label">{filter.label}</span>
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
          </div>

          <div className="erp-toolbar-actions">
            {entity.crmSync && canSync ? (
              <>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={syncing}
                  onClick={() => runSync('insertOnly')}
                  title="아직 옮기지 않은 CRM 데이터만 추가합니다. 여러 번 실행해도 중복되지 않습니다."
                >
                  {syncing ? <span className="erp-spinner" aria-hidden /> : (
                    <span className="material-symbols-outlined">download</span>
                  )}
                  {entity.crmSync.label}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  disabled={syncing}
                  onClick={() => runSync('refresh')}
                  title="이미 연결된 항목의 CRM 출처 필드까지 최신 값으로 갱신합니다."
                >
                  최신화
                </button>
              </>
            ) : null}
            <button type="button" className="btn-primary" disabled={!canWrite} onClick={openNew}>
              <span className="material-symbols-outlined">add</span>
              {entity.label} 등록
            </button>
          </div>
        </div>

        {entity.crmSync && syncStatus ? (
          <p className="erp-sync-status">
            {entity.crmSync.sourceLabel} {syncStatus.crmTotal}건 중 {syncStatus.mappedTotal}건 연결됨 ·
            미연결 {syncStatus.unmappedTotal}건
            {syncMessage ? <span className="erp-sync-message"> — {syncMessage}</span> : null}
          </p>
        ) : null}

        {!canWrite ? (
          <p className="erp-readonly-note">
            조회 권한만 있어 등록·수정 버튼이 비활성화되어 있습니다. 관리자에게 문의해 주세요.
          </p>
        ) : null}

        <div className="panel">
          <div className="table-wrap">
            <table className="data-table erp-table">
              <thead>
                <tr>
                  {entity.columns.map((column) => (
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
                    <td colSpan={entity.columns.length} className="text-center erp-table-state">
                      <span className="erp-spinner erp-spinner--dark" aria-hidden />
                      불러오는 중입니다…
                    </td>
                  </tr>
                ) : listError ? (
                  <tr>
                    <td colSpan={entity.columns.length} className="text-center erp-table-state erp-table-error">
                      {listError}
                      <button type="button" className="btn-outline erp-retry" onClick={() => loadList()}>
                        다시 시도
                      </button>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={entity.columns.length} className="text-center erp-table-state">
                      {appliedSearch || Object.keys(filterValues).length
                        ? '조건에 맞는 자료가 없습니다.'
                        : `등록된 ${entity.label}이(가) 없습니다.`}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row._id}
                      className="erp-row"
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
                      {entity.columns.map((column) => (
                        <td key={column.key} className={column.align === 'right' ? 'is-right' : undefined}>
                          {renderCell(row, column, entity)}
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
      </div>

      {detailOpen ? (
        <ErpMasterDetailModal
          entity={entity}
          recordId={detailId === NEW_RECORD_ID ? null : detailId}
          canWrite={canWrite}
          canDelete={canDelete}
          onClose={closeModal}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : null}
    </div>
  );
}
