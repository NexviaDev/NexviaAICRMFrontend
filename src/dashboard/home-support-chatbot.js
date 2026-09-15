import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '@/config';
import { crmFetchInit } from '@/lib/crm-auth';
import './home-support-chatbot.css';

const LOCAL_AI_STORAGE_KEY = 'nexvia-support-use-local-ai';
const PANEL_SIZE_STORAGE_KEY = 'nexvia-support-bot-panel-size-v2';
const OLLAMA_BASE = 'http://127.0.0.1:11434';

/** 최초 열림 크기 — 기존(360×512) 대비 약 2배 */
const DEFAULT_PANEL_SIZE = { w: 720, h: 780 };
const MIN_PANEL_SIZE = { w: 360, h: 420 };

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function readPanelSize() {
  try {
    const raw = window.localStorage.getItem(PANEL_SIZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PANEL_SIZE };
    const parsed = JSON.parse(raw);
    const w = Number(parsed?.w);
    const h = Number(parsed?.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return { ...DEFAULT_PANEL_SIZE };
    return { w, h };
  } catch (_) {
    return { ...DEFAULT_PANEL_SIZE };
  }
}

function maxPanelSize() {
  if (typeof window === 'undefined') return { w: 720, h: 900 };
  return {
    w: Math.max(MIN_PANEL_SIZE.w, Math.floor(window.innerWidth - 24)),
    h: Math.max(MIN_PANEL_SIZE.h, Math.floor(window.innerHeight - 88))
  };
}

function normalizePanelSize(size) {
  const max = maxPanelSize();
  return {
    w: clamp(Number(size?.w) || DEFAULT_PANEL_SIZE.w, MIN_PANEL_SIZE.w, max.w),
    h: clamp(Number(size?.h) || DEFAULT_PANEL_SIZE.h, MIN_PANEL_SIZE.h, max.h)
  };
}

const DEFAULT_QUICK_LINKS = [
  { id: 'nav:company-overview', label: '사내 현황', href: '/company-overview' },
  { id: 'nav:contacts', label: '연락처', href: '/customer-company-employees' },
  { id: 'nav:companies', label: '기업 리스트', href: '/customer-companies' },
  { id: 'nav:sales', label: '영업기회', href: '/sales-pipeline' },
  { id: 'nav:work-report', label: '업무 보고', href: '/reports/work-report' },
  { id: 'nav:calendar', label: '캘린더', href: '/calendar' }
];

function citationHref(c) {
  if (c?.href) return c.href;
  if (c?.contactId) {
    return `/customer-company-employees?modal=detail&id=${encodeURIComponent(c.contactId)}`;
  }
  if (c?.companyId) {
    return `/customer-companies?modal=detail&id=${encodeURIComponent(c.companyId)}`;
  }
  if (c?.salesId) {
    return `/sales-pipeline?oppModal=edit&oppId=${encodeURIComponent(c.salesId)}`;
  }
  if (c?.employeeId) {
    return `/reports/work-report/${encodeURIComponent(c.employeeId)}`;
  }
  return null;
}

function kindLabel(kind) {
  if (kind === 'nav') return '메뉴';
  if (kind === 'company') return '고객사';
  if (kind === 'contact') return '연락처';
  if (kind === 'sales') return '영업';
  if (kind === 'employee') return '직원';
  if (kind === 'support') return '지원이력';
  return '출처';
}

const PREFERRED_OLLAMA_MODELS = [
  'qwen2.5:7b',
  'qwen2.5:14b',
  'qwen2.5:3b',
  'qwen2.5',
  'gemma2:9b',
  'gemma2',
  'phi3:mini',
  'phi3',
  'llama3.2',
  'llama3.1',
  'llama3',
  'mistral'
];

function modelBaseName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .split(':')[0];
}

async function resolveBrowserOllamaModel(preferred) {
  const want = String(preferred || '').trim();
  let installed = [];
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      installed = (Array.isArray(data?.models) ? data.models : [])
        .map((m) => String(m?.name || m?.model || '').trim())
        .filter(Boolean);
    }
  } catch (_) {
    installed = [];
  }

  if (want) {
    const exact = installed.find((n) => n === want);
    if (exact) return exact;
    if (!want.includes(':')) {
      const byFamily = installed.find(
        (n) => modelBaseName(n) === modelBaseName(want) || n.startsWith(`${want}:`)
      );
      if (byFamily) return byFamily;
    }
  }

  for (const cand of PREFERRED_OLLAMA_MODELS) {
    const exact = installed.find((n) => n === cand);
    if (exact) return exact;
  }
  for (const cand of PREFERRED_OLLAMA_MODELS) {
    if (cand.includes(':')) continue;
    const byFamily = installed.find(
      (n) => modelBaseName(n) === cand || n.startsWith(`${cand}:`)
    );
    if (byFamily) return byFamily;
  }
  if (installed.length) return installed[0];
  throw new Error(
    '로컬 AI에 사용 가능한 모델이 없습니다. PC에 로컬 AI를 설치·실행한 뒤 다시 시도해 주세요.'
  );
}

/**
 * 브라우저에서 Ollama 직접 호출 (서버가 로컬 Ollama에 닿지 못할 때)
 */
async function answerWithBrowserOllama({ prompt, chunks, model }) {
  const useModel = await resolveBrowserOllamaModel(model);
  const allowedIds = new Set((Array.isArray(chunks) ? chunks : []).map((c) => String(c.id)));
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), 90000) : null;
  let res;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        model: useModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: 'JSON only. No markdown.' },
          { role: 'user', content: String(prompt || '') }
        ],
        options: { temperature: 0.2 }
      })
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('로컬 AI 응답이 시간 초과되었습니다. 잠시 후 다시 시도하거나 로컬 AI를 끄고 클라우드 키를 사용해 주세요.');
    }
    throw new Error(
      '이 PC의 로컬 AI에 연결할 수 없습니다. 로컬 AI를 설치·실행한 뒤 다시 시도해 주세요.'
    );
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 && /not found/i.test(body)) {
      throw new Error(
        '로컬 AI 모델을 찾을 수 없습니다. PC에 모델을 설치한 뒤 다시 시도해 주세요.'
      );
    }
    throw new Error(`로컬 AI 오류 (${res.status})${body ? `: ${body.slice(0, 120)}` : ''}`);
  }
  const data = await res.json().catch(() => ({}));
  const rawText = String(data?.message?.content || data?.response || '').trim();
  if (!rawText) throw new Error('로컬 AI가 답변을 생성하지 못했습니다.');
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (_) {
    const m = rawText.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('로컬 AI 답변 형식을 해석하지 못했습니다.');
    parsed = JSON.parse(m[0]);
  }
  const answer = String(parsed?.answer || '').trim();
  const citationIds = Array.isArray(parsed?.citationIds)
    ? parsed.citationIds.map((id) => String(id)).filter((id) => allowedIds.has(id))
    : [];
  return { answer, citationIds, ollamaModel: useModel };
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readLocalAiPref() {
  try {
    return window.localStorage.getItem(LOCAL_AI_STORAGE_KEY) === '1';
  } catch (_) {
    return false;
  }
}

/** 스마트폰·좁은 화면 — 로컬 AI 비활성, 사내 현황 클라우드 키만 사용 */
function isMobileSupportClient() {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(max-width: 768px)').matches;
  } catch (_) {
    return false;
  }
}

/**
 * 대시보드 우하단 CRM RAG 챗봇 (메뉴 이동 + 고객사/연락처/영업/지원이력)
 */
export default function HomeSupportChatbot() {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isMobile, setIsMobile] = useState(() => isMobileSupportClient());
  const [useLocalAi, setUseLocalAi] = useState(false);
  const [quickLinks, setQuickLinks] = useState(DEFAULT_QUICK_LINKS);
  const [panelSize, setPanelSize] = useState(() =>
    typeof window === 'undefined' ? { ...DEFAULT_PANEL_SIZE } : normalizePanelSize(readPanelSize())
  );
  const [messages, setMessages] = useState(() => [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'CRM 도우미입니다. 「사내 현황 열어줘」, 「영업기회」, 「○○ 프린터 고장」처럼 물어보시면 메뉴로 안내하거나 고객사·연락처·영업·기술지원 이력을 찾아 출처와 함께 답합니다.',
      citations: []
    }
  ]);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const resizeSessionRef = useRef(null);
  const panelSizeRef = useRef(panelSize);

  useEffect(() => {
    panelSizeRef.current = panelSize;
  }, [panelSize]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => {
      const mobile = mq.matches;
      setIsMobile(mobile);
      if (mobile) {
        setUseLocalAi(false);
      } else {
        setUseLocalAi(readLocalAiPref());
      }
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => {
    const onResize = () => {
      setPanelSize((prev) => normalizePanelSize(prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const persistPanelSize = useCallback((next) => {
    const normalized = normalizePanelSize(next);
    setPanelSize(normalized);
    try {
      window.localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(normalized));
    } catch (_) {
      /* ignore */
    }
  }, []);

  const onResizePointerDown = useCallback(
    (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = panelSizeRef.current.w;
      const startH = panelSizeRef.current.h;
      const pointerId = e.pointerId;
      const target = e.currentTarget;
      resizeSessionRef.current = { startX, startY, startW, startH };
      try {
        target.setPointerCapture(pointerId);
      } catch (_) {
        /* ignore */
      }

      const onMove = (ev) => {
        const st = resizeSessionRef.current;
        if (!st) return;
        const next = normalizePanelSize({
          w: st.startW + (st.startX - ev.clientX),
          h: st.startH + (st.startY - ev.clientY)
        });
        setPanelSize(next);
      };

      const onUp = () => {
        resizeSessionRef.current = null;
        try {
          target.releasePointerCapture(pointerId);
        } catch (_) {
          /* ignore */
        }
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        persistPanelSize(panelSizeRef.current);
      };

      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    },
    [persistPanelSize]
  );

  const onToggleLocalAi = useCallback(
    (checked) => {
      if (isMobileSupportClient()) {
        setUseLocalAi(false);
        return;
      }
      setUseLocalAi(checked);
      try {
        window.localStorage.setItem(LOCAL_AI_STORAGE_KEY, checked ? '1' : '0');
      } catch (_) {
        /* ignore */
      }
    },
    []
  );

  const effectiveUseLocalAi = isMobile ? false : useLocalAi;

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError('');
    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: text, citations: [] };
    setMessages((prev) => [...prev, userMsg]);
    setBusy(true);
    const useLocal = isMobileSupportClient() ? false : useLocalAi;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), 120000) : null;
    try {
      const res = await fetch(`${API_BASE}/support-assistant/chat`, {
        ...crmFetchInit(),
        method: 'POST',
        signal: controller?.signal,
        headers: {
          ...(crmFetchInit().headers || {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: text, useLocalAi: useLocal })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '답변을 가져오지 못했습니다.');

      if (Array.isArray(data.quickLinks) && data.quickLinks.length) {
        setQuickLinks(data.quickLinks);
      }

      if (useLocal && data.mode === 'needs-client-ollama') {
        try {
          const out = await answerWithBrowserOllama({
            prompt: data.prompt,
            chunks: data.chunks,
            model: data.ollamaModel
          });
          const allCites = Array.isArray(data.citations) ? data.citations : [];
          const idSet = out.citationIds?.length
            ? new Set(out.citationIds)
            : new Set(allCites.map((c) => c.id));
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content: String(out.answer || '').trim() || '답변이 비어 있습니다.',
              citations: allCites.filter((c) => idSet.has(c.id)),
              mode: 'ollama-client'
            }
          ]);
        } catch (ollamaErr) {
          const allCites = Array.isArray(data.citations) ? data.citations : [];
          setError(ollamaErr?.message || '로컬 AI 호출에 실패했습니다.');
          setMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content:
                allCites.length > 0
                  ? '로컬 AI 답변은 실패했지만, 검색된 출처는 아래 링크에서 확인할 수 있습니다.'
                  : '로컬 AI에 연결하지 못했습니다. 로컬 AI 실행 여부를 확인하거나 토글을 끄고 클라우드 키를 사용해 주세요.',
              citations: allCites,
              mode: 'retrieval-fallback'
            }
          ]);
        }
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: String(data.answer || '').trim() || '답변이 비어 있습니다.',
          citations: Array.isArray(data.citations) ? data.citations : [],
          mode: data.mode
        }
      ]);
    } catch (err) {
      const msg =
        err?.name === 'AbortError'
          ? '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
          : err?.message || '요청에 실패했습니다.';
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: '지금은 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
          citations: []
        }
      ]);
    } finally {
      if (timer) window.clearTimeout(timer);
      setBusy(false);
    }
  }, [busy, input, useLocalAi]);

  return (
    <div className={`home-support-bot${open ? ' is-open' : ''}`}>
      {open ? (
        <section
          className="home-support-bot-panel"
          id={panelId}
          role="dialog"
          aria-label="CRM 도우미"
          style={{
            width: `${panelSize.w}px`,
            height: `${panelSize.h}px`,
            maxWidth: 'calc(100vw - 1.5rem)',
            maxHeight: 'calc(100vh - 5.5rem)'
          }}
        >
          <div
            className="home-support-bot-resize"
            onPointerDown={onResizePointerDown}
            role="separator"
            aria-orientation="both"
            aria-label="챗봇 크기 조절"
            title="드래그하여 크기 조절"
          />
          <header className="home-support-bot-head">
            <div className="home-support-bot-head-text">
              <strong>CRM 도우미</strong>
              <span>메뉴 이동 · 데이터 검색(RAG) · 출처 링크 · 모서리 드래그로 확대</span>
            </div>
            <button
              type="button"
              className="home-support-bot-icon-btn"
              onClick={() => setOpen(false)}
              aria-label="닫기"
            >
              <span className="material-symbols-outlined" aria-hidden>
                close
              </span>
            </button>
          </header>

          <div className="home-support-bot-ai-bar">
            <label
              className={`home-support-bot-local-ai${isMobile ? ' is-mobile-locked' : ''}`}
            >
              <span className="home-support-bot-local-ai-label">로컬 AI 사용</span>
              <input
                type="checkbox"
                className="home-support-bot-toggle-input"
                checked={effectiveUseLocalAi}
                onChange={(e) => onToggleLocalAi(e.target.checked)}
                disabled={busy || isMobile}
                aria-label="로컬 AI 사용"
              />
              <span className="home-support-bot-toggle" aria-hidden />
            </label>
            <p className="home-support-bot-ai-hint">
              {isMobile
                ? '스마트폰에서는 로컬 AI를 사용할 수 없습니다. 사내 현황에 저장한 클라우드 AI 키만 사용합니다.'
                : effectiveUseLocalAi
                  ? '이 PC에서 로컬 AI를 실행해 두세요. 꺼 두면 사내 현황에 저장한 클라우드 AI 키를 사용합니다.'
                  : '클라우드 AI 키는 사내 현황 → 톱니바퀴 설정에서 저장합니다. (암호화 저장)'}
            </p>
          </div>

          <div className="home-support-bot-quick" aria-label="바로가기">
            {quickLinks.map((link) => (
              <Link
                key={link.id || link.href}
                to={link.href}
                className="home-support-bot-quick-chip"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="home-support-bot-messages" ref={listRef} role="log" aria-live="polite">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`home-support-bot-bubble home-support-bot-bubble--${m.role}`}
              >
                <p className="home-support-bot-text">{m.content}</p>
                {Array.isArray(m.citations) && m.citations.length > 0 ? (
                  <div className="home-support-bot-citations">
                    <span className="home-support-bot-citations-label">출처 · 바로가기</span>
                    <ul>
                      {m.citations.map((c) => {
                        const href = citationHref(c);
                        return (
                          <li key={c.id}>
                            <span className={`home-support-bot-cite-kind is-${c.kind || 'support'}`}>
                              {kindLabel(c.kind)}
                            </span>
                            {href ? (
                              <Link
                                to={href}
                                className="home-support-bot-cite-link"
                                onClick={() => setOpen(false)}
                              >
                                {c.label || c.companyName || '열기'}
                              </Link>
                            ) : (
                              <span>{c.label || '이력'}</span>
                            )}
                            {c.createdAt ? (
                              <span className="home-support-bot-cite-meta">{formatTime(c.createdAt)}</span>
                            ) : null}
                            {c.snippet ? (
                              <span className="home-support-bot-cite-snippet">{c.snippet}</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
            {busy ? (
              <div className="home-support-bot-bubble home-support-bot-bubble--assistant is-typing">
                {effectiveUseLocalAi ? '로컬 AI · CRM 검색 중…' : 'CRM 검색 중…'}
              </div>
            ) : null}
          </div>

          {error ? <p className="home-support-bot-error">{error}</p> : null}

          <form
            className="home-support-bot-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="예: 사내 현황, 영업기회, 프린터 고장…"
              disabled={busy}
              aria-label="질문 입력"
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="전송">
              <span className="material-symbols-outlined" aria-hidden>
                send
              </span>
            </button>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        className="home-support-bot-fab"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        title="CRM 도우미"
      >
        <span className="material-symbols-outlined" aria-hidden>
          {open ? 'close' : 'support_agent'}
        </span>
        <span className="home-support-bot-fab-label">{open ? '닫기' : 'CRM 도우미'}</span>
      </button>
    </div>
  );
}
