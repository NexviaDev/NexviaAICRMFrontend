import { useState } from 'react';
import EmailComposeModal from './email-compose-modal.jsx';
import './email.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

const WEBMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';

/** 보내기(mailto) 후 화면이 조용할 때 — Windows 기본 메일 앱 안내 */
function EmailSendHandoffGuide({ compact = false }) {
  if (compact) {
    return (
      <p className="email-handoff-guide email-handoff-guide--compact">
        <strong>보내기</strong>를 눌렀는데 아무 창도 뜨지 않나요? CRM은 메일을 대신 보내지 않고, PC에 설정된{' '}
        <strong>Windows 기본 메일 앱</strong>으로 받는 사람·제목·본문을 넘깁니다. 아래 안내를 차근차근 확인해 주세요.
      </p>
    );
  }

  return (
    <section className="email-handoff-guide" aria-labelledby="email-handoff-guide-title">
      <h3 id="email-handoff-guide-title" className="email-handoff-guide-title">
        <span className="material-symbols-outlined" aria-hidden>
          mail
        </span>
        보내기를 눌렀는데 아무 반응이 없을 때
      </h3>
      <p className="email-handoff-guide-lead">
        걱정하지 마세요. Nexvia CRM은 웹에서 메일 서버로 직접 발송하지 않습니다. 작성하신 내용을{' '}
        <strong>Windows에 등록된 기본 메일 프로그램</strong>(Outlook, 새 Outlook, Windows 메일 등)으로 넘겨 드리는
        방식이에요. 그래서 「보내기」를 누른 뒤 브라우저 화면은 그대로인데, 잠시 뒤 다른 창이 떠야 정상입니다.
      </p>
      <ol className="email-handoff-guide-steps">
        <li>
          <strong>기본 메일 앱이 지정되어 있는지</strong> 확인해 주세요.
          <br />
          Windows 11: <em>설정 → 앱 → 기본 앱</em> → 「이메일」 항목에서 사용하시는 Outlook(또는 Windows 메일)을
          선택합니다.
          <br />
          Windows 10: <em>설정 → 앱 → 기본 앱</em> → 「이메일」에서 동일하게 지정합니다.
        </li>
        <li>
          <strong>Chrome·Edge를 쓰신다면</strong> 주소창 왼쪽 자물쇠(ⓘ) → 사이트 설정에서 「메일 핸들러」 또는 외부
          앱 실행이 차단되어 있지 않은지 봐 주세요. 「항상 허용」으로 두시면 mailto 연결이 더 잘 됩니다.
        </li>
        <li>
          다시 CRM에서 <strong>받는 사람</strong>을 입력한 뒤 <strong>보내기</strong>를 눌러 보세요. Outlook이나 Windows
          메일의 <strong>새 메일 작성</strong> 창이 열리고, 받는 사람·제목이 채워져 있으면 성공입니다.{' '}
          <strong>굵게·표·색상 등 HTML 서식</strong>이 있는 메일은 서식이 클립보드에 복사되므로, 본문 칸을 클릭한 뒤{' '}
          <kbd>Ctrl</kbd>+<kbd>V</kbd>로 붙여 넣어 주세요.
        </li>
        <li>
          그래도 창이 뜨지 않으면, CRM 작성 창의 내용을 복사하신 뒤{' '}
          <strong>Outlook·Windows 메일을 직접 실행</strong>해서 새 메일을 만드시면 됩니다. 왼쪽 「웹메일 열기」로
          Gmail 등 브라우저 웹메일을 이용하셔도 괜찮습니다.
        </li>
      </ol>
      <p className="email-handoff-guide-foot">
        회사 PC 정책으로 외부 앱 실행이 막혀 있으면 IT 담당자에게 「mailto 링크로 기본 메일 앱 열기」 허용 여부를
        문의해 주시면 도움이 됩니다. 불편을 드려 죄송합니다. 익숙한 메일 앱에서 마무리하시면 안전하게 발송하실 수
        있습니다.
      </p>
    </section>
  );
}

export default function Email() {
  const [detailCompose, setDetailCompose] = useState(null);

  const detailChromeOpen = Boolean(detailCompose);

  return (
    <div className={`email-page${detailChromeOpen ? ' email-page--detail-open' : ''}`}>
      <header className="email-header">
        <div className="email-header-actions">
          <button type="button" className="email-header-icon-btn" aria-label="설정">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <PageHeaderNotifyChat buttonClassName="email-header-icon-btn" wrapperClassName="email-header-notify-chat" />
        </div>
      </header>

      {detailCompose === 'new' ? (
        <div className="email-handoff-banner" role="note">
          <EmailSendHandoffGuide compact />
        </div>
      ) : null}

      <div className="email-body email-body--send-only">
        <aside className="email-sidebar">
          <button type="button" className="email-compose-btn" onClick={() => setDetailCompose('new')}>
            <span className="material-symbols-outlined">edit</span>
            새 메일 작성
          </button>
          <nav className="email-labels-nav" style={{ marginTop: 12 }}>
            <a
              href={WEBMAIL_INBOX_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="email-label-item"
              style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>open_in_new</span>
              <span className="email-label-name">웹메일 열기</span>
            </a>
          </nav>
        </aside>

        <section className="email-list-panel">
          <div className="email-list-header">
            <h2 className="email-list-title">메일</h2>
          </div>
          <div className="email-list">
            <div className="email-list-empty" style={{ padding: '24px 16px', lineHeight: 1.6, textAlign: 'left' }}>
              CRM에서는 받은편지함·발송함을 연동하지 않습니다. 새 메일은 아래 작성 창에서 내용을 만든 뒤 PC 기본 메일 앱으로 넘기거나, 웹메일을 이용해 주세요.
            </div>
          </div>
        </section>

        <section className="email-detail-panel">
          {detailCompose === 'new' ? (
            <EmailComposeModal
              key="compose-new"
              inline
              composeMode="new"
              initialTo=""
              initialCc=""
              initialSubject=""
              onClose={() => setDetailCompose(null)}
              onSent={() => setDetailCompose(null)}
            />
          ) : (
            <div className="email-detail-empty email-detail-empty--with-guide">
              <span className="material-symbols-outlined email-detail-empty-icon">mail</span>
              <p>왼쪽에서 새 메일 작성을 눌러 주세요.</p>
              <EmailSendHandoffGuide />
            </div>
          )}
        </section>
      </div>

      <button
        type="button"
        className="email-mobile-fab-compose"
        onClick={() => setDetailCompose('new')}
        aria-label="새 메일 작성"
      >
        <span className="material-symbols-outlined">edit</span>
      </button>
    </div>
  );
}
