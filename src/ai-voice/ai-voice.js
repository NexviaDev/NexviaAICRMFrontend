import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import CustomerCompanySearchModal from '../customer-companies/customer-company-search-modal/customer-company-search-modal';
import CustomerCompanyEmployeesSearchModal from '../customer-company-employees/customer-company-employees-search-modal/customer-company-employees-search-modal';
import './ai-voice.css';

import { API_BASE } from '@/config';
import { getUserVisibleApiError } from '@/lib/api-error';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import { pingBackendHealth } from '@/lib/backend-wake';
import { AI_VOICE_LIST_POLL_MS } from '@/lib/polling-intervals';

/** 백엔드 단일 POST 상한과 동일 — 초과 시 청크 API로 나눔 */
const VOICE_DIRECT_UPLOAD_MAX_BYTES = 12 * 1024 * 1024;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatRecordingDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const dateStr = isToday ? '오늘' : isYesterday ? '어제' : date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return { dateStr, timeStr, full: `${dateStr} • ${timeStr}` };
}

function formatDuration(seconds) {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimestamp(ms) {
  if (ms == null) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 전사 사용량(초) → 표시용 */
function formatHoursMinutesShort(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return '—';
  const n = Math.max(0, Math.floor(Number(sec)));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

function formatMonthKeyLabel(monthKey) {
  if (!monthKey || typeof monthKey !== 'string') return '';
  const [y, mo] = monthKey.split('-');
  if (!y || !mo) return monthKey;
  return `${y}년 ${Number(mo)}월`;
}

const STATUS_MAP = {
  completed: { label: '완료', class: 'completed', icon: 'description' },
  processing: { label: '전사 중', class: 'transcribing', icon: 'sync' },
  queued: { label: '대기 중', class: 'transcribing', icon: 'schedule' },
  error: { label: '오류', class: 'error', icon: 'error' }
};

export default function AiVoice() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [listError, setListError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSplitStatus, setUploadSplitStatus] = useState('');
  const [uploadZoneDragOver, setUploadZoneDragOver] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [showSendToCompany, setShowSendToCompany] = useState(false);
  const [showSendToContact, setShowSendToContact] = useState(false);
  const [sendToLoading, setSendToLoading] = useState(false);
  const [sendToMessage, setSendToMessage] = useState('');
  const [usageStats, setUsageStats] = useState(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState('');
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);
  const navigate = useNavigate();

  /** 요약 텍스트를 문단·문장 단위로 나눠서 렌더용 배열로 반환 */
  function splitSummaryIntoBlocks(summaryText) {
    if (!summaryText || typeof summaryText !== 'string') return [];
    const trimmed = summaryText.trim();
    if (!trimmed) return [];
    const paragraphs = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    return paragraphs.map((para) => {
      const sentences = para.split(/(?<=[.!?。？！])\s+/).map((s) => s.trim()).filter(Boolean);
      return sentences.length ? sentences : [para];
    });
  }

  const fetchList = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) {
      setLoadingList(true);
      setListError('');
    }
    try {
      const q = new URLSearchParams();
      if (searchQuery.trim()) q.set('search', searchQuery.trim());
      q.set('limit', '50');
      const res = await fetch(`${API_BASE}/voice-recordings?${q}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '목록 조회 실패');
      setItems(data.items || []);
      setSelectedId((prev) => {
        if (!(data.items?.length)) return null;
        if (!prev) return data.items[0]._id;
        if (!data.items.find((i) => String(i._id) === String(prev))) return data.items[0]._id;
        return prev;
      });
    } catch (e) {
      if (!silent) {
        setListError(e.message);
        setItems([]);
      }
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [searchQuery]);

  const fetchUsage = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!silent) {
      setUsageLoading(true);
      setUsageError('');
    }
    try {
      const res = await fetch(`${API_BASE}/voice-recordings/usage-stats`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '사용량 조회 실패');
      setUsageStats(data);
    } catch (e) {
      if (!silent) {
        setUsageError(e.message || '사용량 조회 실패');
        setUsageStats(null);
      }
    } finally {
      if (!silent) setUsageLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    void fetchUsage();
  }, [fetchUsage]);

  const listHasPendingTranscription = useMemo(
    () => items.some((i) => i.status === 'processing' || i.status === 'queued'),
    [items]
  );

  /** 화면을 유지한 채 전사가 끝나도 목록·사용량이 갱신되도록 */
  useEffect(() => {
    if (!listHasPendingTranscription) return undefined;
    const t = setInterval(() => {
      void fetchList({ silent: true });
      void fetchUsage({ silent: true });
    }, AI_VOICE_LIST_POLL_MS);
    return () => clearInterval(t);
  }, [listHasPendingTranscription, fetchList, fetchUsage]);

  const fetchDetail = useCallback(async (id, opts = {}) => {
    const silent = opts.silent === true;
    if (!id) {
      setSelectedDetail(null);
      return;
    }
    if (!silent) setLoadingDetail(true);
    try {
      const res = await fetch(`${API_BASE}/voice-recordings/${id}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '조회 실패');
      setSelectedDetail(data);
      /** 상세에서 AssemblyAI 동기화된 status가 목록 행과 어긋나지 않도록 병합 */
      setItems((prev) =>
        prev.map((i) => (String(i._id) === String(id) ? { ...i, ...data } : i))
      );
      return data;
    } catch (e) {
      setSelectedDetail(null);
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  }, []);

  /** 브라우저·탭을 껐다 켠 뒤에도 목록/상세가 서버·AssemblyAI 반영 상태와 맞도록 */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      void fetchList({ silent: true });
      void fetchUsage({ silent: true });
      if (selectedId) void fetchDetail(selectedId, { silent: true });
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fetchList, fetchUsage, fetchDetail, selectedId]);

  useEffect(() => {
    setSummaryError('');
    if (selectedId) fetchDetail(selectedId);
    else setSelectedDetail(null);
  }, [selectedId, fetchDetail]);

  useEffect(() => {
    if (selectedDetail?.status !== 'processing' && selectedDetail?.status !== 'queued') return;
    const id = selectedDetail._id;
    pollRef.current = setInterval(() => {
      fetch(`${API_BASE}/voice-recordings/${id}`, { headers: getAuthHeader() })
        .then((r) => r.json())
        .then((data) => {
          setSelectedDetail(data);
          if (data.status === 'completed' || data.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current);
            setItems((prev) =>
              prev.map((i) => (String(i._id) === String(id) ? { ...i, ...data } : i))
            );
            if (data.status === 'completed') void fetchUsage({ silent: true });
          }
        })
        .catch(() => {});
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedDetail?._id, selectedDetail?.status, fetchUsage]);

  const uploadQuotaExceeded = useMemo(() => {
    if (!usageStats?.limitSeconds) return false;
    return usageStats.remainingSeconds <= 0 || usageStats.usedSeconds >= usageStats.limitSeconds;
  }, [usageStats]);

  const handleUploadClick = () => {
    if (uploadQuotaExceeded) return;
    fileInputRef.current?.click();
  };

  const uploadFiles = async (fileList) => {
    if (uploadQuotaExceeded) {
      setUploadError('이번 달 전사 사용 한도(40시간)에 도달했습니다. 다음 달에 다시 이용해 주세요.');
      return;
    }
    const files = Array.from(fileList || []).filter((f) => f && f instanceof File);
    if (!files.length) return;
    const accept = /\.(mp3|wav|m4a|webm)$/i;
    const audioTypes = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'];
    const allowed = files.filter((f) => accept.test(f.name) || audioTypes.includes(f.type));
    if (allowed.length === 0) {
      setUploadError('MP3, WAV, M4A, WebM 파일만 업로드할 수 있습니다.');
      return;
    }
    setUploadError('');
    setUploadSplitStatus('');
    setUploading(true);
    try {
      await pingBackendHealth(getAuthHeader);
      for (const file of allowed) {
        const baseTitle = file.name.replace(/\.[^.]+$/, '') || '녹음';
        let data;

        const uploadChunked = async () => {
          const s = await fetch(`${API_BASE}/voice-recordings/chunked/session`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              totalBytes: file.size,
              mimeType: file.type || ''
            })
          });
          const sData = await s.json().catch(() => ({}));
          if (!s.ok) throw new Error(sData.error || '분할 업로드 준비 실패');
          const { sessionId, chunkSizeBytes } = sData;
          if (!sessionId || !Number(chunkSizeBytes)) throw new Error('분할 업로드 준비 실패');

          const totalChunks = Math.max(1, Math.ceil(file.size / chunkSizeBytes));
          let offset = 0;
          let chunkIdx = 0;
          while (offset < file.size) {
            chunkIdx += 1;
            setUploadSplitStatus(`긴 파일 분할 전송 ${chunkIdx}/${totalChunks}…`);
            const end = Math.min(offset + chunkSizeBytes, file.size);
            const slice = file.slice(offset, end);
            const form = new FormData();
            form.append('chunk', slice, file.name);
            form.append('offset', String(offset));
            const r = await fetch(`${API_BASE}/voice-recordings/chunked/${encodeURIComponent(sessionId)}/chunk`, {
              method: 'POST',
              headers: getAuthHeader(),
              body: form
            });
            const rData = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(rData.error || '조각 전송 실패');
            offset = Number(rData.receivedBytes) || offset + slice.size;
            if (rData.done || offset >= file.size) break;
          }

          setUploadSplitStatus('서버에서 전사 요청 중…');
          const done = await fetch(`${API_BASE}/voice-recordings/chunked/${encodeURIComponent(sessionId)}/complete`, {
            method: 'POST',
            headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: baseTitle })
          });
          const doneData = await done.json().catch(() => ({}));
          if (!done.ok) {
            if (done.status === 403 && doneData.code === 'TRANSCRIPTION_QUOTA_EXCEEDED') {
              void fetchUsage({ silent: true });
            }
            throw new Error(doneData.error || '등록 실패');
          }
          return doneData;
        };

        if (file.size > VOICE_DIRECT_UPLOAD_MAX_BYTES) {
          data = await uploadChunked();
        } else {
          const form = new FormData();
          form.append('audio', file);
          form.append('title', baseTitle);
          const res = await fetch(`${API_BASE}/voice-recordings`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: form
          });
          let resData = await res.json().catch(() => ({}));
          if (!res.ok && res.status === 413 && resData.useChunkedUpload) {
            data = await uploadChunked();
          } else if (!res.ok) {
            if (res.status === 403 && resData.code === 'TRANSCRIPTION_QUOTA_EXCEEDED') {
              void fetchUsage({ silent: true });
            }
            if (res.status === 413 || resData.code === 'FILE_TOO_LARGE') {
              throw new Error(resData.error || '파일이 허용 크기를 초과했습니다.');
            }
            throw new Error(resData.error || '업로드 실패');
          } else {
            data = resData;
          }
        }

        setItems((prev) => [data, ...prev]);
        setSelectedId(data._id);
        setSelectedDetail(data);
        setUploadSplitStatus('');
      }
      await fetchList();
      await fetchUsage({ silent: true });
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
      setUploadSplitStatus('');
    }
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    uploadFiles(files);
    e.target.value = '';
  };

  const handleUploadDragOver = (e) => {
    if (uploadQuotaExceeded) return;
    e.preventDefault();
    e.stopPropagation();
    setUploadZoneDragOver(true);
  };

  const handleUploadDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) setUploadZoneDragOver(false);
  };

  const handleUploadDrop = (e) => {
    if (uploadQuotaExceeded) return;
    e.preventDefault();
    e.stopPropagation();
    setUploadZoneDragOver(false);
    const files = e.dataTransfer?.files;
    if (files?.length) uploadFiles(files);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setSearchQuery(searchInput.trim());
  };

  const handleDelete = async (id) => {
    if (!window.confirm('이 음성 기록을 삭제할까요?')) return;
    try {
      const res = await fetch(`${API_BASE}/voice-recordings/${id}`, { method: 'DELETE', headers: getAuthHeader() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '삭제 실패');
      }
      setItems((prev) => prev.filter((i) => i._id !== id));
      if (selectedId === id) {
        const next = items.find((i) => i._id !== id);
        setSelectedId(next?._id || null);
        setSelectedDetail(null);
      }
      void fetchUsage({ silent: true });
    } catch (e) {
      alert(e.message);
    }
  };

  const handleExportTranscript = () => {
    if (!selectedDetail?.transcriptText && !selectedDetail?.utterances?.length) return;
    const text = selectedDetail.utterances?.length
      ? selectedDetail.utterances.map((u) => `[${u.speaker}] ${u.text}`).join('\n\n')
      : selectedDetail.transcriptText;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${selectedDetail.title || '전사록'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleRequestSummary = async () => {
    if (!selectedDetail?._id || summaryLoading) return;
    const hasTranscript = selectedDetail.transcriptText || (selectedDetail.utterances?.length > 0);
    if (!hasTranscript) return;
    setSummaryError('');
    setSummaryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/voice-recordings/${selectedDetail._id}/summarize`, {
        method: 'POST',
        headers: getAuthHeader()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '요약 생성 실패');
      setSelectedDetail((prev) => (prev ? { ...prev, summary: data.summary } : null));
    } catch (e) {
      setSummaryError(e.message);
    } finally {
      setSummaryLoading(false);
    }
  };

  /** 기록일지 보내기 시 전달 내용: AI 요약만 */
  const getPayloadForSend = () => (selectedDetail?.summary || '').trim();

  const handleSendToCompany = async (company) => {
    if (!company?._id || !selectedDetail?.summary) return;
    setSendToMessage('');
    setSendToLoading(true);
    try {
      const res = await fetch(`${API_BASE}/customer-companies/${company._id}`, { headers: getAuthHeader() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getUserVisibleApiError(data, '고객사 조회 실패'));
      const existingMemo = data.memo != null ? String(data.memo).trim() : '';
      const newMemo = existingMemo ? `${existingMemo}\n\n${getPayloadForSend()}` : getPayloadForSend();
      const patchRes = await fetch(`${API_BASE}/customer-companies/${company._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ memo: newMemo })
      });
      const patchData = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok) throw new Error(getUserVisibleApiError(patchData, '고객사 메모 저장 실패'));
      setSendToMessage(`"${company.name || '고객사'}" 메모에 추가했습니다.`);
      setShowSendToCompany(false);
    } catch (e) {
      setSendToMessage(e.message || '저장 실패');
    } finally {
      setSendToLoading(false);
    }
  };

  const handleSendToContact = async (contact) => {
    if (!contact?._id || !selectedDetail?.summary) return;
    setSendToMessage('');
    setSendToLoading(true);
    try {
      const res = await fetch(`${API_BASE}/customer-company-employees/${contact._id}/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ content: getPayloadForSend() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '일지 저장 실패');
      setSendToMessage(`"${contact.name || '연락처'}" 일지에 추가했습니다.`);
      setShowSendToContact(false);
    } catch (e) {
      setSendToMessage(e.message || '저장 실패');
    } finally {
      setSendToLoading(false);
    }
  };

  const handleSendToMeeting = () => {
    if (!selectedDetail?.summary) return;
    navigate('/meeting-minutes?modal=add', {
      state: {
        fromAiVoice: true,
        title: selectedDetail?.title || '음성 기록 요약',
        discussionPoints: getPayloadForSend()
      }
    });
  };

  const selected = items.find((r) => r._id === selectedId);
  const statusInfo = selectedDetail ? STATUS_MAP[selectedDetail.status] || STATUS_MAP.queued : null;

  return (
    <div className="ai-voice-page">
      <header className="ai-voice-header">
        <h2 className="ai-voice-header-title">AI 음성 기록</h2>
        <div className="ai-voice-header-actions">
          <form className="ai-voice-search-wrap" onSubmit={handleSearchSubmit}>
            <span className="material-symbols-outlined ai-voice-search-icon">search</span>
            <input
              type="text"
              className="ai-voice-search"
              placeholder="녹음 검색..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="녹음 검색"
            />
          </form>
          <button
            type="button"
            className="ai-voice-btn ai-voice-btn-primary"
            title={uploadQuotaExceeded ? '이번 달 전사 한도(40시간) 초과' : '새 녹음'}
            onClick={handleUploadClick}
            disabled={uploading || uploadQuotaExceeded}
          >
            <span className="material-symbols-outlined">add</span>
            <span>
              {uploading ? uploadSplitStatus || '업로드 중…' : uploadQuotaExceeded ? '한도 도달' : '새 녹음'}
            </span>
          </button>
          <PageHeaderNotifyChat buttonClassName="ai-voice-icon-btn" wrapperClassName="ai-voice-header-notify-chat" />
        </div>
      </header>

      <div className="ai-voice-body">
        <aside className="ai-voice-side">
          <div className="ai-voice-usage-section">
            <div className="ai-voice-usage-head">
              <span className="material-symbols-outlined" aria-hidden>
                analytics
              </span>
              <span className="ai-voice-usage-head-title">전사 사용량</span>
            </div>
            {usageLoading && !usageStats ? (
              <div className="ai-voice-usage-skeleton" aria-busy="true" aria-label="이번 달 전사 사용량 불러오는 중">
                <div className="ai-voice-usage-skeleton-row">
                  <span className="ai-voice-usage-skeleton-chip" />
                  <span className="ai-voice-usage-skeleton-chip ai-voice-usage-skeleton-chip--wide" />
                  <span className="ai-voice-usage-skeleton-chip ai-voice-usage-skeleton-chip--mid" />
                </div>
                <div className="ai-voice-usage-skeleton-bar" />
                <div className="ai-voice-usage-skeleton-note" />
              </div>
            ) : null}
            {usageError ? <p className="ai-voice-usage-err">{usageError}</p> : null}
            {usageStats ? (
              <>
                <p className="ai-voice-usage-current">
                  <span className="ai-voice-usage-current-label">{formatMonthKeyLabel(usageStats.currentMonthKey)}</span>
                  <span className="ai-voice-usage-current-value">
                    {formatHoursMinutesShort(usageStats.usedSeconds)} / {formatHoursMinutesShort(usageStats.limitSeconds)}
                  </span>
                  <span className="ai-voice-usage-current-remain">
                    남음 <strong>{formatHoursMinutesShort(usageStats.remainingSeconds)}</strong>
                  </span>
                </p>
                <div className="ai-voice-usage-bar-wrap" aria-hidden>
                  <div
                    className={`ai-voice-usage-bar-fill ${uploadQuotaExceeded ? 'ai-voice-usage-bar-fill--full' : ''}`}
                    style={{
                      width: `${Math.min(100, (usageStats.usedSeconds / Math.max(1, usageStats.limitSeconds)) * 100)}%`
                    }}
                  />
                </div>
                <p className="ai-voice-usage-note">
                  본인이 업로드한 녹음 길이 합산 · 달력은 한국(서울) 기준 · 월 최대 40시간
                </p>
              </>
            ) : null}
          </div>

          <div className="ai-voice-upload-section">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm"
              multiple
              className="ai-voice-file-input"
              onChange={handleFileChange}
              aria-label="음성 파일 선택"
              disabled={uploadQuotaExceeded || uploading}
            />
            <div
              className={`ai-voice-upload-zone ${uploadZoneDragOver ? 'ai-voice-upload-zone-dragover' : ''} ${uploadQuotaExceeded ? 'ai-voice-upload-zone--disabled' : ''}`}
              onClick={uploadQuotaExceeded ? undefined : handleUploadClick}
              onKeyDown={(e) => {
                if (uploadQuotaExceeded) return;
                if (e.key === 'Enter') handleUploadClick();
              }}
              onDragOver={handleUploadDragOver}
              onDragLeave={handleUploadDragLeave}
              onDrop={handleUploadDrop}
              role={uploadQuotaExceeded ? 'region' : 'button'}
              tabIndex={uploadQuotaExceeded ? -1 : 0}
              aria-label={uploadQuotaExceeded ? '이번 달 전사 한도 도달로 업로드 비활성' : '음성 녹음 업로드'}
            >
              <div className="ai-voice-upload-icon-wrap">
                <span className="material-symbols-outlined">cloud_upload</span>
              </div>
              <h3 className="ai-voice-upload-title">{uploadQuotaExceeded ? '이번 달 한도 도달' : '음성 녹음 업로드'}</h3>
              <p className="ai-voice-upload-hint">
                {uploadQuotaExceeded
                  ? '월 40시간 전사 한도를 모두 사용했습니다. 다음 달 초에 다시 업로드할 수 있습니다.'
                  : 'MP3, WAV, M4A, WebM을 끌어다 놓거나 클릭하여 선택하세요. 긴 파일은 여러 조각으로 나누어 올린 뒤 서버에서 이어 붙입니다.'}
              </p>
              {uploadSplitStatus ? <p className="ai-voice-upload-split-status">{uploadSplitStatus}</p> : null}
              <button
                type="button"
                className="ai-voice-upload-btn"
                disabled={uploading || uploadQuotaExceeded}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!uploadQuotaExceeded) handleUploadClick();
                }}
              >
                {uploading
                  ? uploadSplitStatus || '업로드 중…'
                  : uploadQuotaExceeded
                    ? '업로드 불가'
                    : '파일 선택'}
              </button>
              {uploadError && <p className="ai-voice-upload-error">{uploadError}</p>}
            </div>
          </div>

          <div className="ai-voice-list-section">
            <div className="ai-voice-list-header">
              <span className="ai-voice-list-header-label">최근 녹음</span>
              <span className="ai-voice-list-header-count">{items.length}건</span>
            </div>
            {loadingList ? (
              <p className="ai-voice-list-loading">불러오는 중…</p>
            ) : listError ? (
              <p className="ai-voice-list-error">{listError}</p>
            ) : (
              <ul className="ai-voice-list" role="list">
                {items.map((rec) => {
                  const meta = formatRecordingDate(rec.createdAt);
                  const st = STATUS_MAP[rec.status] || STATUS_MAP.queued;
                  return (
                    <li key={rec._id}>
                      <button
                        type="button"
                        className={`ai-voice-list-item ${selectedId === rec._id ? 'active' : ''}`}
                        onClick={() => setSelectedId(rec._id)}
                      >
                        <div className="ai-voice-list-item-left">
                          <div className={`ai-voice-list-item-icon ${selectedId === rec._id ? 'active' : ''}`}>
                            <span className="material-symbols-outlined">{st.icon}</span>
                          </div>
                          <div className="ai-voice-list-item-text">
                            <h4 className="ai-voice-list-item-title">{rec.title || '제목 없음'}</h4>
                            <p className="ai-voice-list-item-meta">{meta.full}</p>
                          </div>
                        </div>
                        <span className={`ai-voice-status ai-voice-status-${st.class}`}>{st.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {!loadingList && !listError && items.length === 0 && (
              <p className="ai-voice-list-empty">등록된 녹음이 없습니다. 위에서 파일을 업로드하세요.</p>
            )}
          </div>
        </aside>

        <main className="ai-voice-main">
          {!selectedId ? (
            <div className="ai-voice-detail-empty">
              <span className="material-symbols-outlined">mic</span>
              <p>왼쪽에서 녹음을 선택하거나 새로 업로드하세요.</p>
            </div>
          ) : loadingDetail && !selectedDetail ? (
            <div className="ai-voice-detail-loading">불러오는 중…</div>
          ) : (
            <div className="ai-voice-detail">
              <div className="ai-voice-detail-header">
                <div className="ai-voice-detail-header-left">
                  <div className="ai-voice-detail-play-wrap">
                    <span className="material-symbols-outlined">play_circle</span>
                  </div>
                  <div className="ai-voice-detail-info">
                    <h3 className="ai-voice-detail-title">{selectedDetail?.title || '제목 없음'}</h3>
                    <div className="ai-voice-detail-meta">
                      {selectedDetail?.createdAt && (
                        <>
                          <span><span className="material-symbols-outlined">calendar_today</span> {formatRecordingDate(selectedDetail.createdAt).dateStr}</span>
                          <span><span className="material-symbols-outlined">schedule</span> {formatRecordingDate(selectedDetail.createdAt).timeStr}</span>
                        </>
                      )}
                      {selectedDetail?.durationSeconds != null && (
                        <span><span className="material-symbols-outlined">timer</span> {formatDuration(selectedDetail.durationSeconds)}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="ai-voice-detail-actions">
                  <button type="button" className="ai-voice-icon-btn" title="전사록 내보내기" onClick={handleExportTranscript} disabled={!selectedDetail?.transcriptText && !selectedDetail?.utterances?.length}>
                    <span className="material-symbols-outlined">download</span>
                  </button>
                  <button type="button" className="ai-voice-icon-btn" title="삭제" onClick={() => handleDelete(selectedDetail._id)}>
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>

              {(selectedDetail?.status === 'processing' || selectedDetail?.status === 'queued') && (
                <div className="ai-voice-status-banner ai-voice-status-transcribing">
                  <span className="material-symbols-outlined">sync</span>
                  <span>전사 중입니다. 잠시 후 자동으로 갱신됩니다.</span>
                </div>
              )}
              {selectedDetail?.status === 'error' && (
                <div className="ai-voice-status-banner ai-voice-status-error">
                  <span className="material-symbols-outlined">error</span>
                  <span>{selectedDetail.errorMessage || '전사 처리 중 오류가 발생했습니다.'}</span>
                </div>
              )}

              <section className="ai-voice-card">
                <div className="ai-voice-card-head">
                  <div className="ai-voice-card-title-wrap">
                    <span className="material-symbols-outlined ai-voice-card-icon">auto_awesome</span>
                    <h4 className="ai-voice-card-title">AI 요약</h4>
                  </div>
                  {selectedDetail?.status === 'completed' && (selectedDetail.transcriptText || selectedDetail.utterances?.length) && (
                    <button type="button" className="ai-voice-text-btn" onClick={handleRequestSummary} disabled={summaryLoading} title={selectedDetail.summary ? 'AI로 요약을 다시 생성합니다' : 'Gemini 2.5 Flash로 요약을 생성합니다'}>
                      {summaryLoading ? '요약 생성 중…' : selectedDetail.summary ? '다시 요약' : '요약 생성'}
                    </button>
                  )}
                </div>
                <div className="ai-voice-card-body">
                  {summaryError && <p className="ai-voice-summary-error">{summaryError}</p>}
                  {summaryLoading && !selectedDetail?.summary && <p className="ai-voice-summary-placeholder">Gemini 2.5 Flash로 요약을 생성하고 있습니다. 백엔드 슬립 시 첫 요청은 30초 정도 걸릴 수 있습니다…</p>}
                  {selectedDetail?.summary ? (
                    <div className="ai-voice-summary-block">
                      {splitSummaryIntoBlocks(selectedDetail.summary).map((paragraphSentences, pIdx) => (
                        <p key={pIdx} className="ai-voice-summary-paragraph">
                          {paragraphSentences.map((sentence, sIdx) => (
                            <span key={sIdx} className="ai-voice-summary-sentence">{sentence}{sIdx < paragraphSentences.length - 1 ? ' ' : ''}</span>
                          ))}
                        </p>
                      ))}
                    </div>
                  ) : !summaryLoading && (
                    <p className="ai-voice-summary-placeholder">
                      {selectedDetail?.status === 'completed' ? '위 "요약 생성" 버튼을 누르면 Gemini 2.5 Flash로 요약합니다.' : '전사 완료 후 요약이 표시됩니다.'}
                    </p>
                  )}
                </div>
                {selectedDetail?.summary && (
                  <footer className="ai-voice-summary-footer">
                    {sendToMessage && <p className={sendToMessage.startsWith('"') ? 'ai-voice-send-success' : 'ai-voice-summary-error'}>{sendToMessage}</p>}
                    <p className="ai-voice-summary-footer-hint">AI 요약을 기록일지로 보내기</p>
                    <div className="ai-voice-send-btns">
                      <button type="button" className="ai-voice-send-btn" onClick={() => { setSendToMessage(''); setShowSendToCompany(true); }} disabled={sendToLoading}>
                        <span className="material-symbols-outlined">business</span>
                        고객사 일지
                      </button>
                      <button type="button" className="ai-voice-send-btn" onClick={() => { setSendToMessage(''); setShowSendToContact(true); }} disabled={sendToLoading}>
                        <span className="material-symbols-outlined">group</span>
                        연락처 리스트
                      </button>
                      <button type="button" className="ai-voice-send-btn" onClick={handleSendToMeeting} disabled={sendToLoading}>
                        <span className="material-symbols-outlined">description</span>
                        회의 일지
                      </button>
                    </div>
                  </footer>
                )}
              </section>

              <section className="ai-voice-card">
                <div className="ai-voice-card-head">
                  <div className="ai-voice-card-title-wrap">
                    <span className="material-symbols-outlined ai-voice-card-icon ai-voice-card-icon-muted">notes</span>
                    <h4 className="ai-voice-card-title">전사록</h4>
                  </div>
                  <div className="ai-voice-card-actions">
                    <button type="button" className="ai-voice-text-btn" onClick={handleExportTranscript} disabled={!selectedDetail?.transcriptText && !selectedDetail?.utterances?.length}>
                      전사록 내보내기
                    </button>
                  </div>
                </div>
                <div className="ai-voice-transcript">
                  {selectedDetail?.utterances?.length > 0 ? (
                    selectedDetail.utterances.map((line, i) => (
                      <div key={i} className="ai-voice-transcript-line">
                        <div className="ai-voice-transcript-avatar">{line.speaker || 'A'}</div>
                        <div className="ai-voice-transcript-content">
                          <div className="ai-voice-transcript-meta">
                            <span className="ai-voice-transcript-name">Speaker {line.speaker || 'A'}</span>
                            <span className="ai-voice-transcript-time">{formatTimestamp(line.start)}</span>
                          </div>
                          <p className="ai-voice-transcript-text">{line.text}</p>
                        </div>
                      </div>
                    ))
                  ) : selectedDetail?.transcriptText ? (
                    <div className="ai-voice-transcript-plain">
                      <p className="ai-voice-transcript-text">{selectedDetail.transcriptText}</p>
                    </div>
                  ) : selectedDetail?.status === 'completed' ? (
                    <p className="ai-voice-transcript-placeholder">전사 내용이 없습니다.</p>
                  ) : (
                    <p className="ai-voice-transcript-placeholder">전사 중이거나 대기 중입니다.</p>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {showSendToCompany && (
        <CustomerCompanySearchModal
          onClose={() => setShowSendToCompany(false)}
          onSelect={(company) => handleSendToCompany(company)}
        />
      )}
      {showSendToContact && (
        <CustomerCompanyEmployeesSearchModal
          onClose={() => setShowSendToContact(false)}
          onSelect={(contact) => handleSendToContact(contact)}
        />
      )}
    </div>
  );
}
