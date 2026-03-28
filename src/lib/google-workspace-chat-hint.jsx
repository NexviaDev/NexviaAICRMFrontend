/**
 * Google Workspace Chat 정책 안내 (메신저·사내 현황 등).
 * 관리자 콘솔 링크 + 리드 캡처 알림(Chat) 전제 조건 안내.
 */
const URL_ADMIN = 'https://admin.google.com';
/** Chat 외부 사용자·조직 간 대화 (Workspace 관리자 도움말) */
const URL_CHAT_EXTERNAL_HELP =
  'https://support.google.com/a/answer/7376097?hl=ko';

export function GoogleWorkspaceChatPolicyHint() {
  return (
    <span className="google-workspace-chat-hint-inner">
      Google Workspace는 보안을 위해 Chat·스페이스의 외부 참여가 기본 제한인 경우가 많습니다. 도메인(조직)마다 설정이 다르며, 이 사이트의 Google 연동(내부 메신저 등)은 그 정책의 영향을 받을 수 있습니다.{' '}
      <a href={URL_ADMIN} target="_blank" rel="noreferrer">Google 관리자 콘솔</a>은{' '}
      <strong>관리자(Workspace) 계정</strong>으로만 접근할 수 있습니다. 조직에서 외부 Chat·스페이스 제한을 완화해야{' '}
      <strong>리드 캡처 알림(Chat 연동)</strong> 기능이 정상 실행되는 경우가 많습니다.{' '}
      <a href={URL_CHAT_EXTERNAL_HELP} target="_blank" rel="noreferrer">
        Chat 외부 참여 관련 도움말(Google)
      </a>
    </span>
  );
}
