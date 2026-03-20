/** 로컬에 두고 레이아웃에서 폴링할 엑셀 가져오기 jobId 목록 */

const STORAGE_KEY = 'crm_cc_excel_import_jobs_v1';
const MAX_JOBS = 12;
const MAX_AGE_MS = 50 * 60 * 1000;

function readList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeList(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

export function addPendingExcelImportJob(jobId) {
  if (!jobId) return;
  const id = String(jobId);
  const now = Date.now();
  const list = readList().filter((j) => j && j.jobId && now - (j.addedAt || 0) < MAX_AGE_MS);
  const next = list.filter((j) => j.jobId !== id);
  next.push({ jobId: id, addedAt: now });
  writeList(next.slice(-MAX_JOBS));
}

export function removePendingExcelImportJob(jobId) {
  const id = String(jobId);
  const list = readList().filter((j) => j && j.jobId !== id);
  writeList(list);
}

export function getPendingExcelImportJobs() {
  const now = Date.now();
  return readList().filter((j) => j && j.jobId && now - (j.addedAt || 0) < MAX_AGE_MS);
}
