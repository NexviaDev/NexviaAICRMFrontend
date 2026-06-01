import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { normalizeMergePdfExportOptions } from '@/lib/merge-pdf-export-options';

/** @typedef {{ templateId: string, pdfExportOptions?: object, mailDefaults?: { mailTo?: string, mailCc?: string, mailSubject?: string, mailBody?: string } }} MergeTemplateProfile */

/** @param {Record<string, MergeTemplateProfile>} profiles */
export function normalizeTemplateProfilesMap(profiles) {
  const raw = profiles && typeof profiles === 'object' ? profiles : {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const templateId = String(v.templateId || k).trim();
    if (!templateId) continue;
    out[templateId] = {
      templateId,
      pdfExportOptions: normalizeMergePdfExportOptions(v.pdfExportOptions || {}),
      mailDefaults: {
        mailTo: String(v.mailDefaults?.mailTo ?? '').slice(0, 2000),
        mailCc: String(v.mailDefaults?.mailCc ?? '').slice(0, 2000),
        mailSubject: String(v.mailDefaults?.mailSubject ?? '').slice(0, 500),
        mailBody: String(v.mailDefaults?.mailBody ?? '').slice(0, 12000)
      }
    };
  }
  return out;
}

/** @param {() => object} getAuthHeader */
export async function fetchMergeTemplateProfiles(getAuthHeader) {
  await pingBackendHealth();
  const res = await fetch(`${API_BASE}/quotation-merge/template-profiles`, {
    headers: { ...getAuthHeader() },
    credentials: 'include'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '양식별 PDF·메일 설정을 불러오지 못했습니다.');
  return normalizeTemplateProfilesMap(data.profiles);
}

/** @param {() => object} getAuthHeader */
export async function patchMergeTemplateProfile(getAuthHeader, templateId, payload = {}) {
  const tid = String(templateId || '').trim();
  if (!tid) throw new Error('양식 ID가 필요합니다.');
  await pingBackendHealth();
  const scope = payload.registrationScope === 'personal' ? 'personal' : 'company';
  const body = {
    registrationScope: scope,
    pdfExportOptions: normalizeMergePdfExportOptions(payload.pdfExportOptions || {}),
    mailDefaults: {
      mailTo: String(payload.mailDefaults?.mailTo ?? '').slice(0, 2000),
      mailCc: String(payload.mailDefaults?.mailCc ?? '').slice(0, 2000),
      mailSubject: String(payload.mailDefaults?.mailSubject ?? '').slice(0, 500),
      mailBody: String(payload.mailDefaults?.mailBody ?? '').slice(0, 12000)
    }
  };
  const res = await fetch(`${API_BASE}/quotation-merge/templates/${encodeURIComponent(tid)}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '양식 설정 저장에 실패했습니다.');
  return data;
}

export function resolvePdfExportOptionsForRow(
  row,
  templateProfilesById,
  globalOpts,
  templateIds
) {
  if (row?._pdfExportOptions) return normalizeMergePdfExportOptions(row._pdfExportOptions);
  for (const id of templateIds || []) {
    const prof = templateProfilesById?.[String(id)];
    if (prof?.pdfExportOptions) return normalizeMergePdfExportOptions(prof.pdfExportOptions);
  }
  return normalizeMergePdfExportOptions(globalOpts);
}
