import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '@/config';
import './sms-draft-modal.css';

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
  const [aiMode, setAiMode] = useState('proofread');
  const [aiTone, setAiTone] = useState('polite');
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
    setAiMode('proofread');
    setAiTone('polite');
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
        setDraft(String(initialBulkBody));
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
        tone: aiMode === 'tone' ? aiTone : undefined,
        keyword: aiMode === 'auto_draft' ? aiKeyword.trim() : undefined,
        receivedText: aiMode === 'smart_reply' ? aiReceived.trim() : undefined,
        replyIntent: aiMode === 'smart_reply' ? aiReplyIntent : undefined,
        targetLang: aiMode === 'translate' ? aiTargetLang : undefined,
        recipientName: aiMode === 'personalize' ? aiRecipientName.trim() : undefined,
        companyName: aiMode === 'personalize' ? aiCompanyName.trim() : undefined,
        purpose: ['auto_draft', 'personalize'].includes(aiMode) ? aiPurpose.trim() || undefined : undefined
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
        setDraft(String(data.text).trim());
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
    aiTone,
    aiTargetLang,
    aiRecipientName,
    aiCompanyName,
    aiPurpose
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
          <h3 id="sms-draft-title">{title}</h3>
          <button type="button" className="sms-draft-close" onClick={onClose} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="sms-draft-body">
          <p className="sms-draft-hint">
            {isBulk ? (
              <>
                동일 본문으로 수신 번호를 한꺼번에 문자 앱에 넣습니다. 기기·앱마다 동작이 다를 수 있습니다.
              </>
            ) : (
              <>
                이메일 작성 화면과 <strong>같은 AI 기능</strong>을 씁니다. 교정·요약 등은 <strong>보낼 문자</strong> 칸에 넣은 뒤 실행하세요.
              </>
            )}
          </p>
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

          <div className="sms-draft-ai-panel" role="region" aria-label="AI 문자 보조">
            <div className="sms-draft-ai-head">
              <span className="material-symbols-outlined" aria-hidden>auto_awesome</span>
              <span>AI 문장 다듬기</span>
            </div>
            <p className="sms-draft-ai-mini">
              분류·감정 분석 등은 JSON으로만 표시되며 본문에 넣지 않습니다.
            </p>
            <label className="sms-draft-ai-label" htmlFor="sms-draft-ai-mode">
              기능
            </label>
            <select
              id="sms-draft-ai-mode"
              className="sms-draft-ai-select"
              value={aiMode}
              onChange={(e) => setAiMode(e.target.value)}
            >
              <optgroup label="기본 품질">
                <option value="proofread">맞춤법·문법 교정</option>
                <option value="tone">어조 변환</option>
                <option value="rewrite">문장 다듬기 (간결하게)</option>
              </optgroup>
              <optgroup label="생산성">
                <option value="auto_draft">문자 자동 작성 (키워드)</option>
                <option value="smart_reply">답장 자동 생성</option>
                <option value="summarize">요약 (핵심 3줄)</option>
              </optgroup>
              <optgroup label="업무 자동화">
                <option value="classify">문자 분류·태깅</option>
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
              <div className="sms-draft-ai-row">
                <label htmlFor="sms-draft-ai-tone">어조</label>
                <select
                  id="sms-draft-ai-tone"
                  className="sms-draft-ai-select"
                  value={aiTone}
                  onChange={(e) => setAiTone(e.target.value)}
                >
                  <option value="polite">공손 (비즈니스)</option>
                  <option value="casual">캐주얼</option>
                  <option value="firm">단호 (정중)</option>
                  <option value="persuasive">설득형</option>
                </select>
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
            <div className="sms-draft-ai-actions">
              <button
                type="button"
                className="sms-draft-ai-run"
                onClick={runSmsAiAssist}
                disabled={aiLoading || (isBulk && bulkPhones.length === 0)}
              >
                {aiLoading ? '처리 중…' : '실행'}
              </button>
            </div>
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
          </div>

          <label className="sms-draft-label sms-draft-label-mt" htmlFor="sms-draft-body">
            보낼 문자 (수정 가능)
          </label>
          <textarea
            id="sms-draft-body"
            className="sms-draft-input sms-draft-body"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="위에서 AI 실행 후 여기에 결과가 들어갑니다. 직접 입력해도 됩니다."
            rows={isBulk ? 7 : 6}
            disabled={isBulk && bulkPhones.length === 0}
          />

          <div className="sms-draft-footer-btns">
            <button type="button" className="sms-draft-btn sms-draft-btn-secondary" onClick={onClose}>
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
                <span className="material-symbols-outlined" aria-hidden>sms</span>
                {isBulk ? '문자 앱으로 열기 (단체)' : '문자 앱으로 보내기'}
              </a>
            ) : (
              <button type="button" className="sms-draft-btn sms-draft-btn-primary" disabled>
                <span className="material-symbols-outlined" aria-hidden>sms</span>
                {isBulk ? '문자 앱으로 열기 (단체)' : '문자 앱으로 보내기'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
