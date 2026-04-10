import { useState, useEffect, useRef } from 'react';
import { getVisiblePageNumbers } from '@/lib/pagination-visible-pages';
import './list-pagination-buttons.css';

/**
 * first_page · chevron_left · 숫자(최대 5) · 현재 페이지 클릭 시 번호 입력+Enter · chevron_right · last_page
 */
export default function ListPaginationButtons({ page, totalPages: totalPagesProp, onPageChange }) {
  const totalPg = Math.max(1, Number(totalPagesProp) || 1);
  const [pageJumpOpen, setPageJumpOpen] = useState(false);
  const [pageJumpValue, setPageJumpValue] = useState('');
  const pageJumpInputRef = useRef(null);

  useEffect(() => {
    setPageJumpOpen(false);
  }, [page]);

  return (
    <div className="pagination-btns">
      <button
        type="button"
        className="pagination-btn"
        aria-label="첫 페이지"
        disabled={page <= 1}
        onClick={() => onPageChange(1)}
      >
        <span className="material-symbols-outlined">first_page</span>
      </button>
      <button
        type="button"
        className="pagination-btn"
        aria-label="이전 페이지"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <span className="material-symbols-outlined">chevron_left</span>
      </button>
      {getVisiblePageNumbers(page, totalPg).map((n) => {
        const isCurrent = page === n;
        if (isCurrent && pageJumpOpen) {
          return (
            <input
              key={`page-jump-${n}`}
              ref={pageJumpInputRef}
              type="text"
              name="page-jump"
              inputMode="numeric"
              autoComplete="off"
              aria-label="이동할 페이지 번호 입력 후 Enter"
              title="번호 입력 후 Enter로 이동"
              className="pagination-page-jump-input"
              value={pageJumpValue}
              onChange={(e) => setPageJumpValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const tp = totalPg;
                  const raw = pageJumpValue.trim();
                  if (!raw) {
                    setPageJumpOpen(false);
                    return;
                  }
                  let v = parseInt(raw, 10);
                  if (!Number.isFinite(v)) {
                    setPageJumpOpen(false);
                    return;
                  }
                  v = Math.min(Math.max(1, v), tp);
                  onPageChange(v);
                  setPageJumpOpen(false);
                } else if (e.key === 'Escape') {
                  setPageJumpOpen(false);
                }
              }}
              onBlur={() => setPageJumpOpen(false)}
            />
          );
        }
        return (
          <button
            key={n}
            type="button"
            className={`pagination-btn pagination-btn-num ${isCurrent ? 'active' : ''}`}
            aria-label={isCurrent ? `${n}페이지 · 클릭하여 번호 입력` : `${n}페이지`}
            aria-current={isCurrent ? 'page' : undefined}
            title={isCurrent ? '클릭 후 페이지 번호를 입력하고 Enter로 이동' : undefined}
            onClick={() => {
              if (isCurrent) {
                setPageJumpValue(String(page));
                setPageJumpOpen(true);
                queueMicrotask(() => {
                  pageJumpInputRef.current?.focus();
                  pageJumpInputRef.current?.select();
                });
              } else {
                onPageChange(n);
              }
            }}
          >
            {n}
          </button>
        );
      })}
      <button
        type="button"
        className="pagination-btn"
        aria-label="다음 페이지"
        disabled={page >= totalPg}
        onClick={() => onPageChange(page + 1)}
      >
        <span className="material-symbols-outlined">chevron_right</span>
      </button>
      <button
        type="button"
        className="pagination-btn"
        aria-label="마지막 페이지"
        disabled={page >= totalPg}
        onClick={() => onPageChange(totalPg)}
      >
        <span className="material-symbols-outlined">last_page</span>
      </button>
    </div>
  );
}
