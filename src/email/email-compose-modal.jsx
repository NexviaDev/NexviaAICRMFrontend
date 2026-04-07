import { useRef, useEffect, useState, useMemo } from 'react';
import { API_BASE } from '@/config';
import { getEmailSignatureHtmlFromUser, patchEmailSignatureHtml } from '@/lib/list-templates';
import './email-compose-modal.css';

const FONT_OPTIONS = [
  { value: '', label: '기본' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Verdana', label: 'Verdana' },
  { value: '맑은 고딕', label: '맑은 고딕' },
  { value: '굴림', label: '굴림' },
  { value: '바탕', label: '바탕' }
];

const SIZE_OPTIONS = [
  { value: '1', label: '가장 작게' },
  { value: '2', label: '작게' },
  { value: '3', label: '보통' },
  { value: '4', label: '크게' },
  { value: '5', label: '더 크게' },
  { value: '6', label: '매우 크게' },
  { value: '7', label: '가장 크게' }
];

const EMOJI_LIST = ['😀', '😊', '👍', '❤️', '🙏', '😅', '😂', '😍', '🤔', '✨', '🔥', '💯', '📌', '✅', '❌', '⚠️', '📧', '📎', '💼', '🎉'];

function copyTextToClipboard(text) {
  if (!text) return false;
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

/** 에디터 내 선택 영역에서 TABLE 요소 찾기 */
function getTableFromSelection(editorEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editorEl) return null;
  let node = sel.anchorNode;
  while (node && node !== editorEl) {
    if (node.nodeName === 'TABLE') return node;
    node = node.parentNode;
  }
  return null;
}

/** 선택 영역에서 셀(들) 찾기 - 병합용 */
function getSelectedCells(editorEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editorEl) return [];
  const range = sel.getRangeAt(0);
  const start = range.startContainer;
  let node = start.nodeType === 3 ? start.parentNode : start;
  while (node && node !== editorEl) {
    if (node.nodeName === 'TD' || node.nodeName === 'TH') {
      const table = node.closest('table');
      if (!table) return [];
      const cells = [];
      const walker = document.createTreeWalker(table, NodeFilter.SHOW_ELEMENT, {
        acceptNode: (n) => (n.nodeName === 'TD' || n.nodeName === 'TH') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      });
      let cell;
      while ((cell = walker.nextNode())) {
        if (sel.containsNode(cell, true)) cells.push(cell);
      }
      return cells.length >= 2 ? cells : [node];
    }
    node = node.parentNode;
  }
  return [];
}

/** 테이블 그리드 구축 (rowSpan/colSpan 반영) - [row][col] = cell */
function getTableGrid(table) {
  const grid = [];
  const rows = table.rows;
  for (let ri = 0; ri < rows.length; ri++) {
    if (!grid[ri]) grid[ri] = [];
    const row = rows[ri];
    let col = 0;
    while (grid[ri][col]) col++;
    for (let ci = 0; ci < row.cells.length; ci++) {
      const cell = row.cells[ci];
      const rspan = cell.rowSpan || 1;
      const cspan = cell.colSpan || 1;
      for (let r = 0; r < rspan; r++) {
        if (!grid[ri + r]) grid[ri + r] = [];
        for (let c = 0; c < cspan; c++) grid[ri + r][col + c] = cell;
      }
      col += cspan;
    }
  }
  return grid;
}

/** 답장 제목: 이미 Re: 가 있으면 유지, 없으면 Re: 접두 */
export function buildReplyEmailSubject(originalSubject) {
  const s = (originalSubject || '').trim();
  if (!s) return 'Re: ';
  if (/^re:\s*/i.test(s)) return s;
  return `Re: ${s}`;
}

/** 전달 제목: Fwd: 접두 (이미 Fwd: 이면 유지) */
export function buildForwardEmailSubject(originalSubject) {
  const s = (originalSubject || '').trim();
  if (!s) return 'Fwd: ';
  if (/^fwd:\s*/i.test(s)) return s;
  return `Fwd: ${s}`;
}

function escapeHtmlQuote(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 인용 영역에 넣을 HTML 본문 — 스크립트 등 제거 */
function sanitizeHtmlForQuote(html) {
  if (!html || typeof html !== 'string') return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const n = attr.name.toLowerCase();
        if (
          n.startsWith('on') ||
          n === 'srcdoc' ||
          (n === 'href' && /^\s*javascript:/i.test(attr.value))
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body ? doc.body.innerHTML : '';
  } catch {
    return escapeHtmlQuote(html);
  }
}

/** 메일 명함·원문 인용 경계 (DOM/innerHTML 기준) */
export const NEXVIA_EMAIL_SIG_MARK = '<!--nexvia-email-sig-->';
export const NEXVIA_REPLY_QUOTE_MARK = '<!--nexvia-reply-quote-->';

/** 저장된 HTML로 명함 블록 생성 (마커 포함) */
export function buildSignatureBlockHtml(signatureHtml) {
  if (!signatureHtml || !String(signatureHtml).trim()) return '';
  const inner = sanitizeHtmlForQuote(String(signatureHtml).trim());
  return `${NEXVIA_EMAIL_SIG_MARK}<div class="nexvia-email-signature" style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">${inner}</div>`;
}

/** 새 메일: 본문 위 + 하단 명함 */
export function buildNewMailEditorHtml(signatureHtml) {
  const sig = buildSignatureBlockHtml(signatureHtml);
  if (!sig) return '<p><br></p><p><br></p>';
  return `<p><br></p><p><br></p>${sig}`;
}

/** 작성란 HTML만 (명함·원문 인용 제외) — AI·치환용 */
export function getComposeDraftHtml(fullHtml) {
  if (!fullHtml) return '';
  const sigAt = fullHtml.indexOf(NEXVIA_EMAIL_SIG_MARK);
  const quoteAt = fullHtml.indexOf(NEXVIA_REPLY_QUOTE_MARK);
  const cuts = [sigAt, quoteAt].filter((i) => i >= 0);
  if (!cuts.length) return fullHtml;
  return fullHtml.slice(0, Math.min(...cuts));
}

/** 명함·원문 인용 HTML (마커부터 끝까지) */
export function getComposeTailHtml(fullHtml) {
  if (!fullHtml) return '';
  const sigAt = fullHtml.indexOf(NEXVIA_EMAIL_SIG_MARK);
  const quoteAt = fullHtml.indexOf(NEXVIA_REPLY_QUOTE_MARK);
  const cuts = [sigAt, quoteAt].filter((i) => i >= 0);
  if (!cuts.length) return '';
  return fullHtml.slice(Math.min(...cuts));
}

/**
 * 답장: 작성란 → (명함) → 원문 인용 (일반 메일처럼 명함은 원문 바로 위)
 * @param {{ from?: string, to?: string, subject?: string, date?: string, bodyPlain?: string, bodyHtml?: string }} src
 * @param {string} [signatureHtml] 저장된 명함 HTML 소스
 */
export function buildReplyQuotedEditorHtml(src, signatureHtml) {
  const from = src?.from || '';
  const to = src?.to || '';
  const subject = src?.subject || '';
  const date = src?.date || '';
  const bodyPlain = src?.bodyPlain != null ? String(src.bodyPlain) : '';
  const bodyHtml = src?.bodyHtml != null ? String(src.bodyHtml) : '';

  const metaRows = [
    ['보낸 사람', from || '—'],
    ['받는 사람', to || '—'],
    ['제목', subject || '—'],
    ['일시', date || '—']
  ];
  const metaHtml = metaRows
    .map(
      ([k, v]) =>
        `<p style="margin:4px 0;font-size:13px;color:#334155;line-height:1.5;"><strong style="color:#475569;">${escapeHtmlQuote(k)}:</strong> ${escapeHtmlQuote(v)}</p>`
    )
    .join('');

  let inner = '';
  if (bodyHtml.trim()) {
    inner = sanitizeHtmlForQuote(bodyHtml);
  } else if (bodyPlain.trim()) {
    inner = escapeHtmlQuote(bodyPlain).replace(/\r\n|\r|\n/g, '<br/>');
  } else {
    inner = '<p style="color:#94a3b8;font-size:13px;margin:0;">(본문 없음)</p>';
  }

  const quoteWrap = `<div class="email-reply-quote-block" style="margin-top:10px;padding:12px 14px;border-left:4px solid #c7d2fe;background:#f8fafc;border-radius:0 8px 8px 0;font-size:13px;color:#1e293b;line-height:1.55;">${inner}</div>`;

  const quoteSection = `${NEXVIA_REPLY_QUOTE_MARK}<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" /><p style="color:#64748b;font-size:12px;margin:0 0 10px;">----- 원본 메일 -----</p>${metaHtml}${quoteWrap}`;
  const sigBlock = buildSignatureBlockHtml(signatureHtml);
  return `<p><br></p><p><br></p>${sigBlock}${quoteSection}`;
}

/**
 * 전달: 받는 사람은 비워 두고, 원문 인용 블록은 답장과 동일 구조(제목만 다름)
 * — 새 스레드로 발송(threadId 없음)
 */
export function buildForwardQuotedEditorHtml(src, signatureHtml) {
  const from = src?.from || '';
  const to = src?.to || '';
  const subject = src?.subject || '';
  const date = src?.date || '';
  const bodyPlain = src?.bodyPlain != null ? String(src.bodyPlain) : '';
  const bodyHtml = src?.bodyHtml != null ? String(src.bodyHtml) : '';

  const metaRows = [
    ['보낸 사람', from || '—'],
    ['받는 사람', to || '—'],
    ['제목', subject || '—'],
    ['일시', date || '—']
  ];
  const metaHtml = metaRows
    .map(
      ([k, v]) =>
        `<p style="margin:4px 0;font-size:13px;color:#334155;line-height:1.5;"><strong style="color:#475569;">${escapeHtmlQuote(k)}:</strong> ${escapeHtmlQuote(v)}</p>`
    )
    .join('');

  let inner = '';
  if (bodyHtml.trim()) {
    inner = sanitizeHtmlForQuote(bodyHtml);
  } else if (bodyPlain.trim()) {
    inner = escapeHtmlQuote(bodyPlain).replace(/\r\n|\r|\n/g, '<br/>');
  } else {
    inner = '<p style="color:#94a3b8;font-size:13px;margin:0;">(본문 없음)</p>';
  }

  const quoteWrap = `<div class="email-forward-quote-block" style="margin-top:10px;padding:12px 14px;border-left:4px solid #94a3b8;background:#f8fafc;border-radius:0 8px 8px 0;font-size:13px;color:#1e293b;line-height:1.55;">${inner}</div>`;

  const quoteSection = `${NEXVIA_REPLY_QUOTE_MARK}<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" /><p style="color:#64748b;font-size:12px;margin:0 0 10px;">----- 전달 메일 -----</p>${metaHtml}${quoteWrap}`;
  const sigBlock = buildSignatureBlockHtml(signatureHtml);
  return `<p><br></p><p><br></p>${sigBlock}${quoteSection}`;
}

/** 명함 패널 HTML 미리보기 — iframe srcDoc (sandbox로 스크립트 실행 차단) */
function buildEmailSignaturePreviewSrcDoc(rawHtml) {
  const body = rawHtml != null ? String(rawHtml) : '';
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:10px 12px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;line-height:1.55;color:#1e293b;background:#f8fafc;}
    a{color:#2563eb;} img{max-width:100%;height:auto;} table{border-collapse:collapse;max-width:100%;}
  </style></head><body>${body}</body></html>`;
}

export default function EmailComposeModal({
  onClose,
  onSent,
  inline = false,
  composeMode = 'new',
  initialTo = '',
  initialCc = '',
  initialSubject = '',
  replyThreadId = null,
  /** 답장 시 원문 인용에 사용 (from, to, subject, date, bodyPlain, bodyHtml) */
  replyQuoteSource = null,
  /** 같은 메일 재오픈 시에만 인용 갱신 — 부모 리렌더로 인용이 덮어쓰이지 않게 id로 구분 */
  replyQuoteMessageId = null
}) {
  const editorRef = useRef(null);
  const [to, setTo] = useState(initialTo || '');
  const [cc, setCc] = useState(initialCc || '');
  const [subject, setSubject] = useState(initialSubject || '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tableHover, setTableHover] = useState({ row: 2, col: 2 });
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [drivePath, setDrivePath] = useState([]);
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveDrives, setDriveDrives] = useState([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [driveUploading, setDriveUploading] = useState(false);
  const [sizeWarningModal, setSizeWarningModal] = useState(null);
  const [inTable, setInTable] = useState(false);
  const tableRef = useRef(null);
  const [tableRect, setTableRect] = useState(null);
  const [colRects, setColRects] = useState([]);
  const [rowRects, setRowRects] = useState([]);
  const [resizing, setResizing] = useState({ type: null, index: null, start: 0 });
  const TABLE_GRID_ROWS = 10;
  const TABLE_GRID_COLS = 8;

  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiMode, setAiMode] = useState('proofread');
  const [aiTone, setAiTone] = useState('polite');
  const [aiKeyword, setAiKeyword] = useState('');
  const [aiReceived, setAiReceived] = useState('');
  const [aiReplyIntent, setAiReplyIntent] = useState('approve');
  const [aiTargetLang, setAiTargetLang] = useState('en');
  const [aiRecipientName, setAiRecipientName] = useState('');
  const [aiCompanyName, setAiCompanyName] = useState('');
  const [aiPurpose, setAiPurpose] = useState('');
  const [aiJsonResult, setAiJsonResult] = useState('');

  const [emailSignatureHtml, setEmailSignatureHtml] = useState('');
  const [signatureMetaLoaded, setSignatureMetaLoaded] = useState(false);
  const [showSignaturePanel, setShowSignaturePanel] = useState(false);
  const [signaturePanelText, setSignaturePanelText] = useState('');
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureSaveError, setSignatureSaveError] = useState('');

  const signaturePreviewSrcDoc = useMemo(
    () => buildEmailSignaturePreviewSrcDoc(signaturePanelText),
    [signaturePanelText]
  );

  function getAuthHeader() {
    const token = localStorage.getItem('crm_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  useEffect(() => {
    setTo(initialTo || '');
    setCc(initialCc || '');
    setSubject(initialSubject || '');
    setError('');
    setAttachedFiles([]);
    setShowAiPanel(false);
    setShowSignaturePanel(false);
  }, [composeMode, initialTo, initialCc, initialSubject, replyThreadId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/auth/me`, { headers: getAuthHeader(), credentials: 'include' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        const sig = getEmailSignatureHtmlFromUser(data.user);
        setEmailSignatureHtml(sig);
        setSignatureMetaLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSignatureMetaLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 답장·전달 인용 본문은 메일 id·인용 데이터가 바뀔 때만 주입 (명함은 /auth/me 로드 후 한 번; 저장 시에는 replaceSignatureInEditor로 갱신) */
  useEffect(() => {
    if (!editorRef.current || !signatureMetaLoaded) return;
    if (composeMode === 'reply' && replyQuoteMessageId && replyQuoteSource) {
      editorRef.current.innerHTML = buildReplyQuotedEditorHtml(replyQuoteSource, emailSignatureHtml);
    } else if (composeMode === 'forward' && replyQuoteMessageId && replyQuoteSource) {
      editorRef.current.innerHTML = buildForwardQuotedEditorHtml(replyQuoteSource, emailSignatureHtml);
    } else if (composeMode !== 'reply' && composeMode !== 'forward') {
      editorRef.current.innerHTML = buildNewMailEditorHtml(emailSignatureHtml);
    }
    // emailSignatureHtml 의존 제외: 저장 시 전체 HTML을 덮어쓰지 않고 마커 구간만 교체
  }, [composeMode, replyQuoteMessageId, replyQuoteSource, signatureMetaLoaded]);

  function replaceSignatureInEditor(editor, newSignatureHtml) {
    if (!editor) return;
    const full = editor.innerHTML;
    const sigAt = full.indexOf(NEXVIA_EMAIL_SIG_MARK);
    const quoteAt = full.indexOf(NEXVIA_REPLY_QUOTE_MARK);
    const newSig = buildSignatureBlockHtml(newSignatureHtml);
    if (sigAt !== -1) {
      const tail = quoteAt !== -1 && quoteAt > sigAt ? full.slice(quoteAt) : '';
      const before = full.slice(0, sigAt);
      editor.innerHTML = before + (newSig || '') + tail;
      return;
    }
    if (quoteAt !== -1) {
      editor.innerHTML = full.slice(0, quoteAt) + (newSig || '') + full.slice(quoteAt);
      return;
    }
    if (newSig) editor.innerHTML = full + newSig;
  }

  async function saveEmailSignature() {
    setSignatureSaveError('');
    setSignatureSaving(true);
    try {
      const data = await patchEmailSignatureHtml(signaturePanelText);
      const cleaned = data.emailSignatureHtml != null ? String(data.emailSignatureHtml) : signaturePanelText;
      setEmailSignatureHtml(cleaned);
      replaceSignatureInEditor(editorRef.current, cleaned);
      setShowSignaturePanel(false);
    } catch (e) {
      setSignatureSaveError(e.message || '저장에 실패했습니다.');
    } finally {
      setSignatureSaving(false);
    }
  }

  /** textarea는 기본 붙여넣기가 text/plain만 받음 — Gmail 등에서 복사한 HTML은 text/html로 넣어 태그 유지 */
  function handleSignatureHtmlPaste(e) {
    const html = e.clipboardData?.getData('text/html');
    if (html == null || !String(html).trim()) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = typeof ta.selectionStart === 'number' ? ta.selectionStart : 0;
    const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : start;
    const pasted = String(html);
    setSignaturePanelText((prev) => String(prev).slice(0, start) + pasted + String(prev).slice(end));
    const caret = start + pasted.length;
    window.requestAnimationFrame(() => {
      ta.focus();
      try {
        ta.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
    });
  }

  function handleSignaturePreviewFrameLoad(e) {
    const iframe = e.currentTarget;
    try {
      const h = iframe.contentDocument?.body?.scrollHeight;
      if (h != null && h > 0) {
        iframe.style.height = `${Math.min(Math.max(h + 24, 88), 520)}px`;
      }
    } catch {
      iframe.style.minHeight = '120px';
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => editorRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [composeMode, initialTo, initialCc, initialSubject, replyThreadId, replyQuoteMessageId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (sizeWarningModal) setSizeWarningModal(null);
      else if (showDrivePicker) setShowDrivePicker(false);
      else if (showTablePicker) setShowTablePicker(false);
      else if (showColorPicker) setShowColorPicker(false);
      else if (showEmoji) setShowEmoji(false);
      else if (showAiPanel) setShowAiPanel(false);
      else if (showSignaturePanel) setShowSignaturePanel(false);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showEmoji, showColorPicker, showTablePicker, showDrivePicker, sizeWarningModal, showAiPanel, showSignaturePanel]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const check = () => {
      const tbl = getTableFromSelection(editor);
      setInTable(!!tbl);
      tableRef.current = tbl;
    };
    editor.addEventListener('click', check);
    document.addEventListener('selectionchange', check);
    return () => {
      editor.removeEventListener('click', check);
      document.removeEventListener('selectionchange', check);
    };
  }, []);

  useEffect(() => {
    if (!inTable || !tableRef.current) {
      setTableRect(null);
      setColRects([]);
      setRowRects([]);
      return;
    }
    const update = () => {
      const tbl = tableRef.current;
      if (!tbl) return;
      setTableRect(tbl.getBoundingClientRect());
      const firstRow = tbl.rows[0];
      if (firstRow) {
        const cols = [];
        for (let i = 0; i < firstRow.cells.length; i++) {
          const r = firstRow.cells[i].getBoundingClientRect();
          cols.push({ left: r.left, right: r.right, width: r.width });
        }
        setColRects(cols);
      }
      const rows = [];
      for (let i = 0; i < tbl.rows.length; i++) {
        const r = tbl.rows[i].cells[0]?.getBoundingClientRect() || tbl.rows[i].getBoundingClientRect();
        if (r) rows.push({ top: r.top, bottom: r.bottom, height: r.height });
      }
      setRowRects(rows);
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [inTable]);

  function escapeHtmlPlain(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /** AI용: 선택 영역이 있으면 그 텍스트, 없으면 작성란만(명함·원문 인용 제외) */
  function getEditorTextForAi() {
    const editor = editorRef.current;
    if (!editor) return '';
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const t = sel.toString();
      if (t.trim()) return t.trim();
    }
    const draftHtml = getComposeDraftHtml(editor.innerHTML);
    const wrap = document.createElement('div');
    wrap.innerHTML = draftHtml || '';
    return (wrap.innerText || '').trim();
  }

  function hasTextSelectionInEditor() {
    const editor = editorRef.current;
    const sel = window.getSelection();
    if (!editor || !sel || sel.rangeCount === 0) return false;
    if (!editor.contains(sel.anchorNode)) return false;
    return sel.toString().trim().length > 0;
  }

  function applyAiTextToEditor(resultText) {
    const editor = editorRef.current;
    if (!editor || resultText == null) return;
    const raw = String(resultText);
    if (hasTextSelectionInEditor()) {
      const sel = window.getSelection();
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const html = escapeHtmlPlain(raw).replace(/\r\n|\r|\n/g, '<br/>');
      document.execCommand('insertHTML', false, html);
    } else {
      const tail = getComposeTailHtml(editor.innerHTML);
      const parts = raw.split(/\n+/).filter((p) => p.length > 0);
      const newDraft = parts.length
        ? `<p>${parts.map((p) => escapeHtmlPlain(p)).join('</p><p>')}</p>`
        : '<p><br></p>';
      editor.innerHTML = tail ? newDraft + tail : newDraft;
    }
    editor.focus();
  }

  async function runEmailAiAssist() {
    setAiError('');
    setAiJsonResult('');
    const text = getEditorTextForAi();
    const modesNeedingEditorText = new Set([
      'proofread',
      'tone',
      'rewrite',
      'summarize',
      'classify',
      'priority',
      'actions',
      'translate',
      'style_us',
      'personalize',
      'sentiment',
      'risk'
    ]);
    const needsEditorText = modesNeedingEditorText.has(aiMode);
    if (needsEditorText && !text) {
      setAiError('본문을 입력하거나, 적용할 문장을 드래그로 선택해 주세요.');
      return;
    }
    if (aiMode === 'auto_draft' && !aiKeyword.trim()) {
      setAiError('키워드(요청 한 줄)를 입력해 주세요.');
      return;
    }
    if (aiMode === 'smart_reply' && !aiReceived.trim()) {
      setAiError('받은 메일 내용을 입력해 주세요.');
      return;
    }
    setAiLoading(true);
    try {
      const body = {
        mode: aiMode,
        text: needsEditorText ? text : undefined,
        subject: subject.trim() || undefined,
        tone: aiMode === 'tone' ? aiTone : undefined,
        keyword: aiMode === 'auto_draft' ? aiKeyword.trim() : undefined,
        receivedText: aiMode === 'smart_reply' ? aiReceived.trim() : undefined,
        replyIntent: aiMode === 'smart_reply' ? aiReplyIntent : undefined,
        targetLang: aiMode === 'translate' ? aiTargetLang : undefined,
        recipientName: aiMode === 'personalize' ? aiRecipientName.trim() : undefined,
        companyName: aiMode === 'personalize' ? aiCompanyName.trim() : undefined,
        purpose: ['auto_draft', 'personalize'].includes(aiMode) ? (aiPurpose.trim() || undefined) : undefined
      };
      const res = await fetch(`${API_BASE}/gmail/ai-assist`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'AI 요청에 실패했습니다.');
      if (data.json != null) {
        setAiJsonResult(JSON.stringify(data.json, null, 2));
        return;
      }
      if (data.text != null && String(data.text).length > 0) {
        applyAiTextToEditor(data.text);
      }
    } catch (e) {
      setAiError(e.message || '오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  }

  const exec = (cmd, value = null) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
  };

  const insertHtml = (html) => {
    document.execCommand('insertHTML', false, html);
    editorRef.current?.focus();
  };

  const handlePaste = (e) => {
    const html = e.clipboardData?.getData?.('text/html');
    const text = e.clipboardData?.getData?.('text/plain');
    if (html && html.trim()) {
      e.preventDefault();
      insertHtml(html);
      return;
    }
    if (text) {
      e.preventDefault();
      insertHtml(text.replace(/\n/g, '<br>'));
    }
  };

  const handleParagraph = () => {
    insertHtml('<p><br></p>');
  };

  const handleTableInsert = (rows, cols) => {
    const el = editorRef.current;
    if (el) {
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const r = Math.max(1, Math.min(TABLE_GRID_ROWS, rows));
    const c = Math.max(1, Math.min(TABLE_GRID_COLS, cols));
    const rowHtml = '<tr>' + Array(c).fill('<td>&nbsp;</td>').join('') + '</tr>';
    const tableHtml = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%; max-width:500px;"><tbody>' + Array(r).fill(rowHtml).join('') + '</tbody></table><p></p>';
    insertHtml(tableHtml);
    setShowTablePicker(false);
  };

  const handleEmoji = (emoji) => {
    insertHtml(emoji);
    setShowEmoji(false);
  };

  const handleColor = (hex) => {
    exec('foreColor', hex);
    setShowColorPicker(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('email-compose-editor-dragover');
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('email-compose-editor-dragover');
  };
  const MAX_ATTACH_SIZE = 10 * 1024 * 1024; /* 10MB 이메일 첨부 */
  const MAX_DRIVE_UPLOAD = 5 * 1024 * 1024; /* 5MB Drive 업로드(API 제한) */

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('email-compose-editor-dragover');
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length === 0) return;
    const forDrive = files.filter((f) => f.size <= MAX_DRIVE_UPLOAD);
    const forAttach = files.filter((f) => f.size > MAX_DRIVE_UPLOAD && f.size <= MAX_ATTACH_SIZE);
    const skipped = files.filter((f) => f.size > MAX_ATTACH_SIZE);
    if (skipped.length > 0) {
      const names = skipped.map((f) => f.name).slice(0, 2).join(', ');
      const more = skipped.length > 2 ? ` 외 ${skipped.length - 2}개` : '';
      setSizeWarningModal(`용량 초과(10MB 이하만 첨부 가능). "${names}"${more} 업로드할 수 없습니다. 큰 파일은 Google Drive에 올린 뒤 "Google Drive에서 삽입"으로 링크를 넣어 주세요.`);
    }
    if (forAttach.length > 0) {
      setAttachedFiles((prev) => [
        ...prev,
        ...forAttach.map((file) => ({
          id: Math.random().toString(36).slice(2),
          file,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream'
        }))
      ]);
    }
    if (forDrive.length === 0) return;
    setDriveUploading(true);
    setError('');
    for (const file of forDrive) {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        const contentBase64 = btoa(binary);
        const r = await fetch(`${API_BASE}/drive/upload`, {
          method: 'POST',
          headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            contentBase64
          })
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.webViewLink) {
          insertDriveLinkBox(data.webViewLink, data.name || file.name);
        } else {
          setError(data.error || 'Drive 업로드 실패. 해당 파일은 이메일 첨부로 추가했습니다.');
          setAttachedFiles((prev) => [
            ...prev,
            { id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream' }
          ]);
        }
      } catch (_) {
        setError('Drive 업로드 중 오류가 났습니다. 해당 파일은 이메일 첨부로 추가했습니다.');
        setAttachedFiles((prev) => [
          ...prev,
          { id: Math.random().toString(36).slice(2), file, name: file.name, size: file.size, mimeType: file.type || 'application/octet-stream' }
        ]);
      }
    }
    setDriveUploading(false);
  };

  const removeAttachment = (id) => {
    setAttachedFiles((prev) => prev.filter((a) => a.id !== id));
  };

  const loadDriveFiles = async (folderId = 'root', driveId = '') => {
    setDriveLoading(true);
    setDriveError('');
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (folderId) params.set('folderId', folderId);
      if (driveId) params.set('driveId', driveId);
      const r = await fetch(`${API_BASE}/drive/files?${params}`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setDriveFiles(data.files || []);
        setDriveError('');
      } else {
        setDriveFiles([]);
        const msg = data.error || (r.status === 403 ? 'Drive 접근이 거부되었습니다. Google 재로그인 또는 Drive API 설정을 확인해 주세요.' : 'Drive 목록을 불러올 수 없습니다.');
        setDriveError(data.needsReauth ? `${msg} (Google 계정 다시 로그인 권장)` : msg);
      }
    } catch (_) {
      setDriveFiles([]);
      setDriveError('Drive에 연결할 수 없습니다.');
    } finally {
      setDriveLoading(false);
    }
  };

  const loadDriveDrives = async () => {
    setDriveLoading(true);
    setDriveError('');
    try {
      const r = await fetch(`${API_BASE}/drive/drives?pageSize=50`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setDriveDrives(data.drives || []);
        setDriveError('');
      } else {
        setDriveDrives([]);
        const msg = data.error || '공유 드라이브 목록을 불러올 수 없습니다.';
        setDriveError(data.needsReauth ? `${msg} (Google 계정 다시 로그인 권장)` : msg);
      }
    } catch (_) {
      setDriveDrives([]);
      setDriveError('Drive에 연결할 수 없습니다.');
    } finally {
      setDriveLoading(false);
    }
  };

  const openDriveModal = () => {
    setShowDrivePicker(true);
    setDriveError('');
    setDrivePath([]);
    setDriveFiles([]);
    setDriveDrives([]);
  };

  const driveNavigateTo = (index) => {
    if (index < 0) {
      setDrivePath([]);
      return;
    }
    const newPath = drivePath.slice(0, index + 1);
    setDrivePath(newPath);
    const last = newPath[newPath.length - 1];
    if (last.id === '_shared_') loadDriveDrives();
    else if (last.isSharedDrive) loadDriveFiles('', last.id);
    else loadDriveFiles(last.id, '');
  };

  const driveEnterFolder = (item) => {
    const newPath = [...drivePath, { id: item.id, name: item.name, isSharedDrive: !!item.isSharedDrive }];
    setDrivePath(newPath);
    if (item.isSharedDrive) loadDriveFiles('', item.id);
    else loadDriveFiles(item.id, '');
  };

  const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

  const tableAction = (fn) => {
    const editor = editorRef.current;
    const table = getTableFromSelection(editor);
    if (!table) return;
    fn(table);
    editorRef.current?.focus();
  };

  const tableMergeCells = () => {
    const editor = editorRef.current;
    const cells = getSelectedCells(editor);
    if (cells.length < 2) return;
    const table = cells[0].closest('table');
    const grid = getTableGrid(table);
    let minR = 999, minC = 999, maxR = -1, maxC = -1;
    const set = new Set(cells);
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < (grid[r]?.length || 0); c++) {
        if (set.has(grid[r][c])) {
          minR = Math.min(minR, r); minC = Math.min(minC, c);
          maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
        }
      }
    }
    const first = grid[minR][minC];
    const toRemove = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const cell = grid[r]?.[c];
        if (cell && cell !== first) toRemove.push(cell);
      }
    }
    first.rowSpan = maxR - minR + 1;
    first.colSpan = maxC - minC + 1;
    first.innerHTML = first.innerHTML || '&nbsp;';
    toRemove.forEach((cell) => cell.remove());
    editorRef.current?.focus();
  };

  const tableInsertRow = (above) => {
    tableAction((table) => {
      const sel = window.getSelection();
      let node = sel.anchorNode;
      while (node && node !== table) {
        if (node.nodeName === 'TR') {
          const idx = above ? node.rowIndex : node.rowIndex + 1;
          const newRow = table.insertRow(idx);
          const len = table.rows[above ? node.rowIndex : node.rowIndex + 1]?.cells?.length || table.rows[0]?.cells?.length || 1;
          for (let i = 0; i < len; i++) newRow.insertCell(i).innerHTML = '&nbsp;';
          return;
        }
        node = node.parentNode;
      }
    });
  };

  const tableInsertCol = (left) => {
    tableAction((table) => {
      const sel = window.getSelection();
      let node = sel.anchorNode;
      while (node && node !== table) {
        if (node.nodeName === 'TD' || node.nodeName === 'TH') {
          const colIndex = left ? node.cellIndex : node.cellIndex + 1;
          for (let i = 0; i < table.rows.length; i++) {
            const row = table.rows[i];
            const newCell = row.insertCell(colIndex);
            newCell.innerHTML = '&nbsp;';
          }
          return;
        }
        node = node.parentNode;
      }
    });
  };

  const tableDeleteRow = () => {
    tableAction((table) => {
      const sel = window.getSelection();
      let node = sel.anchorNode;
      while (node && node !== table) {
        if (node.nodeName === 'TR') {
          if (table.rows.length <= 1) return;
          table.deleteRow(node.rowIndex);
          return;
        }
        node = node.parentNode;
      }
    });
  };

  const tableDeleteCol = () => {
    tableAction((table) => {
      const sel = window.getSelection();
      let node = sel.anchorNode;
      while (node && node !== table) {
        if (node.nodeName === 'TD' || node.nodeName === 'TH') {
          const colIndex = node.cellIndex;
          const row = node.parentNode;
          if (row.cells.length <= 1) return;
          for (let i = 0; i < table.rows.length; i++) table.rows[i].deleteCell(colIndex);
          return;
        }
        node = node.parentNode;
      }
    });
  };

  const tableResizeCol = (colIndex, deltaX) => {
    const table = tableRef.current || getTableFromSelection(editorRef.current);
    if (!table || !table.rows[0]) return;
    const firstRow = table.rows[0];
    const numCols = firstRow.cells.length;
    if (colIndex < 0 || colIndex >= numCols) return;
    // 현재 각 열의 너비(렌더링 기준)
    const currentWidths = [];
    for (let i = 0; i < numCols; i++) {
      const w = firstRow.cells[i].getBoundingClientRect().width;
      currentWidths.push(w);
    }
    // 드래그한 열만 너비 변경, 나머지는 유지 → 테이블 전체 너비가 늘어나도록
    const newWidths = currentWidths.slice();
    newWidths[colIndex] = Math.max(20, newWidths[colIndex] + deltaX);
    const tableTotal = newWidths.reduce((a, b) => a + b, 0);
    table.style.tableLayout = 'fixed';
    table.style.width = tableTotal + 'px';
    for (let c = 0; c < numCols; c++) {
      const w = newWidths[c] + 'px';
      for (let r = 0; r < table.rows.length; r++) {
        const cell = table.rows[r].cells[c];
        if (cell) cell.style.width = w;
      }
    }
  };

  const tableResizeRow = (rowIndex, deltaY) => {
    const table = tableRef.current || getTableFromSelection(editorRef.current);
    if (!table || !table.rows[rowIndex]) return;
    const row = table.rows[rowIndex];
    const currentH = row.cells[0] ? row.cells[0].getBoundingClientRect().height : row.getBoundingClientRect().height;
    const h = Math.max(16, currentH + deltaY);
    for (let c = 0; c < row.cells.length; c++) {
      const cell = row.cells[c];
      if (cell) cell.style.height = h + 'px';
    }
  };

  useEffect(() => {
    if (resizing.type === null) return;
    const onMove = (e) => {
      if (resizing.type === 'col') tableResizeCol(resizing.index, e.clientX - resizing.start);
      else if (resizing.type === 'row') tableResizeRow(resizing.index, e.clientY - resizing.start);
      setResizing((prev) => ({ ...prev, start: prev.type === 'col' ? e.clientX : e.clientY }));
    };
    const onUp = () => setResizing({ type: null, index: null, start: 0 });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [resizing.type, resizing.index, resizing.start]);

  /** Drive 링크: 글자처럼 취급되도록 일반 <a>로 삽입. 커서 이동 가능, 전송 후에는 하이퍼링크로 표시됨 */
  const insertDriveLinkBox = (url, name) => {
    const safeName = (name || '파일').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeUrl = (url || '').replace(/"/g, '&quot;');
    const linkHtml = `<a href="${safeUrl}" class="email-compose-drive-link-inline" target="_blank" rel="noopener noreferrer">${safeName}</a>\u00A0`;
    insertHtml(linkHtml);
  };

  const insertDriveLink = async (fileId) => {
    try {
      const r = await fetch(`${API_BASE}/drive/files/${fileId}`, { headers: getAuthHeader() });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return;
      const url = data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
      insertDriveLinkBox(url, data.name || '파일');
      setShowDrivePicker(false);
    } catch (_) {}
  };

  /** Backspace/Delete 시 Drive 링크 박스 제거 (contenteditable=false 라서 기본 동작으로는 삭제 안 됨) */
  const handleEditorKeyDown = (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor || !editor.contains(anchor)) return;

    const driveBox = anchor.nodeType === Node.TEXT_NODE
      ? anchor.parentElement?.closest?.('.email-compose-drive-link-box')
      : anchor.closest?.('.email-compose-drive-link-box');
    if (driveBox) {
      e.preventDefault();
      const next = driveBox.nextElementSibling || driveBox.nextSibling;
      driveBox.remove();
      sel.removeAllRanges();
      const range = document.createRange();
      if (next) {
        range.setStart(next, 0);
        range.collapse(true);
      } else {
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      sel.addRange(range);
      editorRef.current?.focus();
      return;
    }

    let block = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
    while (block && block.parentElement !== editor) block = block.parentElement;
    if (!block || block.parentElement !== editor) return;

    const toRemove = e.key === 'Backspace' ? block.previousElementSibling : block.nextElementSibling;
    if (!toRemove?.classList?.contains('email-compose-drive-link-box')) return;
    e.preventDefault();
    toRemove.remove();
    sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(block, 0);
    range.collapse(true);
    sel.addRange(range);
    editorRef.current?.focus();
  };

  /** 전송용 HTML: Drive 링크에 인라인 스타일을 넣어 받는 사람 메일에서도 박스/버튼처럼 보이게 함 */
  const htmlForSend = (rawHtml) => {
    if (!rawHtml || typeof rawHtml !== 'string') return rawHtml;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, 'text/html');
      const linkStyle = 'display:inline-block;padding:10px 14px;margin:6px 4px 6px 0;border:1px solid #94a3b8;border-radius:8px;background:#f1f5f9;color:#2563eb;text-decoration:none;font-weight:500;word-break:break-all;';
      doc.querySelectorAll('a.email-compose-drive-link-inline').forEach((a) => {
        a.setAttribute('style', linkStyle);
      });
      return doc.body ? doc.body.innerHTML : rawHtml;
    } catch (_) {
      return rawHtml;
    }
  };

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setError('');
    if (!to.trim()) {
      setError('받는 사람을 입력해 주세요.');
      return;
    }
    const rawHtml = editorRef.current?.innerHTML ?? '';
    const html = htmlForSend(rawHtml);
    setSending(true);
    try {
      const token = localStorage.getItem('crm_token');
      let attachments = [];
      if (attachedFiles.length > 0) {
        attachments = await Promise.all(
          attachedFiles.map(async (a) => {
            const buf = await a.file.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            const chunk = 8192;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            const contentBase64 = btoa(binary);
            return { filename: a.name, mimeType: a.mimeType, contentBase64 };
          })
        );
      }
      const payload = {
        to: to.trim(),
        subject: subject.trim() || '(제목 없음)',
        body: editorRef.current?.innerText ?? '',
        bodyHtml: html || undefined,
        ...(cc.trim() ? { cc: cc.trim() } : {}),
        ...(composeMode === 'reply' && replyThreadId ? { threadId: replyThreadId } : {}),
        ...(attachments.length ? { attachments } : {})
      };
      const res = await fetch(`${API_BASE}/gmail/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || '전송에 실패했습니다.');
        return;
      }
      onSent?.();
      onClose?.();
    } catch (_) {
      setError('전송할 수 없습니다.');
    } finally {
      setSending(false);
    }
  };

  const presetColors = ['#000000', '#333333', '#666666', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6', '#1abc9c'];

  const formContent = (
    <>
      <header className="email-compose-header">
        <h2 className="email-compose-title">
          {composeMode === 'reply' ? '답장 작성' : composeMode === 'forward' ? '전달 작성' : '새 메일 작성'}
        </h2>
        <div className="email-compose-header-actions">
          <button
            type="button"
            className="email-compose-send-icon"
            disabled={sending}
            onClick={() => void handleSubmit()}
            aria-label={sending ? '전송 중' : '보내기'}
            title={sending ? '전송 중…' : '보내기'}
          >
            <span
              className={'material-symbols-outlined' + (sending ? ' email-compose-send-icon--spin' : '')}
              style={sending ? undefined : { fontVariationSettings: "'FILL' 1" }}
              aria-hidden
            >
              {sending ? 'progress_activity' : 'send'}
            </span>
          </button>
          <button type="button" className="email-compose-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </header>
      <form onSubmit={handleSubmit} className="email-compose-form">
        <div className="email-compose-fields">
          <div className="email-compose-field">
            <label>받는 사람</label>
            <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="이메일 주소" required />
          </div>
          <div className="email-compose-field">
            <label>참조 (Cc)</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="참조 이메일 (쉼표로 구분)"
              autoComplete="off"
            />
          </div>
          <div className="email-compose-field">
            <label>제목</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="제목" />
          </div>
        </div>
        <div className="email-compose-toolbar">
          <button type="button" className="email-compose-tb-btn" onClick={() => exec('bold')} title="굵게">
            <span className="material-symbols-outlined">format_bold</span>
          </button>
          <button type="button" className="email-compose-tb-btn" onClick={() => exec('italic')} title="기울임">
            <span className="material-symbols-outlined">format_italic</span>
          </button>
          <button type="button" className="email-compose-tb-btn" onClick={() => exec('underline')} title="밑줄">
            <span className="material-symbols-outlined">format_underlined</span>
          </button>
          <span className="email-compose-tb-sep" />
          <select
            className="email-compose-tb-select"
            title="글꼴"
            onChange={(e) => { exec('fontName', e.target.value); e.target.value = ''; }}
          >
            {FONT_OPTIONS.map((o) => (
              <option key={o.value || 'default'} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            className="email-compose-tb-select"
            title="글자 크기"
            onChange={(e) => { exec('fontSize', e.target.value); e.target.value = ''; }}
          >
            {SIZE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="email-compose-tb-sep" />
          <div className="email-compose-tb-color-wrap">
            <button type="button" className="email-compose-tb-btn" onClick={() => setShowColorPicker((v) => !v)} title="글자 색상">
              <span className="material-symbols-outlined">format_color_text</span>
            </button>
            {showColorPicker && (
              <>
                <div className="email-compose-color-backdrop" onClick={() => setShowColorPicker(false)} />
                <div className="email-compose-color-panel">
                  {presetColors.map((c) => (
                    <button key={c} type="button" className="email-compose-color-swatch" style={{ backgroundColor: c }} onClick={() => handleColor(c)} />
                  ))}
                </div>
              </>
            )}
          </div>
          <button type="button" className="email-compose-tb-btn" onClick={() => exec('insertUnorderedList')} title="글머리 기호">
            <span className="material-symbols-outlined">format_list_bulleted</span>
          </button>
          <button type="button" className="email-compose-tb-btn" onClick={() => exec('insertOrderedList')} title="번호 매기기">
            <span className="material-symbols-outlined">format_list_numbered</span>
          </button>
          <button type="button" className="email-compose-tb-btn" onClick={handleParagraph} title="문단 나누기">
            <span className="material-symbols-outlined">paragraph</span>
          </button>
          <div className="email-compose-tb-table-wrap">
            <button type="button" className="email-compose-tb-btn" onClick={() => setShowTablePicker((v) => !v)} title="테이블 삽입">
              <span className="material-symbols-outlined">table_chart</span>
            </button>
            {showTablePicker && (
              <>
                <div className="email-compose-table-backdrop" onClick={() => setShowTablePicker(false)} aria-hidden="true" />
                <div className="email-compose-table-panel email-compose-table-grid-panel">
                  <p className="email-compose-table-grid-hint">행·열을 선택한 뒤 클릭하면 테이블이 삽입됩니다.</p>
                  <div
                    className="email-compose-table-grid"
                    role="grid"
                    aria-label="테이블 크기 선택"
                    onMouseLeave={() => setTableHover((prev) => prev)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleTableInsert(tableHover.row + 1, tableHover.col + 1);
                    }}
                  >
                    {Array.from({ length: TABLE_GRID_ROWS }, (_, ri) =>
                      Array.from({ length: TABLE_GRID_COLS }, (_, ci) => (
                        <div
                          key={`${ri}-${ci}`}
                          className={`email-compose-table-grid-cell ${ri <= tableHover.row && ci <= tableHover.col ? 'selected' : ''}`}
                          onMouseEnter={() => setTableHover({ row: ri, col: ci })}
                        />
                      ))
                    )}
                  </div>
                  <p className="email-compose-table-grid-size">
                    {tableHover.row + 1} × {tableHover.col + 1} 표
                  </p>
                </div>
              </>
            )}
          </div>
            <div className="email-compose-tb-emoji-wrap">
              <button type="button" className="email-compose-tb-btn" onClick={() => setShowEmoji((v) => !v)} title="이모티콘">
                <span className="material-symbols-outlined">sentiment_satisfied</span>
              </button>
              {showEmoji && (
                <>
                  <div className="email-compose-emoji-backdrop" onClick={() => setShowEmoji(false)} />
                  <div className="email-compose-emoji-panel">
                    {EMOJI_LIST.map((em) => (
                      <button key={em} type="button" className="email-compose-emoji-btn" onClick={() => handleEmoji(em)}>{em}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <span className="email-compose-tb-sep" />
            <button
              type="button"
              className="email-compose-tb-btn email-compose-tb-sig"
              onClick={() => {
                setShowAiPanel(false);
                setShowSignaturePanel((v) => {
                  const next = !v;
                  if (next) {
                    setSignaturePanelText(emailSignatureHtml);
                    setSignatureSaveError('');
                  }
                  return next;
                });
              }}
              title="메일 명함 (HTML)"
            >
              <span className="material-symbols-outlined">badge</span>
            </button>
            <button
              type="button"
              className="email-compose-tb-btn email-compose-tb-ai"
              onClick={() => {
                setShowSignaturePanel(false);
                setShowAiPanel((v) => !v);
              }}
              title="AI 문장 다듬기 (Gemini)"
            >
              <span className="material-symbols-outlined">auto_awesome</span>
            </button>
            <button type="button" className="email-compose-tb-btn" onClick={openDriveModal} title="Google Drive에서 삽입">
              <span className="material-symbols-outlined">folder</span>
            </button>
          </div>

          {showSignaturePanel && (
            <div className="email-compose-sig-panel" role="region" aria-label="메일 명함">
              <div className="email-compose-sig-panel-head">
                <span className="material-symbols-outlined" aria-hidden>
                  badge
                </span>
                <span>메일 명함</span>
                <button
                  type="button"
                  className="email-compose-sig-close"
                  onClick={() => setShowSignaturePanel(false)}
                  aria-label="명함 패널 닫기"
                >
                  <span className="material-symbols-outlined">expand_less</span>
                </button>
              </div>
              <p className="email-compose-sig-hint">
                HTML 소스를 넣으면 발송 본문 하단에 표시됩니다. 답장 시에는 원본 메일 인용 <strong>바로 위</strong>에 붙습니다. 저장 시 계정의 <strong>listTemplates.emailSignature</strong>에 반영되며, 다른 기기에서도 동일하게 불러옵니다. Gmail 등에서 복사한 블록은{' '}
                <strong>태그가 포함된 HTML</strong>로 붙여넣기됩니다(일반 textarea와 달리 처리).
              </p>
              <label className="email-compose-sig-label" htmlFor="email-compose-sig-html">
                명함 HTML
              </label>
              <textarea
                id="email-compose-sig-html"
                className="email-compose-sig-textarea"
                rows={8}
                value={signaturePanelText}
                onChange={(e) => setSignaturePanelText(e.target.value)}
                onPaste={handleSignatureHtmlPaste}
                placeholder="예: &lt;div&gt;…&lt;/div&gt; 또는 &lt;table&gt;…&lt;/table&gt;"
                spellCheck={false}
              />
              <div className="email-compose-sig-preview-block">
                <span className="email-compose-sig-preview-title" id="email-compose-sig-preview-label">
                  미리보기
                </span>
                <div
                  className="email-compose-sig-preview-wrap"
                  role="region"
                  aria-labelledby="email-compose-sig-preview-label"
                >
                  {signaturePanelText.trim() ? (
                    <iframe
                      className="email-compose-sig-preview-frame"
                      title="명함 HTML 미리보기"
                      sandbox=""
                      srcDoc={signaturePreviewSrcDoc}
                      onLoad={handleSignaturePreviewFrameLoad}
                    />
                  ) : (
                    <p className="email-compose-sig-preview-empty">HTML을 입력하면 발송 시와 비슷하게 여기에 표시됩니다. 저장 전에 확인해 보세요.</p>
                  )}
                </div>
              </div>
              {signatureSaveError ? <p className="email-compose-sig-err">{signatureSaveError}</p> : null}
              <div className="email-compose-sig-actions">
                <button type="button" className="email-compose-sig-save" onClick={saveEmailSignature} disabled={signatureSaving}>
                  {signatureSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          )}

          {showAiPanel && (
            <div className="email-compose-ai-panel" role="region" aria-label="AI 문장 다듬기">
              <div className="email-compose-ai-panel-head">
                <span className="material-symbols-outlined" aria-hidden>auto_awesome</span>
                <span>AI 문장 다듬기</span>
                <button type="button" className="email-compose-ai-close" onClick={() => setShowAiPanel(false)} aria-label="AI 패널 닫기">
                  <span className="material-symbols-outlined">expand_less</span>
                </button>
              </div>
              <p className="email-compose-ai-hint">
                교정·톤·요약 등은 본문을 입력하거나 <strong>적용할 문장만 선택</strong>한 뒤 실행하세요. 긴 본문도 그대로 반영됩니다. JSON 분석 결과는 아래에만 표시됩니다.
              </p>
              <label className="email-compose-ai-label" htmlFor="email-compose-ai-mode">기능</label>
              <select
                id="email-compose-ai-mode"
                className="email-compose-ai-select"
                value={aiMode}
                onChange={(e) => setAiMode(e.target.value)}
              >
                <optgroup label="기본 품질">
                  <option value="proofread">맞춤법·문법 교정</option>
                  <option value="tone">어조 변환</option>
                  <option value="rewrite">문장 다듬기 (간결하게)</option>
                </optgroup>
                <optgroup label="생산성">
                  <option value="auto_draft">이메일 자동 작성 (키워드)</option>
                  <option value="smart_reply">답장 자동 생성</option>
                  <option value="summarize">요약 (핵심 3줄)</option>
                </optgroup>
                <optgroup label="업무 자동화">
                  <option value="classify">이메일 분류·태깅</option>
                  <option value="priority">중요도·긴급도 판단</option>
                  <option value="actions">할 일 추출</option>
                </optgroup>
                <optgroup label="글로벌">
                  <option value="translate">번역 (한↔영)</option>
                  <option value="style_us">미국식 비즈니스 스타일 (영문)</option>
                </optgroup>
                <optgroup label="고급">
                  <option value="personalize">개인화 (이름·회사 반영)</option>
                  <option value="sentiment">감정 분석</option>
                  <option value="risk">스팸·위험 신호 점검</option>
                </optgroup>
              </select>

              {aiMode === 'tone' && (
                <div className="email-compose-ai-row">
                  <label htmlFor="email-compose-ai-tone">어조</label>
                  <select id="email-compose-ai-tone" className="email-compose-ai-select" value={aiTone} onChange={(e) => setAiTone(e.target.value)}>
                    <option value="polite">공손 (비즈니스)</option>
                    <option value="casual">캐주얼</option>
                    <option value="firm">단호 (정중)</option>
                    <option value="persuasive">설득형</option>
                  </select>
                </div>
              )}

              {aiMode === 'translate' && (
                <div className="email-compose-ai-row">
                  <label htmlFor="email-compose-ai-lang">번역 방향</label>
                  <select id="email-compose-ai-lang" className="email-compose-ai-select" value={aiTargetLang} onChange={(e) => setAiTargetLang(e.target.value)}>
                    <option value="en">→ 영어</option>
                    <option value="ko">→ 한국어</option>
                  </select>
                </div>
              )}

              {aiMode === 'auto_draft' && (
                <>
                  <label className="email-compose-ai-label" htmlFor="email-compose-ai-keyword">키워드·상황 한 줄</label>
                  <input
                    id="email-compose-ai-keyword"
                    className="email-compose-ai-input"
                    value={aiKeyword}
                    onChange={(e) => setAiKeyword(e.target.value)}
                    placeholder="예: 거래처 일정 변경 요청"
                  />
                  <label className="email-compose-ai-label" htmlFor="email-compose-ai-purpose">추가 맥락 (선택)</label>
                  <input
                    id="email-compose-ai-purpose"
                    className="email-compose-ai-input"
                    value={aiPurpose}
                    onChange={(e) => setAiPurpose(e.target.value)}
                    placeholder="날짜, 상대방, 부탁 내용 등"
                  />
                </>
              )}

              {aiMode === 'smart_reply' && (
                <>
                  <label className="email-compose-ai-label" htmlFor="email-compose-ai-received">받은 메일 본문</label>
                  <textarea
                    id="email-compose-ai-received"
                    className="email-compose-ai-textarea"
                    rows={5}
                    value={aiReceived}
                    onChange={(e) => setAiReceived(e.target.value)}
                    placeholder="답장할 원문을 붙여 넣으세요."
                  />
                  <div className="email-compose-ai-row">
                    <label htmlFor="email-compose-ai-intent">답장 유형</label>
                    <select id="email-compose-ai-intent" className="email-compose-ai-select" value={aiReplyIntent} onChange={(e) => setAiReplyIntent(e.target.value)}>
                      <option value="approve">승인·긍정</option>
                      <option value="reject">거절·정중 거절</option>
                      <option value="more">추가 정보 요청</option>
                    </select>
                  </div>
                </>
              )}

              {aiMode === 'personalize' && (
                <>
                  <label className="email-compose-ai-label" htmlFor="email-compose-ai-rn">수신자 이름 (선택)</label>
                  <input id="email-compose-ai-rn" className="email-compose-ai-input" value={aiRecipientName} onChange={(e) => setAiRecipientName(e.target.value)} placeholder="홍길동" />
                  <label className="email-compose-ai-label" htmlFor="email-compose-ai-cn">회사명 (선택)</label>
                  <input id="email-compose-ai-cn" className="email-compose-ai-input" value={aiCompanyName} onChange={(e) => setAiCompanyName(e.target.value)} placeholder="(주)예시" />
                  <label className="email-compose-ai-label" htmlFor="email-compose-ai-purpose2">목적·상황 (선택)</label>
                  <input id="email-compose-ai-purpose2" className="email-compose-ai-input" value={aiPurpose} onChange={(e) => setAiPurpose(e.target.value)} placeholder="견적 후속 안내 등" />
                </>
              )}

              {aiError ? <p className="email-compose-ai-err">{aiError}</p> : null}
              <div className="email-compose-ai-actions">
                <button type="button" className="email-compose-ai-run" onClick={runEmailAiAssist} disabled={aiLoading}>
                  {aiLoading ? '처리 중…' : '실행'}
                </button>
              </div>
              {aiJsonResult ? (
                <div className="email-compose-ai-json-wrap">
                  <div className="email-compose-ai-json-head">
                    <span>분석 결과 (JSON)</span>
                    <button
                      type="button"
                      className="email-compose-ai-copy-json"
                      onClick={() => copyTextToClipboard(aiJsonResult)}
                    >
                      복사
                    </button>
                  </div>
                  <pre className="email-compose-ai-json">{aiJsonResult}</pre>
                </div>
              ) : null}
            </div>
          )}

          {inTable && (
            <div className="email-compose-table-toolbar">
              <span className="email-compose-table-toolbar-label">테이블</span>
              <button type="button" className="email-compose-tb-btn" onClick={tableMergeCells} title="셀 병합">
                <span className="material-symbols-outlined">merge_type</span>
              </button>
              <button type="button" className="email-compose-tb-btn" onClick={() => tableInsertRow(true)} title="행 위에 추가">
                <span className="material-symbols-outlined">vertical_align_top</span>
              </button>
              <button type="button" className="email-compose-tb-btn" onClick={() => tableInsertRow(false)} title="행 아래 추가">
                <span className="material-symbols-outlined">vertical_align_bottom</span>
              </button>
              <button type="button" className="email-compose-tb-btn" onClick={() => tableInsertCol(true)} title="열 왼쪽 추가">
                <span className="material-symbols-outlined">align_horizontal_left</span>
              </button>
              <button type="button" className="email-compose-tb-btn" onClick={() => tableInsertCol(false)} title="열 오른쪽 추가">
                <span className="material-symbols-outlined">align_horizontal_right</span>
              </button>
              <button type="button" className="email-compose-tb-btn" onClick={tableDeleteRow} title="행 삭제">
                <span className="material-symbols-outlined">remove_circle_outline</span>
              </button>
              <button type="button" className="email-compose-tb-btn" onClick={tableDeleteCol} title="열 삭제">
                <span className="material-symbols-outlined">remove_circle_outline</span>
              </button>
            </div>
          )}

          {inTable && tableRect && colRects.length > 0 && (
            <div className="email-compose-table-resize-overlay" style={{ pointerEvents: 'none' }}>
              {colRects.map((rect, i) => (
                <div
                  key={`col-${i}`}
                  className="email-compose-table-resize-handle email-compose-table-resize-col"
                  style={{
                    position: 'fixed',
                    left: rect.right - 3,
                    top: tableRect.top,
                    height: tableRect.height,
                    width: 6,
                    pointerEvents: 'auto'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setResizing({ type: 'col', index: i, start: e.clientX });
                  }}
                />
              ))}
              {rowRects.map((rect, i) => (
                <div
                  key={`row-${i}`}
                  className="email-compose-table-resize-handle email-compose-table-resize-row"
                  style={{
                    position: 'fixed',
                    top: rect.bottom - 3,
                    left: tableRect.left,
                    width: tableRect.width,
                    height: 6,
                    pointerEvents: 'auto'
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setResizing({ type: 'row', index: i, start: e.clientY });
                  }}
                />
              ))}
            </div>
          )}

          {driveUploading && (
            <div className="email-compose-drive-uploading">
              <span className="material-symbols-outlined">cloud_upload</span>
              <span>Drive에 업로드 중…</span>
            </div>
          )}
          {attachedFiles.length > 0 && (
            <div className="email-compose-attachments">
              <span className="email-compose-attachments-label">첨부:</span>
              {attachedFiles.map((a) => (
                <span key={a.id} className="email-compose-attachment-chip">
                  <span className="material-symbols-outlined">attach_file</span>
                  <span>{a.name}</span>
                  <button type="button" className="email-compose-attachment-remove" onClick={() => removeAttachment(a.id)} aria-label="제거">
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </span>
              ))}
            </div>
          )}
          <div
            ref={editorRef}
            className="email-compose-editor"
            contentEditable
            suppressContentEditableWarning
            onPaste={handlePaste}
            onKeyDown={handleEditorKeyDown}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-placeholder="내용을 입력하세요. 파일을 여기에 끌어다 놓으면 첨부됩니다. HTML 붙여넣기 시 서식 유지."
          />
        {error && <p className="email-compose-error">{error}</p>}
        <footer className="email-compose-footer">
          <button type="submit" className="email-compose-send" disabled={sending}>{sending ? '전송 중…' : '보내기'}</button>
          <button type="button" className="email-compose-close-btn" onClick={onClose}>닫기</button>
        </footer>
      </form>

      {showDrivePicker && (
        <div className="email-compose-drive-modal-overlay" onClick={() => setShowDrivePicker(false)}>
          <div className="email-compose-drive-modal" onClick={(e) => e.stopPropagation()}>
            <div className="email-compose-drive-modal-header">
              <h3 className="email-compose-drive-modal-title">Google Drive에서 링크 삽입</h3>
              <button type="button" className="email-compose-drive-modal-close" onClick={() => setShowDrivePicker(false)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="email-compose-drive-modal-body">
              {drivePath.length > 0 && (
                <div className="email-compose-drive-breadcrumb">
                  <button type="button" className="email-compose-drive-breadcrumb-item" onClick={() => driveNavigateTo(-1)}>
                    <span className="material-symbols-outlined">home</span>
                    <span>최상위</span>
                  </button>
                  {drivePath.map((p, i) => (
                    <span key={p.id + i} className="email-compose-drive-breadcrumb-wrap">
                      <span className="email-compose-drive-breadcrumb-sep">/</span>
                      <button type="button" className="email-compose-drive-breadcrumb-item" onClick={() => driveNavigateTo(i)}>
                        {p.name}
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {drivePath.length === 0 ? (
                <div className="email-compose-drive-root">
                  <button type="button" className="email-compose-drive-root-item" onClick={() => { setDrivePath([{ id: 'root', name: '내 드라이브' }]); loadDriveFiles('root'); }}>
                    <span className="material-symbols-outlined">folder</span>
                    <span>내 드라이브</span>
                  </button>
                  <button type="button" className="email-compose-drive-root-item" onClick={() => { setDrivePath([{ id: '_shared_', name: '공유 드라이브' }]); loadDriveDrives(); }}>
                    <span className="material-symbols-outlined">drive_file_rename_outline</span>
                    <span>공유 드라이브</span>
                  </button>
                </div>
              ) : driveLoading ? (
                <div className="email-compose-drive-loading">불러오는 중…</div>
              ) : driveError ? (
                <p className="email-compose-drive-error">{driveError}</p>
              ) : drivePath[drivePath.length - 1]?.id === '_shared_' ? (
                driveDrives.length === 0 ? (
                  <p className="email-compose-drive-empty">공유 드라이브가 없습니다.</p>
                ) : (
                  <ul className="email-compose-drive-list">
                    {driveDrives.map((d) => (
                      <li key={d.id}>
                        <button type="button" className="email-compose-drive-item email-compose-drive-item-folder" onClick={() => driveEnterFolder({ id: d.id, name: d.name, isSharedDrive: true })}>
                          <span className="material-symbols-outlined">drive_file_rename_outline</span>
                          <span className="email-compose-drive-item-name">{d.name}</span>
                          <span className="material-symbols-outlined">chevron_right</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : driveFiles.length === 0 ? (
                <p className="email-compose-drive-empty">이 폴더에 파일이 없습니다.</p>
              ) : (
                <ul className="email-compose-drive-list">
                  {driveFiles.map((f) => {
                    const isFolder = f.mimeType === DRIVE_FOLDER_MIME;
                    return (
                      <li key={f.id}>
                        <button
                          type="button"
                          className={`email-compose-drive-item ${isFolder ? 'email-compose-drive-item-folder' : ''}`}
                          onClick={() => isFolder ? driveEnterFolder({ id: f.id, name: f.name }) : insertDriveLink(f.id)}
                        >
                          <span className="material-symbols-outlined">{isFolder ? 'folder' : 'description'}</span>
                          <span className="email-compose-drive-item-name">{f.name}</span>
                          {isFolder ? <span className="material-symbols-outlined">chevron_right</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {sizeWarningModal && (
        <div className="email-compose-size-warning-overlay" onClick={() => setSizeWarningModal(null)}>
          <div className="email-compose-size-warning-modal" onClick={(e) => e.stopPropagation()}>
            <div className="email-compose-size-warning-header">
              <span className="material-symbols-outlined email-compose-size-warning-icon">warning</span>
              <h3 className="email-compose-size-warning-title">용량 초과</h3>
              <button type="button" className="email-compose-drive-modal-close" onClick={() => setSizeWarningModal(null)} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="email-compose-size-warning-message">{sizeWarningModal}</p>
            <footer className="email-compose-size-warning-footer">
              <button type="button" className="email-compose-size-warning-btn" onClick={() => setSizeWarningModal(null)}>확인</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );

  if (inline) {
    return <div className="email-compose-inline">{formContent}</div>;
  }

  return (
    <div className="email-compose-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="email-compose-modal" onClick={(e) => e.stopPropagation()}>
        {formContent}
      </div>
    </div>
  );
}
