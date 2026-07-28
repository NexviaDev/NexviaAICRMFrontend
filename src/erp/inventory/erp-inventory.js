import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { fetchErpPermissions, fetchErpList } from '@/lib/erp-master-api';
import { fetchInventoryBalances, fetchInventoryMovements } from '@/lib/erp-inventory-api';
import {
  INVENTORY_TABS,
  DEFAULT_TAB_KEY,
  findInventoryTab,
  labelOf,
  formatQtyDisplay,
  formatDateDisplay
} from './erp-inventory-config';
import ErpInventoryAdjustModal, {
  loadAdjustPickers
} from './erp-inventory-adjust-modal/erp-inventory-adjust-modal';
import './erp-inventory.css';

const LIMIT = 20;
const TAB_PARAM = 'view';
const MODAL_PARAM = 'modal';
const MODAL_ADJUST = 'adjust';

function renderCell(row, column) {
  const value = row[column.key];
  if (column.labels) return labelOf(column.labels, value);
  if (column.format === 'date') return formatDateDisplay(value);
  if (column.format === 'qty') return formatQtyDisplay(value);
  return value === '' || value == null ? '-' : String(value);
}

export default function ErpInventory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabKey = searchParams.get(TAB_PARAM) || DEFAULT_TAB_KEY;
  const tab = useMemo(() => findInventoryTab(tabKey), [tabKey]);
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const appliedSearch = searchParams.get('search') || '';
  const warehouseFilter = searchParams.get('warehouseId') || '';
  const lowStock = searchParams.get('lowStock') === '1';
  const modalParam = searchParams.get(MODAL_PARAM);

  const [searchInput, setSearchInput] = useState(appliedSearch);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: LIMIT, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [permissions, setPermissions] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [adjustPickers, setAdjustPickers] = useState({ warehouses: [], items: [] });
  const requestIdRef = useRef(0);

  const canAdjust = permissions.includes('inventory.adjust');

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

  useEffect(() => {
    let cancelled = false;
    fetchErpList('warehouses', { status: 'active', limit: 200 })
      .then((data) => {
        if (cancelled) return;
        setWarehouses(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setWarehouses([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadList = useCallback(async () => {
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setListError('');
    try {
      const params = {
        page,
        limit: LIMIT,
        search: appliedSearch,
        warehouseId: warehouseFilter
      };
      if (tab.key === 'balances' && lowStock) params.lowStock = '1';

      const data =
        tab.key === 'movements'
          ? await fetchInventoryMovements(params)
          : await fetchInventoryBalances(params);

      if (reqId !== requestIdRef.current) return;
      setRows(Array.isArray(data.items) ? data.items : []);
      setPagination(data.pagination || { page: 1, limit: LIMIT, total: 0, totalPages: 1 });
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setRows([]);
      setListError(err.message || '목록을 불러오지 못했습니다.');
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [tab.key, page, appliedSearch, warehouseFilter, lowStock]);

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

  function selectTab(key) {
    patchParams((next) => {
      next.set(TAB_PARAM, key);
      next.delete('page');
      next.delete('search');
      next.delete('lowStock');
      next.delete(MODAL_PARAM);
    });
  }

  function openAdjust() {
    loadAdjustPickers()
      .then((pickers) => setAdjustPickers(pickers))
      .catch(() => setAdjustPickers({ warehouses: [], items: [] }));
    patchParams((next) => next.set(MODAL_PARAM, MODAL_ADJUST));
  }

  function closeAdjust() {
    patchParams((next) => next.delete(MODAL_PARAM));
  }

  return (
    <div className="page erp-inventory-page">
      <header className="page-header">
        <div className="erp-inventory-header-text">
          <h1 className="erp-inventory-page-title">재고</h1>
          <p className="page-desc">창고·품목 현재고와 수불 원장입니다. 출고·입고 확정 시 자동으로 반영됩니다.</p>
        </div>
        <PageHeaderNotifyChat />
      </header>

      <div className="page-content">
      <div className="erp-inventory-tabs" role="tablist">
        {INVENTORY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab.key}
            className={`erp-inventory-tab${t.key === tab.key ? ' is-active' : ''}`}
            onClick={() => selectTab(t.key)}
          >
            <span className="material-symbols-outlined">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <p className="erp-inventory-tab-desc">{tab.description}</p>

      <div className="erp-inventory-toolbar">
        <form
          className="erp-inventory-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            patchParams((next) => {
              const q = searchInput.trim();
              if (q) next.set('search', q);
              else next.delete('search');
              next.delete('page');
            });
          }}
        >
          <span className="material-symbols-outlined">search</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tab.key === 'movements' ? '수불번호·품목·원천문서 검색' : '목록 검색은 수불 탭에서'}
            disabled={tab.key === 'balances'}
          />
        </form>

        <select
          className="erp-inventory-filter"
          value={warehouseFilter}
          onChange={(e) => {
            const v = e.target.value;
            patchParams((next) => {
              if (v) next.set('warehouseId', v);
              else next.delete('warehouseId');
              next.delete('page');
            });
          }}
        >
          <option value="">전체 창고</option>
          {warehouses.map((w) => (
            <option key={w._id} value={w._id}>
              {w.code ? `${w.code} · ${w.name}` : w.name}
            </option>
          ))}
        </select>

        {tab.key === 'balances' ? (
          <label className="erp-inventory-check">
            <input
              type="checkbox"
              checked={lowStock}
              onChange={(e) => {
                const on = e.target.checked;
                patchParams((next) => {
                  if (on) next.set('lowStock', '1');
                  else next.delete('lowStock');
                  next.delete('page');
                });
              }}
            />
            안전재고 이하만
          </label>
        ) : null}

        {canAdjust ? (
          <button type="button" className="erp-inventory-primary-btn" onClick={openAdjust}>
            <span className="material-symbols-outlined">tune</span>
            재고 조정
          </button>
        ) : null}
      </div>

      {listError ? <p className="erp-inventory-error">{listError}</p> : null}

      <div className="erp-inventory-table-wrap">
        {loading ? (
          <p className="erp-inventory-muted">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="erp-inventory-muted">표시할 내역이 없습니다. 기초 재고는 「재고 조정」으로 등록하세요.</p>
        ) : (
          <table className="erp-inventory-table">
            <thead>
              <tr>
                {tab.columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const low =
                  tab.key === 'balances' &&
                  Number(row.safetyStock) > 0 &&
                  Number(row.onHand) <= Number(row.safetyStock);
                return (
                  <tr key={row._id} className={low ? 'is-low-stock' : undefined}>
                    {tab.columns.map((col) => (
                      <td key={col.key}>{renderCell(row, col)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ListPaginationButtons
        page={pagination.page}
        totalPages={pagination.totalPages}
        onPageChange={(nextPage) => {
          patchParams((next) => {
            if (nextPage <= 1) next.delete('page');
            else next.set('page', String(nextPage));
          });
        }}
      />

      <ErpInventoryAdjustModal
        open={modalParam === MODAL_ADJUST}
        onClose={closeAdjust}
        warehouses={adjustPickers.warehouses.length ? adjustPickers.warehouses : warehouses}
        items={adjustPickers.items}
        onSaved={() => {
          loadList();
        }}
      />
      </div>
    </div>
  );
}
