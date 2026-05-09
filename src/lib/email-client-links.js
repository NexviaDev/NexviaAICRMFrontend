/**
 * 외부 메일 클라이언트로 보내기 (CRM Gmail 모달과 병행).
 * - Outlook 웹: 브라우저(OWA / outlook.live.com)
 * - PC 작성(받는 사람 채움): `mailto:` — Windows 기본 메일이 Outlook이면 데스크톱 Outlook 작성창이 열리고 To가 채워짐.
 *   (`ms-outlook://compose?to=` 는 새 Outlook 등에서 앱만 켜지고 수신자가 비는 경우가 많아 사용하지 않음.)
 */

/** @param {string} toSingleOrCommaSeparated */
export function buildOutlookOfficeComposeUrl(toSingleOrCommaSeparated) {
  const raw = String(toSingleOrCommaSeparated || '').trim();
  if (!raw) return '';
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(raw)}`;
}

/** 개인 @outlook.com / @hotmail.com 등에 가까운 웹 작성 화면 */
export function buildOutlookLiveComposeUrl(toSingleOrCommaSeparated) {
  const raw = String(toSingleOrCommaSeparated || '').trim();
  if (!raw) return '';
  return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(raw)}`;
}

/**
 * @param {string} toSingleOrCommaSeparated 쉼표로 여러 주소 가능 (ASCII 가정)
 */
export function buildMailtoComposeUrl(toSingleOrCommaSeparated) {
  const raw = String(toSingleOrCommaSeparated || '').trim();
  if (!raw) return '';
  return `mailto:${raw}`;
}

/** PC 기본 메일 작성창 + 받는 사람(Outlook 권장). `ms-outlook://compose` 대신 mailto 사용. */
export function buildMsOutlookDesktopComposeUrl(toSingleOrCommaSeparated) {
  return buildMailtoComposeUrl(toSingleOrCommaSeparated);
}

/**
 * 테이블·행 클릭 등과 겹칠 때 `<a href="mailto:">` 가 무반응인 경우가 있어,
 * 사용자 클릭 핸들러 안에서 `location.assign` 으로 OS 기본 메일을 연다.
 */
export function triggerMailtoCompose(toSingleOrCommaSeparated) {
  const href = buildMailtoComposeUrl(toSingleOrCommaSeparated);
  if (!href) return;
  window.location.assign(href);
}

/** mailto 전체 길이 상한(브라우저·OS·메일 핸들러 차이 대비; 초과 시 열리지 않거나 잘림) */
const MAILTO_HREF_SAFE_MAX = 1950;

/** Outlook 웹 작성 deeplink에 넣는 본문 글자 상한(전체 URL 한도·서버 제한 대비) */
export const OUTLOOK_WEB_BODY_CHAR_MAX = 3200;

/**
 * @param {{ to: string, cc?: string, subject?: string, body?: string }} fields
 * @returns {{ href: string, note: string, clipboardPlain: string | null }}
 *   `clipboardPlain`: URL 한도로 본문을 넣지 못할 때 전체 평문 본문 — 호출 측에서 클립보드로 복사 후 mailto 실행
 */
export function buildMailtoWithFields(fields) {
  const toPart = String(fields?.to || '').trim();
  if (!toPart) return { href: '', note: '', clipboardPlain: null };

  const subj = String(fields?.subject || '').trim() || '(제목 없음)';
  const ccT = String(fields?.cc || '').trim();
  const rawBody = String(fields?.body ?? '');

  const buildHref = (bodyStr) => {
    const qs = new URLSearchParams();
    if (ccT) qs.set('cc', ccT);
    qs.set('subject', subj);
    if (bodyStr.length > 0) qs.set('body', bodyStr);
    return `mailto:${toPart}?${qs.toString()}`;
  };

  const hrefFull = buildHref(rawBody);
  if (hrefFull.length <= MAILTO_HREF_SAFE_MAX) {
    return { href: hrefFull, note: '', clipboardPlain: null };
  }

  const hrefNoBody = buildHref('');
  if (hrefNoBody.length <= MAILTO_HREF_SAFE_MAX) {
    if (!rawBody.trim()) {
      return shrinkMailtoToFit(toPart, ccT, subj);
    }
    return {
      href: hrefNoBody,
      note:
        '본문이 길어 PC 메일 창에는 받는 사람·제목·참조만 반영했습니다. 전체 본문은 클립보드에 복사했으니 본문 칸에 붙여 넣어 주세요.',
      clipboardPlain: rawBody
    };
  }

  const meta = shrinkMailtoToFit(toPart, ccT, subj);
  if (!rawBody.trim()) return meta;
  return {
    ...meta,
    note: meta.note
      ? `${meta.note} 전체 본문은 클립보드에 복사했으니 붙여 넣어 주세요.`
      : '주소·제목·참조가 길어 일부만 반영했을 수 있습니다. 전체 본문은 클립보드에 복사했으니 확인 후 붙여 넣어 주세요.',
    clipboardPlain: rawBody
  };
}

/**
 * 제목·참조만으로도 mailto URL이 길 때 순차 축약
 * @returns {{ href: string, note: string, clipboardPlain: null }}
 */
function shrinkMailtoToFit(toPart, ccT, subj) {
  let subjectUsed = subj;
  let ccUsed = ccT;

  const tryBuild = () => {
    const qs = new URLSearchParams();
    if (ccUsed) qs.set('cc', ccUsed);
    qs.set('subject', subjectUsed);
    return `mailto:${toPart}?${qs.toString()}`;
  };

  let href = tryBuild();

  if (href.length > MAILTO_HREF_SAFE_MAX && ccUsed) {
    ccUsed = '';
    href = tryBuild();
  }

  while (href.length > MAILTO_HREF_SAFE_MAX && subjectUsed.length > 12) {
    subjectUsed = `${subjectUsed.slice(0, Math.max(8, Math.floor(subjectUsed.length * 0.82)))}…`;
    href = tryBuild();
  }

  if (href.length > MAILTO_HREF_SAFE_MAX) {
    return {
      href: `mailto:${toPart}`,
      note: '받는 사람만 넘겼습니다. 제목·참조는 CRM 작성 창에서 확인해 주세요.',
      clipboardPlain: null
    };
  }

  let note = '';
  if (subjectUsed !== subj || ccUsed !== ccT) {
    note = '제목 또는 참조가 길어 일부만 메일 앱에 넘겼습니다. CRM에서 전체를 확인해 주세요.';
  }
  return { href, note, clipboardPlain: null };
}

export function buildOutlookOfficeComposeFields({ to, subject, body }) {
  const p = new URLSearchParams();
  const t = String(to || '').trim();
  if (t) p.set('to', t);
  const s = String(subject || '').trim();
  if (s) p.set('subject', s.length > 400 ? `${s.slice(0, 397)}…` : s);
  const b = String(body ?? '');
  if (b) {
    p.set(
      'body',
      b.length > OUTLOOK_WEB_BODY_CHAR_MAX ? `${b.slice(0, OUTLOOK_WEB_BODY_CHAR_MAX - 20)}\n…(생략)` : b
    );
  }
  return `https://outlook.office.com/mail/deeplink/compose?${p.toString()}`;
}

export function buildOutlookLiveComposeFields({ to, subject, body }) {
  const p = new URLSearchParams();
  const t = String(to || '').trim();
  if (t) p.set('to', t);
  const s = String(subject || '').trim();
  if (s) p.set('subject', s.length > 400 ? `${s.slice(0, 397)}…` : s);
  const b = String(body ?? '');
  if (b) {
    p.set(
      'body',
      b.length > OUTLOOK_WEB_BODY_CHAR_MAX ? `${b.slice(0, OUTLOOK_WEB_BODY_CHAR_MAX - 20)}\n…(생략)` : b
    );
  }
  return `https://outlook.live.com/mail/0/deeplink/compose?${p.toString()}`;
}

export function triggerMailtoHref(href) {
  if (!href) return;
  window.location.assign(href);
}
