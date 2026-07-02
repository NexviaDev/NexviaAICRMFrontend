import { getAdminSiteFetchHeaders } from '@/lib/admin-site-headers';
import { hasCrmSession, getCrmToken, getCrmAuthHeaders, crmFetchInit, markCrmSessionActive, clearCrmSessionLocal, logoutCrmSession } from '@/lib/crm-auth';
import {
  ADMIN_MERGE_DATA_SHEET_URL_PARAM,
  MERGE_DATA_SHEET_URL_PARAM
} from '@/lib/merge-data-sheet-url';

function getCrmAuthHeader() {
  const token = getCrmToken();
  return token ? { ...getCrmAuthHeaders() } : {};
}

/** 일반 CRM — 회사별 테넌트 양식 + 공통 양식 조회 */
export const MERGE_RUNTIME_TENANT = {
  id: 'tenant',
  apiPrefix: '/quotation-merge',
  sheetUrlParam: MERGE_DATA_SHEET_URL_PARAM,
  pageTitle: '문서 메일머지',
  pageSubtitle: null,
  showRegistrationScopePicker: true,
  allowDeleteTemplate: (template, canDeleteByRole) => canDeleteByRole && !template?.isCommon,
  allowEditTemplateProfile: (template) => !template?.isCommon,
  getAuthHeaders: () => getCrmAuthHeader(),
  showCommonTemplateBadge: true
};

/** Nexvia Admin — 공통 양식만 등록·관리, 모든 회사에서 조회 가능 */
export const MERGE_RUNTIME_ADMIN_COMMON = {
  id: 'admin-common',
  apiPrefix: '/admin/quotation-merge',
  sheetUrlParam: ADMIN_MERGE_DATA_SHEET_URL_PARAM,
  pageTitle: '공통 문서 메일머지',
  pageSubtitle: '등록한 양식은 모든 회사 CRM에서 공통으로 표시됩니다.',
  showRegistrationScopePicker: false,
  allowDeleteTemplate: () => true,
  allowEditTemplateProfile: () => true,
  getAuthHeaders: (opts = {}) => getAdminSiteFetchHeaders({ json: !opts.formData }),
  showCommonTemplateBadge: false,
  forceCanManageMergeFields: true
};
