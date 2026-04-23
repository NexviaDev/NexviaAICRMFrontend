import { useState, useEffect, useMemo, useCallback } from 'react';
import ListPaginationButtons from '@/components/list-pagination-buttons/list-pagination-buttons';

const PAGE_SIZE = 15;

function getOppFilterInstant(opp) {
  const raw = opp?.updatedAt || opp?.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 시작일·마감일(로컬 달력일의 0시~24시) 사이에 수정일/생성일이 들어가는지.
 * 날짜만 비교: 시작만 있으면 그날 0시 이후, 마감만 있으면 그날 끝까지, 둘 다 있으면 구간 포함.
 * 시작일 > 마감일로 넣은 경우 자동으로 끝점을 맞춥니다.
 */
function matchesDateRange(opp, dateStart, dateEnd) {
  if (!dateStart && !dateEnd) return true;
  const inst = getOppFilterInstant(opp);
  if (!inst) return false;
  const ms = inst.getTime();

  let startStr = dateStart;
  let endStr = dateEnd;
  if (startStr && endStr && startStr > endStr) {
    const t = startStr;
    startStr = endStr;
    endStr = t;
  }

  if (startStr) {
    const [y, m, d] = startStr.split('-').map(Number);
    const startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    if (ms < startMs) return false;
  }
  if (endStr) {
    const [y, m, d] = endStr.split('-').map(Number);
    const endMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    if (ms > endMs) return false;
  }
  return true;
}

/** 수정일/생성일이 해당 연-월(로컬 달력) 안에 있는지 */
function matchesMonth(opp, monthStr) {
  const s = String(monthStr || '').trim();
  if (!s) return true;
  const inst = getOppFilterInstant(opp);
  if (!inst) return false;
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return true;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (!y || mo < 1 || mo > 12) return false;
  const ms = inst.getTime();
  const startMs = new Date(y, mo - 1, 1, 0, 0, 0, 0).getTime();
  const endMs = new Date(y, mo, 0, 23, 59, 59, 999).getTime();
  return ms >= startMs && ms <= endMs;
}

function matchesLocalSearch(opp, q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return true;
  const hay = [
    opp?.title,
    opp?.contactName,
    opp?.customerCompanyName,
    opp?.productName,
    opp?.description
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  return hay.includes(t);
}

/**
 * Won / Lost / Abandoned 드롭존에서 연 기회 목록 — 검색·기간(시작~마감)·월별 필터·페이지당 15건
 */
export default function DropZoneListModal({
  stageKey,
  modalCfg,
  forecastPercent,
  items,
  onClose,
  onOpenEdit,
  onDelete,
  canViewAdminContent,
  onDragStart,
  onDragEnd,
  formatOppValue,
  dealTitlePrimaryLabel,
  renderOppNetMargin
}) {
  const [listSearch, setListSearch] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setListSearch('');
    setDateStart('');
    setDateEnd('');
    setFilterMonth('');
    setPage(1);
  }, [stageKey]);

  const filtered = useMemo(() => {
    return (items || []).filter(
      (opp) =>
        matchesLocalSearch(opp, listSearch) &&
        matchesDateRange(opp, dateStart, dateEnd) &&
        matchesMonth(opp, filterMonth)
    );
  }, [items, listSearch, dateStart, dateEnd, filterMonth]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = filtered.length === 0 ? 0 : Math.min(page * PAGE_SIZE, filtered.length);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSearchChange = useCallback((e) => {
    setListSearch(e.target.value);
    setPage(1);
  }, []);

  const handleDateStartChange = useCallback((e) => {
    setDateStart(e.target.value);
    setPage(1);
  }, []);

  const handleDateEndChange = useCallback((e) => {
    setDateEnd(e.target.value);
    setPage(1);
  }, []);

  const handleFilterMonthChange = useCallback((e) => {
    setFilterMonth(e.target.value);
    setPage(1);
  }, []);

  const clearDateRange = useCallback(() => {
    setDateStart('');
    setDateEnd('');
    setFilterMonth('');
    setPage(1);
  }, []);

  return (
    <div
      className="sp-dz-list-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-dz-list-modal-title"
      onClick={onClose}
    >
      <div className="sp-dz-list-modal sp-dz-list-modal--extended" onClick={(e) => e.stopPropagation()}>
        <div className={`sp-dz-list-modal-head ${modalCfg.colorClass}`}>
          <div className="sp-dz-list-modal-head-main">
            <span className="material-symbols-outlined sp-dz-list-modal-icon sp-dz-icon--fill" aria-hidden>
              {modalCfg.icon}
            </span>
            <div>
              <h2 id="sp-dz-list-modal-title" className="sp-dz-list-modal-title">
                {modalCfg.label}
              </h2>
              {Number.isFinite(forecastPercent) ? (
                <p className="sp-dz-list-modal-sub">Forecast {forecastPercent}%</p>
              ) : null}
            </div>
          </div>
          <button type="button" className="sp-dz-list-modal-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="sp-dz-list-modal-toolbar">
          <div className="sp-dz-list-modal-search-wrap">
            <span className="material-symbols-outlined sp-dz-list-modal-search-icon" aria-hidden>
              search
            </span>
            <input
              type="text"
              className="sp-dz-list-modal-search-input"
              placeholder="제목·회사·연락처·제품 검색…"
              value={listSearch}
              onChange={handleSearchChange}
              aria-label="목록 내 검색"
            />
          </div>
          <div className="sp-dz-list-modal-date-toolbar">
            <div className="sp-dz-list-modal-date-row">
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">시작일</span>
                <input
                  type="date"
                  className="sp-dz-list-modal-date-input"
                  value={dateStart}
                  onChange={handleDateStartChange}
                  aria-label="기간 시작일"
                />
              </label>
              <span className="sp-dz-list-modal-date-sep" aria-hidden>
                ~
              </span>
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">마감일</span>
                <input
                  type="date"
                  className="sp-dz-list-modal-date-input"
                  value={dateEnd}
                  onChange={handleDateEndChange}
                  aria-label="기간 마감일"
                />
              </label>
              <label className="sp-dz-list-modal-date-field">
                <span className="sp-dz-list-modal-date-field-label">월별</span>
                <input
                  type="month"
                  className="sp-dz-list-modal-date-input"
                  value={filterMonth}
                  onChange={handleFilterMonthChange}
                  aria-label="연·월로 필터"
                />
              </label>
              {(dateStart || dateEnd || filterMonth) ? (
                <button
                  type="button"
                  className="sp-dz-list-modal-date-clear"
                  onClick={clearDateRange}
                >
                  기간·월 초기화
                </button>
              ) : null}
            </div>
            <p className="sp-dz-list-modal-date-hint">
              기준: 마지막 수정일(없으면 등록일)입니다. 시작일·마감일·월별을 함께 쓰면 모두 만족할 때만 표시됩니다.
            </p>
          </div>
        </div>

        <div className="sp-dz-list-modal-body">
          {filtered.length === 0 ? (
            <p className="sp-dz-list-modal-empty">
              {items.length === 0 ? '표시할 기회가 없습니다.' : '조건에 맞는 기회가 없습니다.'}
            </p>
          ) : (
            pagedItems.map((opp) => (
              <div
                key={opp._id}
                className={`sp-card sp-dz-card ${modalCfg.colorClass}`}
                draggable
                onDragStart={(e) => onDragStart(e, opp._id)}
                onDragEnd={onDragEnd}
                onClick={() => onOpenEdit(opp._id)}
              >
                <div className="sp-card-top">
                  <h4 className="sp-card-title">
                    {dealTitlePrimaryLabel(opp) || '\u00A0'}-{opp.title || '\u00A0'}
                  </h4>
                  {canViewAdminContent ? (
                    <button
                      type="button"
                      className="sp-card-delete"
                      title="삭제"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(opp._id);
                      }}
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  ) : null}
                </div>
                {dealTitlePrimaryLabel(opp) !== String(opp.contactName || '').trim() ? (
                  <p className="sp-card-contact">{opp.contactName || '\u00A0'}</p>
                ) : null}
                <div className="sp-card-meta">
                  <div className="sp-card-value-col sp-card-value-col--dz">
                    <span className="sp-card-value">{formatOppValue(opp)}</span>
                    {canViewAdminContent ? renderOppNetMargin(opp) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {filtered.length > 0 ? (
          <div className="sp-dz-list-modal-footer">
            <p className="sp-dz-list-modal-page-info">
              <strong>{filtered.length}</strong>건 중 <strong>{rangeStart}</strong>–<strong>{rangeEnd}</strong>건
            </p>
            <ListPaginationButtons page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
