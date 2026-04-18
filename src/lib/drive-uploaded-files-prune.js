import { API_BASE } from '@/config';
import { pingBackendHealth } from '@/lib/backend-wake';
import { isValidDriveNodeId } from '@/lib/google-drive-url';

/**
 * Drive에만 없고 Mongo driveUploadedFiles 에만 남은 행을 제거합니다.
 * Admin 권한 없이 로그인 사용자만 있으면 됩니다.
 *
 * @param {object} opts
 * @param {() => Record<string, string>} opts.getAuthHeader
 * @param {string} opts.folderId
 * @param {string} [opts.customerCompanyId]
 * @param {string} [opts.customerCompanyEmployeeId]
 * @returns {Promise<{ removed: number, error?: string }>}
 */
export async function pruneDriveUploadedFilesIndex({
  getAuthHeader,
  folderId,
  customerCompanyId,
  customerCompanyEmployeeId
}) {
  const fid = (folderId != null && String(folderId).trim()) || '';
  if (!fid || !isValidDriveNodeId(fid)) {
    return { removed: 0 };
  }
  const cc = customerCompanyId != null && String(customerCompanyId).trim() ? String(customerCompanyId).trim() : '';
  const cce =
    customerCompanyEmployeeId != null && String(customerCompanyEmployeeId).trim()
      ? String(customerCompanyEmployeeId).trim()
      : '';
  if (!cc && !cce) {
    return { removed: 0 };
  }
  if (cc && cce) {
    return { removed: 0, error: 'customerCompanyId와 customerCompanyEmployeeId는 동시에 지정할 수 없습니다.' };
  }

  try {
    await pingBackendHealth(getAuthHeader);
    const res = await fetch(`${API_BASE}/drive/prune-uploaded-files-index`, {
      method: 'POST',
      headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        folderId: fid,
        ...(cc ? { customerCompanyId: cc } : {}),
        ...(cce ? { customerCompanyEmployeeId: cce } : {})
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || data.details || 'Drive 목록 정리에 실패했습니다.';
      return { removed: 0, error: String(msg) };
    }
    return { removed: Number(data.removed) || 0 };
  } catch {
    return { removed: 0, error: 'Drive 목록 정리에 실패했습니다.' };
  }
}
