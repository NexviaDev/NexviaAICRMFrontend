/** 사내 채팅 패널 열기용 이벤트 (레이아웃 FAB과 사내 현황 모달 공유) */
export const COMPANY_CHAT_OPEN_EVENT = 'nexvia-company-chat-open';

export function openCompanyChatPanel(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COMPANY_CHAT_OPEN_EVENT, { detail: detail || {} }));
}
