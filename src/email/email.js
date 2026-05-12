import { useState } from 'react';
import EmailComposeModal from './email-compose-modal.jsx';
import './email.css';
import PageHeaderNotifyChat from '@/components/page-header-notify-chat/page-header-notify-chat';

const WEBMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';

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
            <div className="email-detail-empty">
              <span className="material-symbols-outlined email-detail-empty-icon">mail</span>
              <p>왼쪽에서 새 메일 작성을 눌러 주세요.</p>
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
