/**
 * 외부 메일 클라이언트로 보내기 (CRM 작성 모달의 mailto 흐름과 병행).
 * - Outlook 웹: 브라우저(OWA / outlook.live.com)
 * - PC 작성(받는 사람 채움): `mailto:` — Windows 기본 메일이 Outlook이면 데스크톱 Outlook 작성창이 열리고 To가 채워짐.
 *   (`ms-outlook://compose?to=` 는 새 Outlook 등에서 앱만 켜지고 수신자가 비는 경우가 많아 사용하지 않음.)
 */

/** mailto 불투명 구간: 주소는 `,` 로만 구분하는 편이 안전. `, ` 처럼 쉼표 뒤 공백은 URL에 `%20`으로 보이고 콘솔 로그가 지저분해짐 */
export function normalizeMailtoRecipientList(raw) {
  return String(raw || '')
    .split(/[,;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(',');
}

/** @param {string} toSingleOrCommaSeparated */
export function buildOutlookOfficeComposeUrl(toSingleOrCommaSeparated) {
  const raw = normalizeMailtoRecipientList(toSingleOrCommaSeparated);
  if (!raw) return '';
  return `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(raw)}`;
}

/** 개인 @outlook.com / @hotmail.com 등에 가까운 웹 작성 화면 */
export function buildOutlookLiveComposeUrl(toSingleOrCommaSeparated) {
  const raw = normalizeMailtoRecipientList(toSingleOrCommaSeparated);
  if (!raw) return '';
  return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(raw)}`;
}

/**
 * @param {string} toSingleOrCommaSeparated 쉼표로 여러 주소 가능 (ASCII 가정)
 */
export function buildMailtoComposeUrl(toSingleOrCommaSeparated) {
  const raw = normalizeMailtoRecipientList(toSingleOrCommaSeparated);
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
  const toPart = normalizeMailtoRecipientList(fields?.to);
  if (!toPart) return { href: '', note: '', clipboardPlain: null };

  const subj = String(fields?.subject || '').trim() || '(제목 없음)';
  const ccT = normalizeMailtoRecipientList(fields?.cc || '');
  const rawBody = String(fields?.body ?? '');

  /** URLSearchParams는 공백을 `+`로 넣는데, mailto+데스크톱 Outlook이 이를 공백이 아니라 글자 `+`로 보이는 경우가 있어 %20 조립을 씁니다. */
  const buildHref = (bodyStr) => {
    const parts = [];
    if (ccT) parts.push(`cc=${encodeURIComponent(ccT)}`);
    parts.push(`subject=${encodeURIComponent(subj)}`);
    if (bodyStr.length > 0) parts.push(`body=${encodeURIComponent(bodyStr)}`);
    return `mailto:${toPart}?${parts.join('&')}`;
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
    const parts = [];
    if (ccUsed) parts.push(`cc=${encodeURIComponent(ccUsed)}`);
    parts.push(`subject=${encodeURIComponent(subjectUsed)}`);
    return `mailto:${toPart}?${parts.join('&')}`;
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
  const parts = [];
  const t = String(to || '').trim();
  if (t) parts.push(`to=${encodeURIComponent(t)}`);
  const s = String(subject || '').trim();
  if (s) parts.push(`subject=${encodeURIComponent(s.length > 400 ? `${s.slice(0, 397)}…` : s)}`);
  const b = String(body ?? '');
  if (b) {
    const clipped =
      b.length > OUTLOOK_WEB_BODY_CHAR_MAX ? `${b.slice(0, OUTLOOK_WEB_BODY_CHAR_MAX - 20)}\n…(생략)` : b;
    parts.push(`body=${encodeURIComponent(clipped)}`);
  }
  return `https://outlook.office.com/mail/deeplink/compose?${parts.join('&')}`;
}

export function buildOutlookLiveComposeFields({ to, subject, body }) {
  const parts = [];
  const t = String(to || '').trim();
  if (t) parts.push(`to=${encodeURIComponent(t)}`);
  const s = String(subject || '').trim();
  if (s) parts.push(`subject=${encodeURIComponent(s.length > 400 ? `${s.slice(0, 397)}…` : s)}`);
  const b = String(body ?? '');
  if (b) {
    const clipped =
      b.length > OUTLOOK_WEB_BODY_CHAR_MAX ? `${b.slice(0, OUTLOOK_WEB_BODY_CHAR_MAX - 20)}\n…(생략)` : b;
    parts.push(`body=${encodeURIComponent(clipped)}`);
  }
  return `https://outlook.live.com/mail/0/deeplink/compose?${parts.join('&')}`;
}

/**
 * OS 기본 메일로 mailto 위임. Chromium 계열은 보안·디버깅용으로 콘솔에
 * `Launched external handler for 'mailto:…'` 가 찍히는데, 앱 오류가 아니며 JS로 숨길 수 없습니다.
 */
export function triggerMailtoHref(href) {
  if (!href) return;
  window.location.assign(href);
}

/** 클립보드 HTML — 스크립트 등 제거(붙여넣기용) */
export function sanitizeHtmlForEmailClipboard(html) {
  if (!html || typeof html !== 'string') return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const n = attr.name.toLowerCase();
        if (
          n.startsWith('on') ||
          n === 'srcdoc' ||
          (n === 'href' && /^\s*javascript:/i.test(attr.value))
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body ? doc.body.innerHTML : '';
  } catch {
    return String(html);
  }
}

/**
 * mailto 본문에는 평문만 들어가 서식이 사라짐 — 표·굵게·색·명함 등이 있으면 true
 * @param {string} html
 */
export function htmlBodyAppearsFormatted(html) {
  const s = String(html || '').trim();
  if (!s) return false;
  if (/<table[\s>]/i.test(s)) return true;
  if (/<(b|strong|i|em|u|h[1-6]|ul|ol|li)\b/i.test(s)) return true;
  if (/<a\s[^>]*href/i.test(s)) return true;
  if (/<span[^>]*\sstyle\s*=/i.test(s)) return true;
  if (/<font\b/i.test(s)) return true;
  if (/nexvia-email-signature|email-reply-quote-block|email-compose-drive-link/i.test(s)) return true;
  try {
    const doc = new DOMParser().parseFromString(s, 'text/html');
    if (doc.body?.querySelector('b,strong,i,em,u,table,a[href],span[style],font,h1,h2,h3,ul,ol,li')) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Outlook 등 — text/html + text/plain 동시 복사(붙여넣기 시 서식 유지)
 * @param {{ html?: string, plain?: string }} payload
 * @returns {Promise<boolean>}
 */
export async function writeEmailBodyToClipboard(payload) {
  const htmlRaw = sanitizeHtmlForEmailClipboard(payload?.html || '');
  const html = htmlRaw.trim();
  const plain = String(payload?.plain ?? '').trim() || (html ? htmlToPlainFallback(html) : '');
  if (!html && !plain) return true;

  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      /** @type {Record<string, Blob>} */
      const blobMap = {};
      if (plain) blobMap['text/plain'] = new Blob([plain], { type: 'text/plain' });
      if (html) blobMap['text/html'] = new Blob([html], { type: 'text/html' });
      if (Object.keys(blobMap).length === 0) return false;
      await navigator.clipboard.write([new ClipboardItem(blobMap)]);
      return true;
    }
    if (plain && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plain);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function htmlToPlainFallback(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body?.textContent || '').replace(/\r\n/g, '\n').trim();
  } catch {
    return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/** 서식 본문용 — mailto URL에 body를 넣지 않을 때 안내 문구 */
export const MAILTO_RICH_BODY_CLIPBOARD_NOTE =
  '서식(HTML) 본문은 클립보드에 복사했습니다. Outlook(또는 메일 앱) 본문 칸을 클릭한 뒤 Ctrl+V로 붙여 넣어 주세요. 받는 사람·제목·참조는 메일 앱에 이미 채워져 있습니다.';
