/**
 * @param {Record<string, unknown>} meta
 * @param {string} [meta.accessRole] — calendarList 항목의 accessRole (freeBusyReader 등)
 */
function strTrim(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

function personLabel(p) {
  if (!p || typeof p !== 'object') return '';
  const dn = strTrim(p.displayName);
  if (dn) return dn;
  return strTrim(p.email);
}

/**
 * Google Calendar API Event — 웹은 summary 없이도 eventType·위치·주최 등으로 문구를 그리지만,
 * API는 공유 수준에 따라 summary를 비우기도 한다. 표시용 제목을 최대한 맞춘다.
 * @param {Record<string, unknown>} gev — events.list / events.get 항목
 * @param {Record<string, unknown>} [meta]
 * @returns {string} 빈 문자열이면 호출측에서 '(제목 없음)' 등 처리
 */
export function googleEventDisplayTitle(gev, meta = {}) {
  if (!gev || typeof gev !== 'object') return '';
  const s = strTrim(gev.summary);
  if (s) return s;

  const et = gev.eventType || 'default';

  if (et === 'focusTime') return '집중 시간';
  if (et === 'outOfOffice') return '부재 중';

  if (et === 'workingLocation') {
    const w = gev.workingLocationProperties;
    if (!w || typeof w !== 'object') return '근무 위치';
    if (w.type === 'homeOffice') return '재택 근무';
    if (w.type === 'officeLocation') {
      const label = w.officeLocation && typeof w.officeLocation.label === 'string' ? w.officeLocation.label.trim() : '';
      return label || '사무실';
    }
    if (w.type === 'customLocation') {
      const label = w.customLocation && typeof w.customLocation.label === 'string' ? w.customLocation.label.trim() : '';
      return label || '근무 위치';
    }
    return '근무 위치';
  }

  if (et === 'birthday') {
    const bp = gev.birthdayProperties;
    if (bp && typeof bp === 'object') {
      if (typeof bp.customTypeName === 'string' && bp.customTypeName.trim()) return bp.customTypeName.trim();
      if (bp.type === 'birthday') return '생일';
      if (bp.type === 'anniversary') return '기념일';
      if (bp.type === 'self') return '내 생일';
    }
    return '생일 · 기념일';
  }

  if (et === 'fromGmail') return 'Gmail 일정';

  const loc = strTrim(gev.location);
  if (loc) return loc.length > 80 ? `${loc.slice(0, 77)}…` : loc;

  const cr = personLabel(gev.creator);
  if (cr) return cr;

  const org = personLabel(gev.organizer);
  if (org) return org;

  const atts = gev.attendees;
  if (Array.isArray(atts)) {
    for (const a of atts) {
      if (!a || typeof a !== 'object' || a.self) continue;
      const label = personLabel(a);
      if (label) return label;
    }
  }

  const role = strTrim(meta.accessRole);
  if (role === 'freeBusyReader' || role === 'freeBusyUser') {
    return '일정 (바쁨/한가함만 공유 · 제목 미표시)';
  }

  return '';
}
