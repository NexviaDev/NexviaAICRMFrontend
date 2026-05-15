import * as XLSX from 'xlsx';

const HANGUL_RE = /[\uAC00-\uD7A3]/g;
const REPLACEMENT_RE = /\uFFFD/g;
/** UTF-8을 Latin-1 등으로 잘못 읽었을 때 흔한 패턴 */
const MOJIBAKE_RE = /[\u00C3\u00C2\u00E2][\u0080-\u00BF]|[\u00EC-\u00EF][\u0080-\u00BF]{2}/g;

function scoreDecodedCsvText(text) {
  if (!text || typeof text !== 'string') return -1e6;
  const hangul = (text.match(HANGUL_RE) || []).length;
  const replacement = (text.match(REPLACEMENT_RE) || []).length;
  const mojibake = (text.match(MOJIBAKE_RE) || []).length;
  const sample = text.slice(0, 12000);
  return hangul * 12 - replacement * 80 - mojibake * 8 - (sample.length - hangul) * 0.001;
}

function stripUtf8Bom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.slice(3);
  }
  return bytes;
}

function decodeWithLabel(bytes, label) {
  try {
    return new TextDecoder(label, { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/**
 * CSV 바이트 → 문자열 (UTF-8 BOM / UTF-8 / EUC-KR·CP949 계열 자동 선택)
 * Google 주소록보내기(UTF-8)와 Excel에서 저장한 CSV(CP949) 모두 대응.
 */
export function decodeCsvBytesToString(bytes) {
  const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const payload = stripUtf8Bom(raw);

  const utf8 = decodeWithLabel(payload, 'utf-8');
  let euckr = '';
  try {
    euckr = decodeWithLabel(payload, 'euc-kr');
  } catch {
    euckr = '';
  }

  const utf8Score = scoreDecodedCsvText(utf8);
  const euckrScore = scoreDecodedCsvText(euckr);

  if (euckr && euckrScore > utf8Score + 4) return euckr;
  return utf8;
}

function isCsvFile(file) {
  const name = (file?.name || '').toLowerCase();
  return name.endsWith('.csv') || file?.type === 'text/csv';
}

function sheetToRowObjects(wb) {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트가 없습니다.');
  const sheet = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return Array.isArray(json) ? json : [];
}

/**
 * .xlsx / .xls / .csv → 객체 배열 (첫 시트, 첫 행 헤더)
 */
export async function readSpreadsheetFileToRows(file) {
  if (!file) return [];

  if (isCsvFile(file)) {
    const buf = await file.arrayBuffer();
    const csvText = decodeCsvBytesToString(new Uint8Array(buf));
    const wb = XLSX.read(csvText, { type: 'string', raw: false });
    return sheetToRowObjects(wb);
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  return sheetToRowObjects(wb);
}
