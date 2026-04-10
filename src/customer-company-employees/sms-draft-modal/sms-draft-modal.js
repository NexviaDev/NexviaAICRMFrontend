import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import {
  AI_GUIDED_AUDIENCES,
  AI_GUIDED_DEFAULTS,
  AI_GUIDED_EXTRAS,
  AI_GUIDED_GOALS,
  AI_GUIDED_LENGTHS,
  AI_GUIDED_TONES
} from '@/lib/gmail-ai-guided-options';
import './sms-draft-modal.css';

/** 본문 글자 수 표시 상한 (디자인 시안 기준) */
const SMS_BODY_MAX_LEN = 1000;

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function copyTextToClipboard(text) {
  const s = String(text ?? '');
  if (!s) return;
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(s);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = s;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

/** `sms:` — 모바일에서 문자 앱으로 열림 (본문은 사용자 확인 후) */
export function phoneToSmsHref(phone, body) {
  if (phone == null) return '';
  const s = String(phone).trim();
  if (!s) return '';
  const cleaned = s.replace(/[^\d+]/g, '');
  if (!cleaned || !cleaned.replace(/\+/g, '')) return '';
  const b = encodeURIComponent(String(body ?? ''));
  return `sms:${cleaned}?body=${b}`;
}

/**
 * 단체 수신란에 번호를 한 번에 넣기 (`sms:n1,n2,...?body=`).
 * 안드로이드 문자 앱에서 흔히 동작하며, iOS·일부 앱은 첫 번호만 넣거나 무시할 수 있습니다.
 */
export function phonesToGroupSmsHref(phones, body) {
  const seen = new Set();
  const list = [];
  for (const p of phones || []) {
    if (p == null) continue;
    const s = String(p).trim().replace(/[^\d+]/g, '');
    if (!s || !s.replace(/\+/g, '')) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    list.push(s);
  }
  if (!list.length) return '';
  const b = encodeURIComponent(String(body ?? ''));
  return `sms:${list.join(',')}?body=${b}`;
}

/**
 * 이메일 작성과 동일한 AI 모드(`/gmail/ai-assist` + channel: sms) + 문자 앱 이동
 */
export default function SmsDraftModal({
  open,
  onClose,
  phone,
  recipientName,
  companyName,
  bulkContacts = null,
  /** 단체: 기록에서 다시 보내기 시 제목·본문 프리필 */
  initialBulkTitle = '',
  initialBulkBody,
  /** 단체: 문자 앱으로 열기 직전 기록용 (부모가 localStorage 등에 저장) */
  onBulkSmsOpened,
  /** 단체: 기록에서 다시 보내기일 때 — 저장 시 같은 항목만 갱신 */
  bulkHistoryEntryId = null
}) {
  const [draft, setDraft] = useState('');
  const [bulkTitle, setBulkTitle] = useState('');
  const [aiMode, setAiMode] = useState('guided_rewrite');
  const [aiGuidedGoal, setAiGuidedGoal] = useState(AI_GUIDED_DEFAULTS.goal);
  const [aiGuidedTone, setAiGuidedTone] = useState(AI_GUIDED_DEFAULTS.tone);
  const [aiGuidedAudience, setAiGuidedAudience] = useState(AI_GUIDED_DEFAULTS.audience);
  const [aiGuidedLength, setAiGuidedLength] = useState(AI_GUIDED_DEFAULTS.length);
  const [aiGuidedExtra, setAiGuidedExtra] = useState(AI_GUIDED_DEFAULTS.extra);
  const [aiKeyword, setAiKeyword] = useState('');
  const [aiReceived, setAiReceived] = useState('');
  const [aiReplyIntent, setAiReplyIntent] = useState('approve');
  const [aiTargetLang, setAiTargetLang] = useState('en');
  const [aiRecipientName, setAiRecipientName] = useState('');
  const [aiCompanyName, setAiCompanyName] = useState('');
  const [aiPurpose, setAiPurpose] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiJsonResult, setAiJsonResult] = useState('');

  const isBulk = Array.isArray(bulkContacts) && bulkContacts.length > 0;
  const bulkPhones = useMemo(() => {
    if (!isBulk) return [];
    return bulkContacts
      .map((c) => c?.phone)
      .filter((p) => Boolean(phoneToSmsHref(p, '')));
  }, [isBulk, bulkContacts]);

  useEffect(() => {
    if (!open) return;
    setAiMode('guided_rewrite');
    setAiGuidedGoal(AI_GUIDED_DEFAULTS.goal);
    setAiGuidedTone(AI_GUIDED_DEFAULTS.tone);
    setAiGuidedAudience(AI_GUIDED_DEFAULTS.audience);
    setAiGuidedLength(AI_GUIDED_DEFAULTS.length);
    setAiGuidedExtra(AI_GUIDED_DEFAULTS.extra);
    setAiKeyword('');
    setAiReceived('');
    setAiReplyIntent('approve');
    setAiTargetLang('en');
    setAiPurpose('');
    setAiError('');
    setAiJsonResult('');
    setAiLoading(false);
    if (isBulk) {
      setBulkTitle(String(initialBulkTitle ?? '').trim());
      if (initialBulkBody !== undefined && initialBulkBody !== null) {
        setDraft(String(initialBulkBody).slice(0, SMS_BODY_MAX_LEN));
      } else {
        setDraft('');
      }
      setAiRecipientName('');
      setAiCompanyName('');
    } else {
      setDraft('');
      setAiRecipientName(String(recipientName || '').trim());
      setAiCompanyName(String(companyName || '').trim());
    }
  }, [open, phone, isBulk, recipientName, companyName, initialBulkTitle, initialBulkBody]);

  const smsHref = useMemo(() => {
    const body = String(draft ?? '').trim();
    if (!body) return '';
    if (isBulk) return phonesToGroupSmsHref(bulkPhones, body);
    return phoneToSmsHref(phone, draft);
  }, [isBulk, bulkPhones, phone, draft]);

  const runSmsAiAssist = useCallback(async () => {
    setAiError('');
    setAiJsonResult('');
    const text = draft.trim();
    const modesNeedingEditorText = new Set([
      'guided_rewrite',
      'proofread',
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
      setAiError('보낼 문자 칸에 내용을 입력해 주세요.');
      return;
    }
    if (aiMode === 'auto_draft' && !aiKeyword.trim()) {
      setAiError('키워드(요청 한 줄)를 입력해 주세요.');
      return;
    }
    if (aiMode === 'smart_reply' && !aiReceived.trim()) {
      setAiError('받은 내용을 입력해 주세요.');
      return;
    }
    setAiLoading(true);
    try {
      const body = {
        mode: aiMode,
        channel: 'sms',
        text: needsEditorText ? text : undefined,
        tone: undefined,
        keyword: aiMode === 'auto_draft' ? aiKeyword.trim() : undefined,
        receivedText: aiMode === 'smart_reply' ? aiReceived.trim() : undefined,
        replyIntent: aiMode === 'smart_reply' ? aiReplyIntent : undefined,
        targetLang: aiMode === 'translate' ? aiTargetLang : undefined,
        recipientName: aiMode === 'personalize' ? aiRecipientName.trim() : undefined,
        companyName: aiMode === 'personalize' ? aiCompanyName.trim() : undefined,
        purpose: ['auto_draft', 'personalize'].includes(aiMode) ? aiPurpose.trim() || undefined : undefined,
        guidedGoal: aiMode === 'guided_rewrite' ? aiGuidedGoal : undefined,
        guidedTone: aiMode === 'guided_rewrite' ? aiGuidedTone : undefined,
        guidedAudience: aiMode === 'guided_rewrite' ? aiGuidedAudience : undefined,
        guidedLength: aiMode === 'guided_rewrite' ? aiGuidedLength : undefined,
        guidedExtra: aiMode === 'guided_rewrite' ? aiGuidedExtra : undefined
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
        setDraft(String(data.text).trim().slice(0, SMS_BODY_MAX_LEN));
      }
    } catch (e) {
      setAiError(e.message || '오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  }, [
    aiMode,
    draft,
    aiKeyword,
    aiReceived,
    aiReplyIntent,
    aiTargetLang,
    aiRecipientName,
    aiCompanyName,
    aiPurpose,
    aiGuidedGoal,
    aiGuidedTone,
    aiGuidedAudience,
    aiGuidedLength,
    aiGuidedExtra
  ]);

  const canOpenSms = Boolean(smsHref && draft.trim());

  if (!open) return null;

  const title = isBulk ? `단체 문자 (${bulkPhones.length}명)` : '문자 보내기 (AI)';

  return (
    <div className="sms-draft-overlay" role="presentation">
      <div
        className="sms-draft-modal sms-draft-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sms-draft-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sms-draft-header">
          <div className="sms-draft-header-text">
            <h3 id="sms-draft-title">{title}</h3>
            <p className="sms-draft-header-sub">
              {isBulk
                ? '동일 본문으로 수신 번호를 문자 앱에 넣습니다. 기기·앱마다 다를 수 있습니다.'
                : 'AI를 사용하여 더 전문적이고 명확한 메시지를 작성해보세요.'}
            </p>
          </div>
          <button type="button" className="sms-draft-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="sms-draft-body">
          {isBulk && bulkPhones.length === 0 ? (
            <p className="sms-draft-error">문자를 보낼 수 있는 전화번호가 없습니다.</p>
          ) : null}

          {isBulk ? (
            <>
              <label className="sms-draft-label" htmlFor="sms-draft-bulk-title">
                기록 제목 (목록에 표시)
              </label>
              <input
                id="sms-draft-bulk-title"
                type="text"
                className="sms-draft-input sms-draft-bulk-title-input"
                value={bulkTitle}
                onChange={(e) => setBulkTitle(e.target.value)}
                placeholder="예: 1월 견적 안내 단체 문자"
                maxLength={120}
                disabled={bulkPhones.length === 0}
              />
            </>
          ) : null}

          <section className="sms-draft-ai-panel" role="region" aria-label="AI 문자 보조">
            <div className="sms-draft-ai-head">
              <span className="material-symbols-outlined sms-draft-ai-sparkle" aria-hidden>
                auto_awesome
              </span>
              <span className="sms-draft-ai-title-label">AI 문장 다듬기</span>
            </div>
            <p className="sms-draft-ai-mini">
              「문장 다듬기」는 목적·톤·독자·길이·추가를 조합해 Gemini가 본문을 고칩니다. 분류·JSON 전용 기능은 이 화면에서 뺐습니다.
            </p>
            <div className="sms-draft-ai-toolbar">
              <div className="sms-draft-ai-select-wrap">
                <label className="sms-draft-sr-only" htmlFor="sms-draft-ai-mode">
                  AI 기능
                </label>
                <select
                  id="sms-draft-ai-mode"
                  className="sms-draft-ai-select sms-draft-ai-select--toolbar"
                  value={aiMode}
                  onChange={(e) => setAiMode(e.target.value)}
                >
                  <option value="guided_rewrite">문장 다듬기 (목적·톤·독자·길이·추가)</option>
                  <option value="proofread">맞춤법·문법만 교정</option>
                  <option value="summarize">핵심 3줄 요약</option>
                  <option value="translate">번역 (한↔영)</option>
                  <option value="auto_draft">키워드로 초안</option>
                  <option value="smart_reply">받은 문자 답장 초안</option>
                  <option value="personalize">수신자 맞춤 (이름·회사)</option>
                </select>
                <span className="material-symbols-outlined sms-draft-ai-select-chevron" aria-hidden>
                  expand_more
                </span>
              </div>
              <button
                type="button"
                className="sms-draft-ai-run-inline"
                onClick={runSmsAiAssist}
                disabled={aiLoading || (isBulk && bulkPhones.length === 0)}
              >
                <span className="material-symbols-outlined sms-draft-ai-bolt" aria-hidden>
                  bolt
                </span>
                {aiLoading ? '처리 중…' : '실행'}
              </button>
            </div>

            {aiMode === 'guided_rewrite' && (
              <div className="sms-draft-ai-guided" role="group" aria-label="문장 다듬기 옵션">
                <div className="sms-draft-ai-row">
                  <label htmlFor="sms-draft-ai-g-goal">1. 목적</label>
                  <select
                    id="sms-draft-ai-g-goal"
                    className="sms-draft-ai-select"
                    value={aiGuidedGoal}
                    onChange={(e) => setAiGuidedGoal(e.target.value)}
                  >
                    {AI_GUIDED_GOALS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sms-draft-ai-row">
                  <label htmlFor="sms-draft-ai-g-tone">2. 톤</label>
                  <select
                    id="sms-draft-ai-g-tone"
                    className="sms-draft-ai-select"
                    value={aiGuidedTone}
                    onChange={(e) => setAiGuidedTone(e.target.value)}
                  >
                    {AI_GUIDED_TONES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sms-draft-ai-row">
                  <label htmlFor="sms-draft-ai-g-aud">3. 독자</label>
                  <select
                    id="sms-draft-ai-g-aud"
                    className="sms-draft-ai-select"
                    value={aiGuidedAudience}
                    onChange={(e) => setAiGuidedAudience(e.target.value)}
                  >
                    {AI_GUIDED_AUDIENCES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sms-draft-ai-row">
                  <label htmlFor="sms-draft-ai-g-len">4. 길이</label>
                  <select
                    id="sms-draft-ai-g-len"
                    className="sms-draft-ai-select"
                    value={aiGuidedLength}
                    onChange={(e) => setAiGuidedLength(e.target.value)}
                  >
                    {AI_GUIDED_LENGTHS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="sms-draft-ai-row">
                  <label htmlFor="sms-draft-ai-g-ex">5. 추가</label>
                  <select
                    id="sms-draft-ai-g-ex"
                    className="sms-draft-ai-select"
                    value={aiGuidedExtra}
                    onChange={(e) => setAiGuidedExtra(e.target.value)}
                  >
                    {AI_GUIDED_EXTRAS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {aiMode === 'translate' && (
              <div className="sms-draft-ai-row">
                <label htmlFor="sms-draft-ai-lang">번역 방향</label>
                <select
                  id="sms-draft-ai-lang"
                  className="sms-draft-ai-select"
                  value={aiTargetLang}
                  onChange={(e) => setAiTargetLang(e.target.value)}
                >
                  <option value="en">→ 영어</option>
                  <option value="ko">→ 한국어</option>
                </select>
              </div>
            )}

            {aiMode === 'auto_draft' && (
              <>
                <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-keyword">
                  키워드·상황 한 줄
                </label>
                <input
                  id="sms-draft-ai-keyword"
                  className="sms-draft-ai-input"
                  value={aiKeyword}
                  onChange={(e) => setAiKeyword(e.target.value)}
                  placeholder="예: 내일 미팅 재확인 부탁"
                />
                <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-purpose">
                  추가 맥락 (선택)
                </label>
                <input
                  id="sms-draft-ai-purpose"
                  className="sms-draft-ai-input"
                  value={aiPurpose}
                  onChange={(e) => setAiPurpose(e.target.value)}
                  placeholder="날짜, 상대방, 부탁 내용 등"
                />
              </>
            )}

            {aiMode === 'smart_reply' && (
              <>
                <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-received">
                  받은 문자·메시지
                </label>
                <textarea
                  id="sms-draft-ai-received"
                  className="sms-draft-ai-textarea"
                  rows={4}
                  value={aiReceived}
                  onChange={(e) => setAiReceived(e.target.value)}
                  placeholder="답장할 원문을 붙여 넣으세요."
                />
                <div className="sms-draft-ai-row">
                  <label htmlFor="sms-draft-ai-intent">답장 유형</label>
                  <select
                    id="sms-draft-ai-intent"
                    className="sms-draft-ai-select"
                    value={aiReplyIntent}
                    onChange={(e) => setAiReplyIntent(e.target.value)}
                  >
                    <option value="approve">승인·긍정</option>
                    <option value="reject">거절·정중 거절</option>
                    <option value="more">추가 정보 요청</option>
                  </select>
                </div>
              </>
            )}

            {aiMode === 'personalize' && (
              <>
                <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-rn">
                  수신자 이름 (선택)
                </label>
                <input
                  id="sms-draft-ai-rn"
                  className="sms-draft-ai-input"
                  value={aiRecipientName}
                  onChange={(e) => setAiRecipientName(e.target.value)}
                  placeholder="홍길동"
                />
                <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-cn">
                  회사명 (선택)
                </label>
                <input
                  id="sms-draft-ai-cn"
                  className="sms-draft-ai-input"
                  value={aiCompanyName}
                  onChange={(e) => setAiCompanyName(e.target.value)}
                  placeholder="(주)예시"
                />
                <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-purpose2">
                  목적·상황 (선택)
                </label>
                <input
                  id="sms-draft-ai-purpose2"
                  className="sms-draft-ai-input"
                  value={aiPurpose}
                  onChange={(e) => setAiPurpose(e.target.value)}
                  placeholder="견적 후속 안내 등"
                />
              </>
            )}

            {aiError ? <p className="sms-draft-ai-err">{aiError}</p> : null}
            {aiJsonResult ? (
              <div className="sms-draft-ai-json-wrap">
                <div className="sms-draft-ai-json-head">
                  <span>분석 결과 (JSON)</span>
                  <button type="button" className="sms-draft-ai-copy-json" onClick={() => copyTextToClipboard(aiJsonResult)}>
                    복사
                  </button>
                </div>
                <pre className="sms-draft-ai-json">{aiJsonResult}</pre>
              </div>
            ) : null}
          </section>

          <div className="sms-draft-message-block">
            <label className="sms-draft-label" htmlFor="sms-draft-body">
              보낼 문자 (수정 가능)
            </label>
            <div className="sms-draft-textarea-wrap">
              <textarea
                id="sms-draft-body"
                className="sms-draft-body-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="고객님께 보낼 메시지를 입력하거나 AI 기능을 활용해 보세요…"
                maxLength={SMS_BODY_MAX_LEN}
                rows={isBulk ? 7 : 6}
                disabled={isBulk && bulkPhones.length === 0}
              />
              <div className="sms-draft-char-count" aria-live="polite">
                {String(draft || '').length} / {SMS_BODY_MAX_LEN}
              </div>
            </div>
          </div>

          <footer className="sms-draft-footer">
            <div className="sms-draft-footer-hint">
              <span className="material-symbols-outlined sms-draft-footer-info-icon" aria-hidden>
                info
              </span>
              <span>전송 전 내용을 반드시 확인해주세요.</span>
            </div>
            <div className="sms-draft-footer-actions">
              <button type="button" className="sms-draft-btn sms-draft-btn-tertiary" onClick={onClose}>
                취소
              </button>
              {canOpenSms ? (
                <a
                  href={smsHref}
                  className="sms-draft-btn sms-draft-btn-primary"
                  onClick={() => {
                    if (isBulk && typeof onBulkSmsOpened === 'function' && bulkContacts?.length) {
                      onBulkSmsOpened({
                        title: bulkTitle.trim() || '(제목 없음)',
                        body: String(draft ?? '').trim(),
                        contacts: bulkContacts.map((c) => ({
                          _id: c?._id,
                          name: c?.name,
                          company: c?.company,
                          phone: c?.phone
                        })),
                        existingId: bulkHistoryEntryId || undefined
                      });
                    }
                    onClose();
                  }}
                >
                  {isBulk ? '문자 앱으로 열기 (단체)' : '문자 앱으로 보내기'}
                  <span className="material-symbols-outlined" aria-hidden>
                    send
                  </span>
                </a>
              ) : (
                <button type="button" className="sms-draft-btn sms-draft-btn-primary" disabled>
                  {isBulk ? '문자 앱으로 열기 (단체)' : '문자 앱으로 보내기'}
                  <span className="material-symbols-outlined" aria-hidden>
                    send
                  </span>
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
