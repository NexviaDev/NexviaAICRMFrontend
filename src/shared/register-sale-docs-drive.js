/**
 * 증서·자료(Google Drive 루트 업로드 + CRM 리스트) — add-company-modal / customer-company-detail-modal /
 * customer-company-employees-detail-modal 에서 공통 사용.
 * Drive 메타 UI 스타일은 ./register-sale-docs-drive.css 에서만 관리합니다.
 */
import './register-sale-docs-drive.css';

import { API_BASE, MAX_DRIVE_JSON_UPLOAD_BYTES } from '@/config';
import {
  buildDriveFolderUrl,
  getDriveFileIdFromUrl,
  isValidDriveNodeId,
  pickDriveFolderOpenUrl,
  sanitizeDriveFolderWebViewLink
} from '@/lib/google-drive-url';

export function fileToBase64(file) {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

export function sortDriveUploadedFiles(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return [...raw].sort((a, b) => {
    const ta = new Date(a.modifiedTime || a.uploadedAt || 0).getTime();
    const tb = new Date(b.modifiedTime || b.uploadedAt || 0).getTime();
    return tb - ta;
  });
}

/** add-customer-company-employees-modal 의 buildBusinessCardDriveFileName 과 동일 규칙(확장자 제외 stem) */
function sanitizeFolderNamePartForBusinessCard(s, maxLen = 80) {
  const t = String(s ?? '')
    .replace(/[/\\*?:<>"|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** 연락처별 명함 Drive 파일명 접두(확장자 앞까지) — 동일 연락처가 명함을 다시 올리면 이 stem 으로 묶임 */
export function getBusinessCardDriveFileNameStem(contactLike) {
  if (!contactLike || typeof contactLike !== 'object') return '';
  const namePart =
    sanitizeFolderNamePartForBusinessCard(contactLike.name || '이름없음', 50).replace(/\s+/g, '_') || '이름없음';
  const contactRaw = (contactLike.phone || contactLike.email || '미등록').trim();
  const contactPart =
    sanitizeFolderNamePartForBusinessCard(contactRaw.replace(/[^\w\s가-힣@.-]/g, ' '), 45).replace(/\s+/g, '_') ||
    '미등록';
  return `명함_${namePart}_${contactPart}`;
}

/**
 * 동일 연락처 명함(파일명 stem 동일)이 CRM 배열에 여러 번 쌓인 경우 최신 한 건만 남김.
 * (명함 재등록 시 리스트에 구버전이 같이 보이지 않게)
 */
export function keepLatestBusinessCardRowOnlyInDriveUploads(sortedRows, contactLike) {
  if (!Array.isArray(sortedRows) || sortedRows.length === 0) return [];
  const stem = getBusinessCardDriveFileNameStem(contactLike);
  if (!stem || !stem.startsWith('명함_')) return sortedRows;

  const matching = [];
  const rest = [];
  for (const row of sortedRows) {
    const n = String(row?.name || '');
    if (n.startsWith(`${stem}.`)) {
      matching.push(row);
    } else {
      rest.push(row);
    }
  }
  if (matching.length <= 1) return sortedRows;
  matching.sort((a, b) => {
    const ta = new Date(a.modifiedTime || a.uploadedAt || 0).getTime();
    const tb = new Date(b.modifiedTime || b.uploadedAt || 0).getTime();
    return tb - ta;
  });
  return sortDriveUploadedFiles([...rest, matching[0]]);
}

export function formatDriveFileDate(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate).slice(0, 16);
  return d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

/** 수정 모달: driveUploadedFiles + 전용 사업자등록증 URL이 목록에 없을 때 한 줄 합침 */
export function mergeCertificateRowIntoDriveUploads(crmDriveUploadsSorted, companyToShow) {
  const sorted = crmDriveUploadsSorted;
  const certUrl = companyToShow?.businessRegistrationCertificateDriveUrl;
  const certUrlTrim = certUrl ? String(certUrl).trim() : '';
  const certId = certUrlTrim ? getDriveFileIdFromUrl(certUrlTrim) : null;
  const hasCertInList = sorted.some((row) => {
    const fid = row.driveFileId && String(row.driveFileId).trim();
    if (certId && fid && fid === certId) return true;
    const wv = row.webViewLink && String(row.webViewLink).trim();
    if (certUrlTrim && wv && wv === certUrlTrim) return true;
    return false;
  });
  const merged = [...sorted];
  if (certUrlTrim && certId && isValidDriveNodeId(certId) && !hasCertInList) {
    merged.push({
      driveFileId: certId,
      name: '사업자등록증',
      webViewLink: certUrlTrim,
      modifiedTime: companyToShow.updatedAt || '',
      uploadedAt: companyToShow.updatedAt || ''
    });
  }
  merged.sort((a, b) => {
    const ta = new Date(a.modifiedTime || a.uploadedAt || 0).getTime();
    const tb = new Date(b.modifiedTime || b.uploadedAt || 0).getTime();
    return tb - ta;
  });
  return merged;
}

export function resolveCompanyDriveMongoRegisteredUrl(companyToShow, driveFolderId, driveFolderLink) {
  const id = companyToShow?.driveCustomerRootFolderId || driveFolderId;
  const raw = companyToShow?.driveCustomerRootFolderWebViewLink;
  const fromDb = id ? sanitizeDriveFolderWebViewLink(raw, id) : '';
  if (fromDb) return fromDb;
  return driveFolderLink || '';
}

const MB_LIMIT = () => Math.floor(MAX_DRIVE_JSON_UPLOAD_BYTES / (1024 * 1024));

/**
 * 루트 폴더 JSON 업로드 공통 처리(용량 분리 · 병렬 업로드 · 성공 안내).
 */
export async function runDriveDirectFileUpload({
  files,
  driveFolderId,
  driveFolderLink,
  ensureParentFolder,
  buildUploadBody,
  getAuthHeader,
  setDriveUploading,
  setDriveError,
  setDriveUploadNotice,
  onSuccess,
  canStart = () => true
}) {
  const filesArray = Array.from(files || []);
  if (!filesArray.length) return;
  if (!canStart()) return;

  setDriveUploading(true);
  setDriveError('');
  setDriveUploadNotice('');
  try {
    let parentId = driveFolderId;
    if (!parentId) {
      try {
        const ensured = await ensureParentFolder();
        parentId = ensured?.id || null;
      } catch (e) {
        setDriveError(e.message || '폴더를 준비할 수 없습니다.');
        return;
      }
      if (!parentId) {
        setDriveError('폴더를 준비할 수 없습니다.');
        return;
      }
    }

    const tooLargeForApi = filesArray.filter((file) => Number(file?.size || 0) > MAX_DRIVE_JSON_UPLOAD_BYTES);
    const apiUploadFiles = filesArray.filter((file) => Number(file?.size || 0) <= MAX_DRIVE_JSON_UPLOAD_BYTES);
    if (tooLargeForApi.length > 0) {
      const folderUrlForLarge =
        buildDriveFolderUrl(parentId) || pickDriveFolderOpenUrl(parentId, driveFolderLink);
      const names = tooLargeForApi.slice(0, 3).map((file) => file.name).join(', ');
      const more = tooLargeForApi.length > 3 ? ` 외 ${tooLargeForApi.length - 3}건` : '';
      const canOpenFolder =
        folderUrlForLarge &&
        typeof folderUrlForLarge === 'string' &&
        folderUrlForLarge.startsWith('https://drive.google.com/') &&
        !folderUrlForLarge.includes('undefined');
      if (canOpenFolder) {
        window.open(folderUrlForLarge, '_blank', 'noopener,noreferrer');
      }
      setDriveError(
        canOpenFolder
          ? `약 ${MB_LIMIT()}MB를 넘는 파일은 이 창에서 한 번에 올릴 수 없습니다. 해당 Google Drive 폴더를 새 창으로 열었으니, 거기에서 직접 업로드해 주세요: ${names}${more}`
          : `약 ${MB_LIMIT()}MB를 넘는 파일은 이 창에서 한 번에 올릴 수 없습니다. 폴더 주소를 확인한 뒤 Drive에서 직접 올려 주세요: ${names}${more}`
      );
      if (canOpenFolder && !apiUploadFiles.length) {
        setDriveUploadNotice('업로드 후 「목록 새로고침」으로 CRM 목록에 반영할 수 있습니다.');
        window.setTimeout(() => setDriveUploadNotice(''), 8000);
      }
    }
    if (!apiUploadFiles.length) {
      return;
    }

    let uploadFailed = false;
    const uploadOne = async (file) => {
      const contentBase64 = await fileToBase64(file);
      if (!contentBase64) {
        uploadFailed = true;
        setDriveError((prev) => prev || `"${file.name}" 파일 읽기에 실패했습니다.`);
        return;
      }
      const body = buildUploadBody(file, contentBase64, parentId);
      const up = await fetch(`${API_BASE}/drive/upload`, {
        method: 'POST',
        headers: { ...getAuthHeader(), 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) {
        uploadFailed = true;
        setDriveError((prev) => prev || upData.error || '업로드 실패');
      }
    };
    await Promise.all(apiUploadFiles.map((file) => uploadOne(file)));
    if (!uploadFailed) {
      setDriveUploadNotice(
        `${apiUploadFiles.length}개 파일을 업로드했습니다. CRM 기록 목록에도 저장되었습니다.`
      );
      window.setTimeout(() => setDriveUploadNotice(''), 8000);
      await onSuccess?.();
    }
  } catch (_) {
    setDriveError('Drive에 연결할 수 없습니다.');
  } finally {
    setDriveUploading(false);
  }
}

/**
 * CRM Drive 파일 테이블(제목 · 수정일 · 다운로드 · 삭제)
 */
export function RegisterSaleDocsCrmTable({
  rows,
  formatDriveFileDate: formatDate = formatDriveFileDate,
  driveUploading,
  crmDriveDeletingId,
  onDeleteRow
}) {
  return (
    <div className="register-sale-docs-crm-table-wrap">
      <table className="register-sale-docs-crm-table">
        <thead>
          <tr>
            <th scope="col">제목</th>
            <th scope="col">수정일</th>
            <th scope="col">다운로드</th>
            <th scope="col">삭제</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const pending = Boolean(row.isPendingUpload) || String(row.driveFileId || '') === '__pending__';
            const href = (row.webViewLink && String(row.webViewLink).trim()) || '';
            const safeHref =
              href.startsWith('https://drive.google.com/') && !href.includes('undefined') ? href : '';
            const fid = row.driveFileId && String(row.driveFileId).trim();
            const downloadHref =
              !pending && fid && isValidDriveNodeId(fid)
                ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fid)}`
                : '';
            const rowOpenable = Boolean(safeHref) && !pending;
            return (
              <tr
                key={`${row.driveFileId || 'f'}-${idx}`}
                className={
                  pending
                    ? 'register-sale-docs-crm-row register-sale-docs-crm-row--pending'
                    : rowOpenable
                      ? 'register-sale-docs-crm-row register-sale-docs-crm-row--clickable'
                      : 'register-sale-docs-crm-row'
                }
                tabIndex={rowOpenable ? 0 : undefined}
                onClick={() => {
                  if (safeHref) window.open(safeHref, '_blank', 'noopener,noreferrer');
                }}
                onKeyDown={(e) => {
                  if (!rowOpenable) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    window.open(safeHref, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                <td className="register-sale-docs-crm-cell-name">{row.name || '—'}</td>
                <td className="register-sale-docs-crm-cell-date">
                  {pending ? '저장 시 Drive에 반영' : formatDate(row.modifiedTime || row.uploadedAt)}
                </td>
                <td className="register-sale-docs-crm-cell-actions register-sale-docs-crm-cell-actions--dual">
                  {downloadHref ? (
                    <a
                      href={downloadHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="register-sale-docs-crm-download"
                      title="다운로드"
                      aria-label="다운로드"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        download
                      </span>
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="register-sale-docs-crm-cell-delete">
                  {pending ? (
                    <button
                      type="button"
                      className="register-sale-docs-crm-delete register-sale-docs-crm-delete--pending"
                      title="준비 취소"
                      aria-label="준비 취소"
                      disabled={Boolean(driveUploading)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRow(row);
                      }}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        close
                      </span>
                    </button>
                  ) : fid && isValidDriveNodeId(fid) ? (
                    <button
                      type="button"
                      className="register-sale-docs-crm-delete"
                      title="Drive에서 삭제"
                      aria-label="Drive에서 삭제"
                      disabled={Boolean(driveUploading) || crmDriveDeletingId === fid}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRow(row);
                      }}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        {crmDriveDeletingId === fid ? 'hourglass_empty' : 'delete'}
                      </span>
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
