import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API_BASE, BACKEND_BASE_URL } from '@/config';
import { getStoredCrmUser, isAdminOrAboveRole } from '@/lib/crm-role-utils';
import LeadCaptureFormModal from './lead-capture-form-modal/lead-capture-form-modal';
import LeadCaptureApiDocModal from './lead-capture-api-doc-modal/lead-capture-api-doc-modal';
import LeadCaptureLeadsModal from './lead-capture-leads-modal/lead-capture-leads-modal';
import LeadCaptureCrmMappingModal from './lead-capture-crm-mapping/lead-capture-crm-mapping-modal';
import CustomFieldsManageModal from '../shared/custom-fields-manage-modal/custom-fields-manage-modal';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';
import HomeLeadDetailModal from '@/home/home-lead-detail-modal';
import { buildLeadCaptureEmbedSnippet } from '@/lead-capture-shared/lead-capture-embed-snippet';
import './lead-capture.css';

function getAuthHeader() {
  const token = localStorage.getItem('crm_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function copyToClipboard(text) {
  if (!text) return false;
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

const DEFAULT_FIELDS = [
  { icon: 'person', label: '이름', meta: '필수 · 문자열', type: 'text', required: true },
  { icon: 'phone', label: '연락처', meta: '필수 · 숫자', type: 'number', required: true },
  { icon: 'mail', label: '이메일', meta: '필수 아님 · 문자열', type: 'text', required: false },
  { icon: 'business', label: '회사명', meta: '필수 아님 · 문자열', type: 'text', required: false },
  { icon: 'pin', label: '사업자등록번호', meta: '선택 · 숫자(하이픈 자동)', type: 'text', required: false },
  { icon: 'location_on', label: '회사 주소', meta: '필수 아님 · 문자열', type: 'text', required: false },
  { icon: 'badge', label: '명함', meta: '필수 아님 · 회사 사진파일', type: 'file', required: false }
];

function typeToMeta(type, required) {
  const typeLabels = { text: '텍스트', number: '숫자', date: '날짜', select: '드롭다운', multiselect: '다중 선택', checkbox: '체크박스' };
  const req = required ? '필수' : '선택';
  return `${typeLabels[type] || type} • ${req}`;
}

/** 로컬(localhost) 웹훅 URL이면 프로덕션 백엔드 주소로 바꿔서 표시·복사용으로 사용 */
function webhookUrlForDisplay(url, productionBase) {
  if (!url || !productionBase) return url || '';
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const base = productionBase.replace(/\/$/, '');
      return base + u.pathname + u.search;
    }
    return url;
  } catch (_) {
    return url;
  }
}

/** 웹훅 URL에서 `/lead-capture-webhook/` 뒤 시크릿(공개 폼 경로용) */
function extractWebhookSecretFromUrl(webhookUrl) {
  if (!webhookUrl || typeof webhookUrl !== 'string') return '';
  const m = webhookUrl.match(/\/lead-capture-webhook\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function formatLastActivity(date) {
  if (!date) return '—';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffM = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);
  if (diffM < 1) return '방금 전';
  if (diffM < 60) return `${diffM}분 전`;
  if (diffH < 24) return `${diffH}시간 전`;
  if (diffD < 7) return `${diffD}일 전`;
  return d.toLocaleDateString('ko-KR');
}

function formatReceivedAt(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

/** 캡처 채널 목록 행의 담당자 표시 (populate된 User 또는 ObjectId 문자열) */
function formatFormAssigneeLabels(row) {
  const list = row?.assigneeUserIds;
  if (!Array.isArray(list) || list.length === 0) return '—';
  return list
    .map((u) => {
      if (u && typeof u === 'object') {
        const n = (u.name && String(u.name).trim()) || '';
        if (n) return n;
        const em = (u.email && String(u.email).trim()) || '';
        if (em) return em;
      }
      const id = u && typeof u === 'object' && u._id != null ? String(u._id) : String(u || '');
      return id ? `사용자 …${id.slice(-6)}` : '';
    })
    .filter(Boolean)
    .join(', ') || '—';
}

function customFieldsSummary(customFields) {
  if (!customFields || typeof customFields !== 'object') return '—';
  const entries = Object.entries(customFields).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ');
}

/** data URL 또는 이미지 URL을 Blob으로 변환 (명함 업로드용) */
async function imageUrlToBlob(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:image')) {
    const res = await fetch(url);
    return await res.blob();
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await res.blob();
  }
  return null;
}

/**
 * 연락처 숫자만 있을 때 하이픈 포맷 (한국 형식)
 * 담당자 알림 메일 제목의 연락처 표기는 백엔드 `lib/email.js`에서 동일 규칙으로 맞춥니다.
 */
function formatPhoneForSave(value) {
  if (value == null || value === '') return '';
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length === 11 && digits.startsWith('010')) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith('02')) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 9 && digits.startsWith('2')) return `02-${digits.slice(1, 4)}-${digits.slice(4)}`;
  if (digits.length === 10 && digits.startsWith('01')) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length >= 9 && digits.length <= 11) return digits.replace(/(\d{2,3})(\d{3,4})(\d{4})/, '$1-$2-$3');
  return digits;
}

export default function LeadCapture() {
  const [items, setItems] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingForm, setEditingForm] = useState(null);

  const [settings, setSettings] = useState({ apiKeyPrefix: null, webhookUrl: null });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [copyFeedback, setCopyFeedback] = useState({
    apiKey: false,
    webhook: false,
    newKey: false,
    formId: null,
    embedCode: false,
    publicLink: false
  });
  const [apiKeyCopyHint, setApiKeyCopyHint] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [showCustomFieldsModal, setShowCustomFieldsModal] = useState(false);
  const [removingFieldId, setRemovingFieldId] = useState(null);
  const [selectedFormId, setSelectedFormId] = useState(null);
  const [selectedForm, setSelectedForm] = useState(null);
  const [channelLeads, setChannelLeads] = useState([]);
  const [channelLeadsLoading, setChannelLeadsLoading] = useState(false);
  const [showLeadsModal, setShowLeadsModal] = useState(false);
  const [showApiDocModal, setShowApiDocModal] = useState(false);
  const [leadImagePreview, setLeadImagePreview] = useState(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [lastClickedLeadIndex, setLastClickedLeadIndex] = useState(null);
  const [savingContacts, setSavingContacts] = useState(false);
  const [saveContactsFeedback, setSaveContactsFeedback] = useState(null);
  const [pushingMapped, setPushingMapped] = useState(false);
  const [pushMappedFeedback, setPushMappedFeedback] = useState(null);
  const [leadDetailOpen, setLeadDetailOpen] = useState(false);
  const [leadDetailContext, setLeadDetailContext] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [embedCodeText, setEmbedCodeText] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [showEmbedPreview, setShowEmbedPreview] = useState(false);
  const [apiKeyForPreview, setApiKeyForPreview] = useState('');

  const canManageCaptureChannels = isAdminOrAboveRole(getStoredCrmUser()?.role);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/settings`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setSettings({ apiKeyPrefix: data.apiKeyPrefix ?? null, webhookUrl: data.webhookUrl ?? null });
    } catch (_) {}
    finally { setSettingsLoading(false); }
  }, []);

  /** 초기 로드: 목록+설정 한 번에 조회 (슬립 모드 시 왕복 1회로 체감 속도 개선) */
  const fetchBootstrap = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/bootstrap`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '데이터를 불러올 수 없습니다.');
      setItems(data.items || []);
      setActiveCount(data.activeCount ?? 0);
      setSettings({
        apiKeyPrefix: data.settings?.apiKeyPrefix ?? null,
        webhookUrl: data.settings?.webhookUrl ?? null
      });
    } catch (err) {
      setError(err.message || '초기 데이터 조회 실패');
      setItems([]);
      setActiveCount(0);
    } finally {
      setLoading(false);
      setSettingsLoading(false);
    }
  }, []);

  const fetchCustomFields = useCallback(async (formId) => {
    if (!formId) { setCustomFields([]); return; }
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions?entityType=leadCapture&leadCaptureFormId=${encodeURIComponent(formId)}`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setCustomFields(data.items);
      else setCustomFields([]);
    } catch (_) { setCustomFields([]); }
  }, []);

  const fetchSelectedForm = useCallback(async (id) => {
    if (!id) { setSelectedForm(null); return; }
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/${id}`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data._id) setSelectedForm(data);
      else setSelectedForm(null);
    } catch (_) { setSelectedForm(null); }
  }, []);

  const fetchChannelLeads = useCallback(async (formId) => {
    if (!formId) { setChannelLeads([]); return; }
    setChannelLeadsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/${formId}/leads?limit=500&page=1`, {
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.items)) setChannelLeads(data.items);
      else setChannelLeads([]);
    } catch (_) { setChannelLeads([]); }
    finally { setChannelLeadsLoading(false); }
  }, []);

  const fetchList = useCallback(async () => {
    try {
      setError('');
      const res = await fetch(`${API_BASE}/lead-capture-forms`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '목록을 불러올 수 없습니다.');
      setItems(data.items || []);
      setActiveCount(data.activeCount ?? 0);
    } catch (err) {
      setError(err.message || '목록 조회 실패');
      setItems([]);
      setActiveCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBootstrap();
  }, [fetchBootstrap]);

  useEffect(() => {
    if (selectedFormId) {
      fetchSelectedForm(selectedFormId);
      fetchCustomFields(selectedFormId);
      fetchChannelLeads(selectedFormId);
    } else {
      setSelectedForm(null);
      setCustomFields([]);
      setChannelLeads([]);
    }
  }, [selectedFormId, fetchSelectedForm, fetchCustomFields, fetchChannelLeads]);

  useEffect(() => {
    if (!showLeadsModal) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowLeadsModal(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLeadsModal]);

  useEffect(() => {
    if (!leadImagePreview) return;
    const onKey = (e) => { if (e.key === 'Escape') setLeadImagePreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leadImagePreview]);

  useEffect(() => {
    setSelectedLeadIds([]);
    setLastClickedLeadIndex(null);
  }, [selectedFormId]);

  const handleLeadCheckboxChange = useCallback((leadId, index, shiftKey) => {
    const sid = String(leadId);
    setSelectedLeadIds((prev) => {
      const ids = channelLeads.map((l) => String(l._id));
      const next = new Set(prev.map(String));
      if (shiftKey && lastClickedLeadIndex != null) {
        const from = Math.min(lastClickedLeadIndex, index);
        const to = Math.max(lastClickedLeadIndex, index);
        for (let i = from; i <= to; i++) if (ids[i]) next.add(ids[i]);
      } else {
        if (next.has(sid)) next.delete(sid);
        else next.add(sid);
      }
      return Array.from(next);
    });
    setLastClickedLeadIndex(index);
  }, [channelLeads, lastClickedLeadIndex]);

  const handleSelectAllLeads = useCallback((checked, explicitIds) => {
    if (explicitIds) {
      setSelectedLeadIds(explicitIds.map(String));
    } else if (checked) {
      setSelectedLeadIds(channelLeads.map((l) => String(l._id)));
    } else {
      setSelectedLeadIds([]);
    }
    setLastClickedLeadIndex(null);
  }, [channelLeads]);

  const openLeadDetail = useCallback((lead) => {
    if (!selectedFormId || !lead?._id) return;
    setLeadDetailContext({
      formId: String(selectedFormId),
      leadId: String(lead._id),
      channelLabel: (selectedForm?.name && String(selectedForm.name).trim()) || '캡처 채널',
      channelSource: (selectedForm?.source && String(selectedForm.source).trim()) || '기타 채널'
    });
    setLeadDetailOpen(true);
  }, [selectedFormId, selectedForm?.name, selectedForm?.source]);

  const closeLeadDetail = useCallback(() => {
    setLeadDetailOpen(false);
    setLeadDetailContext(null);
  }, []);

  const handleSaveSelectedAsContacts = useCallback(async () => {
    const ids = selectedLeadIds.map(String);
    if (!ids.length) return;
    const toSave = channelLeads.filter((l) => ids.includes(String(l._id)));
    if (!toSave.length) return;
    setSavingContacts(true);
    setSaveContactsFeedback(null);
    let success = 0;
    let fail = 0;
    for (const lead of toSave) {
      try {
        const cf = lead.customFields || {};
        const phone = formatPhoneForSave(cf.phone ?? lead.phone ?? '');
        const payload = {
          name: (lead.name && String(lead.name).trim()) || '',
          email: (lead.email && String(lead.email).trim()) || '',
          phone,
          companyName: (cf.company && String(cf.company).trim()) || '',
          address: (cf.address && String(cf.address).trim()) || '',
          status: 'Lead',
          isIndividual: true
        };
        const res = await fetch(`${API_BASE}/customer-company-employees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const created = await res.json().catch(() => ({}));
          const businessCard = cf.business_card;
          const isImageUrl = typeof businessCard === 'string' && (businessCard.startsWith('data:image') || businessCard.startsWith('http'));
          if (created._id && isImageUrl) {
            try {
              const blob = await imageUrlToBlob(businessCard);
              if (blob) {
                const formData = new FormData();
                formData.append('image', blob, 'card.jpg');
                const uploadRes = await fetch(`${API_BASE}/customer-company-employees/${created._id}/business-card`, {
                  method: 'POST',
                  headers: getAuthHeader(),
                  credentials: 'include',
                  body: formData
                });
                if (!uploadRes.ok) { /* 명함만 실패해도 연락처는 성공 */ }
              }
            } catch (_) { /* 명함 업로드 실패 시 무시 */ }
          }
          success++;
        } else {
          fail++;
        }
      } catch (_) {
        fail++;
      }
    }
    setSavingContacts(false);
    setSaveContactsFeedback({ success, fail, total: toSave.length });
    setSelectedLeadIds([]);
    setLastClickedLeadIndex(null);
    if (success > 0) setTimeout(() => setSaveContactsFeedback(null), 3000);
  }, [selectedLeadIds, channelLeads]);

  const mappingModalOpen = searchParams.get('leadMapping') === '1' && !!selectedFormId;

  const openMappingModal = useCallback(() => {
    if (!selectedFormId) return;
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('leadMapping', '1');
        return p;
      },
      { replace: false }
    );
  }, [selectedFormId, setSearchParams]);

  const closeMappingModal = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete('leadMapping');
        return p;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const handleCrmMappingSaved = useCallback((data) => {
    if (data?._id) setSelectedForm((prev) => (prev && prev._id === data._id ? { ...prev, ...data } : prev));
  }, []);

  const handleCrmMappingPushComplete = useCallback((pushData) => {
    const s = pushData?.summary || {};
    const text =
      s.registerTarget === 'company'
        ? `고객사 신규 ${s.createdCompany ?? 0}건 · 동일 고객사(명+사업자번호) 스킵 ${s.skippedDuplicateCompany ?? 0}건 · 실패 ${s.failed ?? 0}건`
        : `연락처 신규 ${s.createdContact ?? 0}건 · 동일 연락처(이름+전화) 스킵 ${s.skippedDuplicateContact ?? 0}건 · 실패 ${s.failed ?? 0}건`;
    setPushMappedFeedback({ type: 'ok', text });
    setSelectedLeadIds([]);
    setLastClickedLeadIndex(null);
    setTimeout(() => setPushMappedFeedback(null), 5000);
  }, []);

  const handlePushMappedToCrm = useCallback(async () => {
    const ids = selectedLeadIds.map(String);
    if (!ids.length || !selectedFormId) return;
    const mappings = selectedForm?.crmFieldMapping?.mappings;
    if (!Array.isArray(mappings) || mappings.length === 0) {
      setPushMappedFeedback({ type: 'err', text: '먼저 「데이터 매핑」에서 매핑 시작으로 저장해 주세요.' });
      setTimeout(() => setPushMappedFeedback(null), 4000);
      return;
    }
    setPushingMapped(true);
    setPushMappedFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/${selectedFormId}/push-to-crm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        credentials: 'include',
        body: JSON.stringify({ leadIds: ids })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '등록 실패');
      const s = data.summary || {};
      const text =
        s.registerTarget === 'company'
          ? `고객사 신규 ${s.createdCompany ?? 0}건 · 동일 고객사(명+사업자번호) 스킵 ${s.skippedDuplicateCompany ?? 0}건 · 실패 ${s.failed ?? 0}건`
          : `연락처 신규 ${s.createdContact ?? 0}건 · 동일 연락처(이름+전화) 스킵 ${s.skippedDuplicateContact ?? 0}건 · 실패 ${s.failed ?? 0}건`;
      setPushMappedFeedback({ type: 'ok', text });
      setSelectedLeadIds([]);
      setLastClickedLeadIndex(null);
      setTimeout(() => setPushMappedFeedback(null), 5000);
    } catch (e) {
      setPushMappedFeedback({ type: 'err', text: e.message || '등록 실패' });
      setTimeout(() => setPushMappedFeedback(null), 5000);
    } finally {
      setPushingMapped(false);
    }
  }, [selectedLeadIds, selectedFormId, selectedForm?.crmFieldMapping]);

  async function handleRegenerateApiKey() {
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/regenerate-api-key`, {
        method: 'POST',
        headers: getAuthHeader(),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'API 키 발급에 실패했습니다.');
      setNewApiKey(data.apiKey || '');
      setShowApiKeyModal(true);
      fetchSettings();
    } catch (err) {
      setError(err.message || 'API 키 재발급 실패');
    }
  }

  async function handleCopyApiKey() {
    if (!settings.apiKeyPrefix) return;
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/reveal-api-key`, { headers: getAuthHeader(), credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      const fullKey = res.ok && data.apiKey ? data.apiKey : null;
      if (fullKey && copyToClipboard(fullKey)) {
        setCopyFeedback((f) => ({ ...f, apiKey: true }));
        setTimeout(() => setCopyFeedback((f) => ({ ...f, apiKey: false })), 1500);
      } else {
        setApiKeyCopyHint(true);
        setTimeout(() => setApiKeyCopyHint(false), 4000);
      }
    } catch (_) {
      setApiKeyCopyHint(true);
      setTimeout(() => setApiKeyCopyHint(false), 4000);
    }
  }

  function handleCopyWebhook() {
    const url = selectedForm?.webhookUrl ?? settings.webhookUrl;
    const text = webhookUrlForDisplay(url, BACKEND_BASE_URL) || url || '';
    if (copyToClipboard(text)) {
      setCopyFeedback((f) => ({ ...f, webhook: true }));
      setTimeout(() => setCopyFeedback((f) => ({ ...f, webhook: false })), 1500);
    }
  }

  function getPublicFormPageUrl() {
    const wUrl = selectedForm?.webhookUrl;
    if (!wUrl || typeof window === 'undefined') return '';
    const sec = extractWebhookSecretFromUrl(wUrl);
    if (!sec) return '';
    return `${window.location.origin}/lead-form/${encodeURIComponent(sec)}`;
  }

  function handleCopyPublicLink() {
    const text = getPublicFormPageUrl();
    if (!text || !copyToClipboard(text)) return;
    setCopyFeedback((f) => ({ ...f, publicLink: true }));
    setTimeout(() => setCopyFeedback((f) => ({ ...f, publicLink: false })), 1500);
  }

  function handleCopyNewApiKey() {
    if (copyToClipboard(newApiKey)) {
      setCopyFeedback((f) => ({ ...f, newKey: true }));
      setTimeout(() => setCopyFeedback((f) => ({ ...f, newKey: false })), 1500);
    }
  }

  function getEmbedSnippet() {
    return buildLeadCaptureEmbedSnippet({
      rawWebhookUrl: selectedForm?.webhookUrl || '',
      formId: selectedForm?._id || '',
      customFields: customFields || [],
      backendBaseUrl: BACKEND_BASE_URL
    });
  }

  function handleCopyEmbedCode() {
    const snippet = getEmbedSnippet();
    if (!snippet || !copyToClipboard(snippet)) return;
    setCopyFeedback((f) => ({ ...f, embedCode: true }));
    setTimeout(() => setCopyFeedback((f) => ({ ...f, embedCode: false })), 1500);
  }

  function handleCopyFormId(row) {
    const id = row._id || '';
    if (copyToClipboard(id)) {
      setCopyFeedback((f) => ({ ...f, formId: row._id }));
      setTimeout(() => setCopyFeedback((f) => ({ ...f, formId: null })), 2000);
    }
  }

  useEffect(() => {
    if (selectedForm?.webhookUrl) setEmbedCodeText(getEmbedSnippet());
  }, [selectedForm?._id, selectedForm?.webhookUrl, customFields?.length]);

  function handleLoadDefaultEmbedCode() {
    setEmbedCodeText(getEmbedSnippet());
  }

  function handleShowEmbedPreview() {
    let code = embedCodeText || getEmbedSnippet();
    if (apiKeyForPreview.trim()) {
      const safe = JSON.stringify(apiKeyForPreview.trim());
      code = code.replace(
        "var leadCaptureHeaders = { 'Content-Type': 'application/json' };",
        `var leadCaptureHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ${safe} };`
      );
    }
    setPreviewHtml(code);
    setShowEmbedPreview(true);
  }

  async function handleRemoveCustomField(def) {
    if (!window.confirm(`"${def.label}" 필드를 제거할까요?`)) return;
    setRemovingFieldId(def._id);
    try {
      const res = await fetch(`${API_BASE}/custom-field-definitions/${def._id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '제거에 실패했습니다.');
      }
      fetchCustomFields(selectedFormId);
    } catch (err) {
      setError(err.message || '필드 제거 실패');
    } finally {
      setRemovingFieldId(null);
    }
  }

  function openCreate() {
    setEditingForm(null);
    setModalOpen(true);
  }

  function openEdit(form) {
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      setError('캡처 채널 수정은 대표·관리자 권한만 가능합니다.');
      return;
    }
    setEditingForm(form);
    setModalOpen(true);
  }

  async function handleDelete(form) {
    if (!isAdminOrAboveRole(getStoredCrmUser()?.role)) {
      setError('캡처 채널 삭제는 대표·관리자 권한만 가능합니다.');
      return;
    }
    if (!window.confirm(`"${form.name}" 캡처 폼을 삭제할까요?`)) return;
    try {
      const res = await fetch(`${API_BASE}/lead-capture-forms/${form._id}`, {
        method: 'DELETE',
        headers: getAuthHeader(),
        credentials: 'include'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '삭제에 실패했습니다.');
      }
      if (selectedFormId === form._id) {
        setSelectedFormId(null);
        setSelectedForm(null);
      }
      fetchList();
    } catch (err) {
      setError(err.message || '삭제 실패');
    }
  }

  function handleSaved(created) {
    fetchList();
    if (created && created._id) {
      setSelectedFormId(created._id);
      if (created.webhookUrl != null) setSelectedForm(created);
      else fetchSelectedForm(created._id);
    }
  }

  return (
    <div className="page lead-capture-page">
      <header className="page-header lead-capture-header">
        <div className="lead-capture-header-text">
          <h1 className="page-title">리드 캡처</h1>
          <p className="lead-capture-subtitle">폼 및 API 연동을 설정하여 유입 리드를 수집합니다. (현재 로그인한 회사 기준)</p>
        </div>
        <div className="lead-capture-header-right">
          <button type="button" className="lead-capture-create-btn" onClick={openCreate}>
            <span className="material-symbols-outlined">add</span>
            새 캡처 폼 만들기
          </button>
          <PageHeaderNotifyChat />
        </div>
      </header>

      <div className="page-content lead-capture-content">
        {error && (
          <div className="lead-capture-error-banner">
            {error}
            <button type="button" onClick={() => setError('')} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        )}

        <section className="lead-capture-card lead-capture-table-card">
          <div className="lead-capture-card-head">
            <h2 className="lead-capture-card-title">캡처 채널</h2>
            <span className="lead-capture-card-meta">활성 폼 {activeCount}개</span>
          </div>
          <p className="lead-capture-channel-hint">
            사이트·캠페인마다 폼을 하나씩 만든 뒤, 행을 클릭하면 해당 채널을 선택합니다. 폼 ID·웹훅 URL은 선택한 채널의 외부 연동·API 문서에서 확인할 수 있습니다.
          </p>
          <div className="lead-capture-table-wrap">
            {loading ? (
              <p className="lead-capture-loading">불러오는 중…</p>
            ) : (
              <table className="lead-capture-table lead-capture-channels-table">
                <thead>
                  <tr>
                    <th>유입 경로</th>
                    <th>상태</th>
                    <th>총 리드</th>
                    <th>최근 활동</th>
                    <th>담당자</th>
                    {canManageCaptureChannels ? (
                      <>
                        <th className="lead-capture-th-action lead-capture-th-action-col">수정</th>
                        <th className="lead-capture-th-action lead-capture-th-action-col">삭제</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={canManageCaptureChannels ? 7 : 5} className="lead-capture-empty-cell">
                        등록된 캡처 폼이 없습니다. 새 캡처 폼 만들기를 눌러 추가하세요.
                      </td>
                    </tr>
                  ) : (
                    items.map((row) => (
                      <tr
                        key={row._id}
                        className={selectedFormId === row._id ? 'lead-capture-table-row-selected' : ''}
                        onClick={() => setSelectedFormId(row._id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedFormId(row._id); } }}
                      >
                        <td className="lead-capture-cell-name">{row.name}</td>
                        <td>
                          <span className={`lead-capture-status-badge ${row.status === 'active' ? 'active' : 'inactive'}`}>
                            <span className="lead-capture-status-dot" />
                            {row.status === 'active' ? '활성' : '비활성'}
                          </span>
                        </td>
                        <td className="lead-capture-cell-count">{(row.totalLeads ?? 0).toLocaleString()}</td>
                        <td className="lead-capture-cell-activity">{formatLastActivity(row.lastActivityAt)}</td>
                        <td className="lead-capture-cell-assignees" title={formatFormAssigneeLabels(row)}>
                          {formatFormAssigneeLabels(row)}
                        </td>
                        {canManageCaptureChannels ? (
                          <>
                            <td className="lead-capture-cell-action">
                              <button
                                type="button"
                                className="lead-capture-edit-btn lead-capture-row-inline-btn"
                                aria-label="수정"
                                onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  edit
                                </span>
                                <span className="lead-capture-row-btn-label">수정</span>
                              </button>
                            </td>
                            <td className="lead-capture-cell-action">
                              <button
                                type="button"
                                className="lead-capture-delete-btn lead-capture-row-inline-btn"
                                aria-label="삭제"
                                onClick={(e) => { e.stopPropagation(); handleDelete(row); }}
                              >
                                <span className="material-symbols-outlined" aria-hidden>
                                  delete
                                </span>
                                <span className="lead-capture-row-btn-label">삭제</span>
                              </button>
                            </td>
                          </>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {!selectedFormId ? (
          <section className="lead-capture-card lead-capture-placeholder-card">
            <p className="lead-capture-placeholder-text">캡처 채널을 선택하면 해당 채널의 리드 캡처 빌더, 외부 연동(API 키·웹훅 URL), API 문서가 여기에 표시됩니다.</p>
          </section>
        ) : (
        <>
        <div className="lead-capture-grid">
          <section className="lead-capture-main">
            <div className="lead-capture-card">
              <div className="lead-capture-card-head lead-capture-builder-head">
                <div>
                  <h2 className="lead-capture-card-title">리드 캡처 빌더</h2>
                  <p className="lead-capture-card-desc">이 채널 전용 수집 필드를 설정합니다.</p>
                </div>
                {canManageCaptureChannels ? (
                  <button type="button" className="lead-capture-outline-btn lead-capture-add-field-btn" onClick={() => setShowCustomFieldsModal(true)}>
                    <span className="material-symbols-outlined">add</span>
                    커스텀 필드 추가
                  </button>
                ) : null}
              </div>
              <div className="lead-capture-fields-grid">
                {DEFAULT_FIELDS.map((field, idx) => (
                  <div key={`default-${idx}`} className="lead-capture-field-card">
                    <div className="lead-capture-field-icon-wrap">
                      <span className="material-symbols-outlined">{field.icon}</span>
                    </div>
                    <div className="lead-capture-field-info">
                      <h3 className="lead-capture-field-label">{field.label}</h3>
                      <p className="lead-capture-field-meta">{field.meta}</p>
                    </div>
                    <span className="material-symbols-outlined lead-capture-drag-icon">drag_indicator</span>
                  </div>
                ))}
                {customFields.map((def) => (
                  <div key={def._id} className="lead-capture-field-card lead-capture-field-card-custom">
                    <div className="lead-capture-field-icon-wrap">
                      <span className="material-symbols-outlined">tune</span>
                    </div>
                    <div className="lead-capture-field-info">
                      <h3 className="lead-capture-field-label">{def.label}</h3>
                      <p className="lead-capture-field-meta">{typeToMeta(def.type, def.required)}</p>
                    </div>
                    <span className="material-symbols-outlined lead-capture-drag-icon">drag_indicator</span>
                    {canManageCaptureChannels ? (
                      <button
                        type="button"
                        className="lead-capture-field-remove-btn"
                        onClick={() => handleRemoveCustomField(def)}
                        disabled={removingFieldId === def._id}
                        aria-label={`${def.label} 제거`}
                        title={removingFieldId === def._id ? '제거 중…' : '제거하기'}
                      >
                        <span className="material-symbols-outlined">{removingFieldId === def._id ? 'hourglass_empty' : 'delete'}</span>
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="lead-capture-cta-card">
              <div className="lead-capture-cta-bg-icon">
                <span className="material-symbols-outlined">integration_instructions</span>
              </div>
              <div className="lead-capture-cta-text">
                <h3 className="lead-capture-cta-title">커스텀 폼 UI를 만들까요?</h3>
                <p className="lead-capture-cta-desc">아래 API 문서의 웹훅 URL과 formId는 이 채널에 맞게 자동 입력됩니다. 리드 캡처 빌더에 추가한 커스텀 필드도 임베드 코드에 포함되어 복사됩니다. YouTube 댓글처럼 임베드를 붙일 수 없는 곳은 오른쪽 외부 연동의 공개 링크 URL만 공유하세요.</p>
              </div>
              <button
                type="button"
                className="lead-capture-cta-btn"
                onClick={handleCopyEmbedCode}
                disabled={!selectedForm?.webhookUrl}
              >
                <span className="material-symbols-outlined">{copyFeedback.embedCode ? 'check' : 'code'}</span>
                {copyFeedback.embedCode ? '임베드 코드 복사됨' : '임베드 코드 복사'}
              </button>
            </div>

            {/* 임베드 코드 편집 + 미리보기 (미리보기에서 보내기 = 실제 등록) */}
            {selectedForm?.webhookUrl && (
              <div className="lead-capture-embed-preview-section">
                <h3 className="lead-capture-embed-preview-title">임베드 코드 편집 및 미리보기</h3>
                <p className="lead-capture-embed-preview-desc">코드를 수정한 뒤 미리보기를 누르면 폼이 렌더됩니다. 미리보기에서 제출(보내기)하면 실제로 리드가 등록됩니다.</p>
                <div className="lead-capture-embed-code-wrap">
                  <textarea
                    className="lead-capture-embed-code-textarea"
                    value={embedCodeText}
                    onChange={(e) => setEmbedCodeText(e.target.value)}
                    placeholder="임베드 코드가 채널 선택 시 자동으로 채워집니다."
                    spellCheck={false}
                    rows={14}
                  />
                  <div className="lead-capture-embed-code-actions">
                    <button type="button" className="lead-capture-embed-code-btn secondary" onClick={handleLoadDefaultEmbedCode}>
                      <span className="material-symbols-outlined">restart_alt</span> 기본 코드 불러오기
                    </button>
                    <label className="lead-capture-embed-api-key-label">
                      <span>API 키 (미리보기 제출용, 선택)</span>
                      <input
                        type="password"
                        className="lead-capture-embed-api-key-input"
                        value={apiKeyForPreview}
                        onChange={(e) => setApiKeyForPreview(e.target.value)}
                        placeholder="YOUR_API_KEY 대신 쓸 키"
                      />
                    </label>
                    <button
                      type="button"
                      className="lead-capture-embed-code-btn primary"
                      onClick={handleShowEmbedPreview}
                      disabled={!embedCodeText.trim()}
                    >
                      <span className="material-symbols-outlined">preview</span> 미리보기
                    </button>
                  </div>
                </div>
                {showEmbedPreview && (
                  <div className="lead-capture-embed-preview-wrap">
                    <div className="lead-capture-embed-preview-head">
                      <span className="lead-capture-embed-preview-label">미리보기</span>
                      <button type="button" className="lead-capture-embed-preview-close" onClick={() => setShowEmbedPreview(false)} aria-label="미리보기 닫기">
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                    <div className="lead-capture-embed-preview-body">
                      <iframe
                        title="리드 캡처 폼 미리보기"
                        className="lead-capture-embed-preview-iframe"
                        srcDoc={previewHtml}
                        sandbox="allow-scripts allow-forms"
                      />
                    </div>
                    <p className="lead-capture-embed-preview-hint">폼을 작성한 뒤 &quot;제출&quot; 버튼을 누르면 웹훅으로 실제 등록됩니다.</p>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="lead-capture-sidebar">
            <div className="lead-capture-card">
              <h2 className="lead-capture-card-title">외부 연동</h2>
              <div className="lead-capture-integration">
                <label className="lead-capture-label">
                  API 키
                  <span className="lead-capture-label-action" onClick={handleRegenerateApiKey} role="button" tabIndex={0}>재발급</span>
                </label>
                <div className="lead-capture-input-wrap">
                  <input
                    type="password"
                    className="lead-capture-input"
                    readOnly
                    value={settingsLoading ? '불러오는 중…' : (settings.apiKeyPrefix ? settings.apiKeyPrefix + '••••••••••••••••' : '미발급 (재발급 클릭)')}
                  />
                  <button type="button" className="lead-capture-copy-btn" aria-label="API 키 접두사 복사" onClick={handleCopyApiKey} disabled={!settings.apiKeyPrefix}>
                    <span className="material-symbols-outlined">{copyFeedback.apiKey ? 'check' : 'content_copy'}</span>
                  </button>
                </div>
                {apiKeyCopyHint && (
                  <p className="lead-capture-hint lead-capture-hint-emphasis">전체 키를 복사하려면 재발급을 한 번 해주세요. (재발급 후에는 복사 시 전체 키가 복사됩니다)</p>
                )}
                <p className="lead-capture-hint">랜딩·설문에서 요청 시 이 키로 인증합니다.</p>
                <label className="lead-capture-label">웹훅 URL (이 채널 전용)</label>
                <div className="lead-capture-input-wrap">
                  <input
                    type="text"
                    className="lead-capture-input"
                    readOnly
                    value={selectedForm?.webhookUrl != null
                      ? (webhookUrlForDisplay(selectedForm.webhookUrl, BACKEND_BASE_URL) || selectedForm.webhookUrl)
                      : (settingsLoading ? '…' : (webhookUrlForDisplay(settings.webhookUrl, BACKEND_BASE_URL) || settings.webhookUrl || '—'))}
                  />
                  <button type="button" className="lead-capture-copy-btn" aria-label="복사" onClick={handleCopyWebhook} disabled={!(selectedForm?.webhookUrl ?? settings.webhookUrl)}>
                    <span className="material-symbols-outlined">{copyFeedback.webhook ? 'check' : 'content_copy'}</span>
                  </button>
                </div>
                <p className="lead-capture-hint">백엔드: {BACKEND_BASE_URL}</p>
                <p className="lead-capture-hint">Typeform, Facebook 리드 등 서드파티에 이 URL을 설정하세요.</p>
                <label className="lead-capture-label">공개 링크</label>
                <p className="lead-capture-hint">
                  YouTube 댓글 등 HTML 없이 링크만 공유할 수 있습니다. 아래 페이지에서 문의를 받으며, API 키 없이 접속 가능하므로 링크는 필요한 곳에만 공유하세요.
                </p>
                {getPublicFormPageUrl() ? (
                  <>
                    <div className="lead-capture-input-wrap">
                      <input
                        type="text"
                        className="lead-capture-input"
                        readOnly
                        value={getPublicFormPageUrl()}
                      />
                      <button
                        type="button"
                        className="lead-capture-copy-btn"
                        aria-label="공개 링크 복사"
                        onClick={handleCopyPublicLink}
                      >
                        <span className="material-symbols-outlined">{copyFeedback.publicLink ? 'check' : 'content_copy'}</span>
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
            <div className="lead-capture-card">
              <div className="lead-capture-card-head" style={{ marginBottom: '0.75rem' }}>
                <h2 className="lead-capture-card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span className="material-symbols-outlined">integration_instructions</span>
                  API 매뉴얼
                </h2>
                <button
                  type="button"
                  className="lead-capture-fullview-btn"
                  onClick={() => setShowApiDocModal(true)}
                  disabled={!selectedFormId}
                >
                  전체보기
                  <span className="material-symbols-outlined">arrow_forward</span>
                </button>
              </div>
              <div className="lead-capture-stats">
                <div className="lead-capture-stat-row">
                  <span className="lead-capture-stat-label">메서드</span>
                  <span className="lead-capture-stat-value">POST</span>
                </div>
                <div className="lead-capture-stat-row">
                  <span className="lead-capture-stat-label">필수 필드</span>
                  <span className="lead-capture-stat-value">name, email</span>
                </div>
                <div className="lead-capture-stat-row">
                  <span className="lead-capture-stat-label">커스텀 필드</span>
                  <span className="lead-capture-stat-value">{customFields.length}개</span>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <section className="lead-capture-card lead-capture-leads-card">
          <div className="lead-capture-card-head lead-capture-builder-head">
            <div>
              <h2 className="lead-capture-card-title">수신된 리드</h2>
              <p className="lead-capture-leads-table-hint">
                표는 최근 5건 미리보기입니다. 체크 후 「데이터 매핑」을 누르면 <strong>선택한 리드만</strong> 등록합니다. 미선택 시 전체 리드가 등록됩니다.
              </p>
            </div>
            <div className="lead-capture-leads-actions">
              <button
                type="button"
                className="lead-capture-outline-btn lead-capture-fullview-btn"
                onClick={() => setShowLeadsModal(true)}
                disabled={channelLeadsLoading || channelLeads.length === 0}
              >
                전체보기
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
              <button
                type="button"
                className="lead-capture-outline-btn lead-capture-crm-map-btn"
                onClick={openMappingModal}
                disabled={!selectedFormId}
                title={selectedLeadIds.length > 0 ? `선택 ${selectedLeadIds.length}건 매핑` : '전체 리드 매핑'}
              >
                <span className="material-symbols-outlined">conversion_path</span>
                데이터 매핑{selectedLeadIds.length > 0 ? ` (${selectedLeadIds.length})` : ''}
              </button>
            </div>
          </div>
          {pushMappedFeedback && (
            <p className={`lead-capture-save-feedback ${pushMappedFeedback.type === 'err' ? 'lead-capture-push-feedback-err' : ''}`}>
              {pushMappedFeedback.text}
            </p>
          )}
          <div className="lead-capture-leads-wrap">
            {channelLeadsLoading ? (
              <p className="lead-capture-loading">불러오는 중…</p>
            ) : (
              <table className="lead-capture-table lead-capture-leads-table">
                <thead>
                  <tr>
                    <th className="lead-capture-th-checkbox">
                      <input
                        type="checkbox"
                        checked={channelLeads.length > 0 && selectedLeadIds.length === channelLeads.length && channelLeads.every((l) => selectedLeadIds.includes(String(l._id)))}
                        onChange={(e) => handleSelectAllLeads(e.target.checked)}
                        aria-label="전체 선택"
                      />
                    </th>
                    <th>회사명</th>
                    <th>이름</th>
                    <th>연락처</th>
                    <th>이메일</th>
                    <th>명함</th>
                  </tr>
                </thead>
                <tbody>
                  {channelLeads.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="lead-capture-empty-cell">
                        이 채널로 수신된 리드가 없습니다. 웹훅으로 제출되면 여기에 표시됩니다.
                      </td>
                    </tr>
                  ) : (
                    channelLeads.slice(0, 5).map((lead, idx) => {
                      const cf = lead.customFields || {};
                      const businessCard = cf.business_card;
                      const isImageUrl = typeof businessCard === 'string' && (businessCard.startsWith('data:image') || businessCard.startsWith('http'));
                      const isSelected = selectedLeadIds.includes(String(lead._id));
                      return (
                        <tr
                          key={lead._id}
                          className="lead-capture-leads-row--clickable"
                          onClick={() => openLeadDetail(lead)}
                        >
                          <td className="lead-capture-td-checkbox" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleLeadCheckboxChange(lead._id, idx, false)}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (e.shiftKey) {
                                  e.preventDefault();
                                  handleLeadCheckboxChange(lead._id, idx, true);
                                }
                              }}
                              aria-label={`${lead.name || '리드'} 선택`}
                            />
                          </td>
                          <td>{cf.company || '—'}</td>
                          <td className="lead-capture-cell-name">{lead.name}</td>
                          <td>{cf.phone || '—'}</td>
                          <td>{lead.email}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            {businessCard ? (
                              isImageUrl ? (
                                <button type="button" className="lead-capture-view-image-btn" onClick={() => setLeadImagePreview(businessCard)} aria-label="보기">
                                  <span className="material-symbols-outlined">visibility</span>
                                </button>
                              ) : (
                                <span className="lead-capture-cell-custom">첨부됨</span>
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
          {!channelLeadsLoading && channelLeads.length > 5 && (
            <p className="lead-capture-leads-more">최근 5건만 표시됩니다. 전체보기에서 나머지 리스트를 확인하세요.</p>
          )}
        </section>
        </>
        )}
      </div>

      {modalOpen && (
        <LeadCaptureFormModal
          form={editingForm}
          onClose={() => { setModalOpen(false); setEditingForm(null); }}
          onSaved={handleSaved}
        />
      )}

      {showApiKeyModal && (
        <div className="lead-capture-api-key-modal-overlay" role="dialog" aria-modal="true">
          <div className="lead-capture-api-key-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="lead-capture-api-key-modal-header">
              <h3 className="lead-capture-api-key-modal-title">API 키가 발급되었습니다</h3>
              <button type="button" className="lead-capture-form-modal-close" onClick={() => { setShowApiKeyModal(false); setNewApiKey(''); }} aria-label="닫기">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="lead-capture-api-key-modal-hint">아래 키를 복사해 두세요. 이 창을 닫으면 다시 볼 수 없습니다.</p>
            <div className="lead-capture-api-key-modal-input-wrap">
              <input type="text" className="lead-capture-api-key-modal-input" readOnly value={newApiKey} />
              <button type="button" className="lead-capture-api-key-modal-copy" onClick={handleCopyNewApiKey}>
                {copyFeedback.newKey ? '복사됨' : '복사'}
              </button>
            </div>
            <div className="lead-capture-api-key-modal-actions">
              <button type="button" className="lead-capture-form-modal-btn lead-capture-form-modal-btn-save" onClick={() => { setShowApiKeyModal(false); setNewApiKey(''); }}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {showCustomFieldsModal && selectedFormId && canManageCaptureChannels && (
        <CustomFieldsManageModal
          entityType="leadCapture"
          leadCaptureFormId={selectedFormId}
          onClose={() => setShowCustomFieldsModal(false)}
          onFieldAdded={() => fetchCustomFields(selectedFormId)}
          apiBase={API_BASE}
          getAuthHeader={getAuthHeader}
        />
      )}

      {leadImagePreview && (
        <div className="lead-capture-image-preview-overlay" role="dialog" aria-modal="true" aria-label="명함 이미지" onClick={() => setLeadImagePreview(null)}>
          <button type="button" className="lead-capture-image-preview-close" onClick={() => setLeadImagePreview(null)} aria-label="닫기">
            <span className="material-symbols-outlined">close</span>
          </button>
          <img src={leadImagePreview} alt="명함" className="lead-capture-image-preview-img" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {showApiDocModal && selectedForm && (
        <LeadCaptureApiDocModal
          backendBaseUrl={BACKEND_BASE_URL}
          webhookUrl={selectedForm.webhookUrl}
          formId={selectedForm._id}
          customFields={customFields}
          onClose={() => setShowApiDocModal(false)}
        />
      )}

      <LeadCaptureLeadsModal
        open={showLeadsModal}
        onClose={() => setShowLeadsModal(false)}
        channelLeads={channelLeads}
        selectedLeadIds={selectedLeadIds}
        onLeadCheckboxChange={handleLeadCheckboxChange}
        onSelectAllLeads={handleSelectAllLeads}
        onPreviewImage={setLeadImagePreview}
        onOpenMapping={openMappingModal}
      />

      <LeadCaptureCrmMappingModal
        open={mappingModalOpen}
        onClose={closeMappingModal}
        formId={selectedFormId}
        formName={selectedForm?.name}
        sampleLead={channelLeads[0] || null}
        initialCrmFieldMapping={selectedForm?.crmFieldMapping}
        customFieldDefinitions={customFields}
        onSaved={handleCrmMappingSaved}
        selectedLeadIds={selectedLeadIds}
        onPushComplete={handleCrmMappingPushComplete}
      />

      <HomeLeadDetailModal
        open={leadDetailOpen}
        formId={leadDetailContext?.formId}
        leadId={leadDetailContext?.leadId}
        channelLabel={leadDetailContext?.channelLabel}
        channelSource={leadDetailContext?.channelSource}
        onClose={closeLeadDetail}
        onUpdated={() => {
          if (selectedFormId) fetchChannelLeads(selectedFormId);
        }}
      />
    </div>
  );
}
