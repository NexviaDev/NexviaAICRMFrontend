import './lead-capture-api-doc-modal.css';

const DEFAULT_BACKEND = 'https://nexviaaicrm-09d65bddf221.herokuapp.com';

const TYPE_LABELS = { text: 'string', number: 'number', date: 'string', select: 'string', multiselect: 'array', checkbox: 'boolean' };

export default function LeadCaptureApiDocModal({ backendBaseUrl, webhookUrl, formId, customFields = [], inline, onClose }) {
  const baseUrl = backendBaseUrl || DEFAULT_BACKEND;
  const webhookExample = webhookUrl || `${baseUrl}/api/lead-capture-webhook/YOUR_WEBHOOK_SECRET`;
  const exampleBody = { name: '홍길동', email: 'hong@example.com', source: '랜딩페이지' };
  if (formId) exampleBody.formId = formId;
  exampleBody.customFields = customFields.length ? Object.fromEntries(customFields.map((d) => [d.key, '제품A'])) : { product_interest: '제품A' };
  const exampleBodyStr = JSON.stringify(exampleBody, null, 2);

  const content = (
    <div className={`lead-capture-api-doc-box ${inline ? 'lead-capture-api-doc-inline' : ''}`} onClick={inline ? undefined : (e) => e.stopPropagation()}>
      <div className="lead-capture-api-doc-header">
        <h2 id="lead-capture-api-doc-title" className="lead-capture-api-doc-title">
          <span className="material-symbols-outlined">integration_instructions</span>
          리드 캡처 API 매뉴얼
        </h2>
        <div className="lead-capture-api-doc-header-actions">
          {!inline && onClose && (
            <button type="button" className="lead-capture-api-doc-close" onClick={onClose} aria-label="닫기">
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>
      </div>
        <div className="lead-capture-api-doc-body">
          <h4>1. 개요</h4>
          <p>
            리드 캡처 API는 랜딩 페이지, 설문, Typeform·Facebook 리드 등 외부에서 수집한 리드를 CRM에 전달할 때 사용합니다.
            <strong> API 키</strong>로 인증하고, <strong>웹훅 URL</strong>로 리드를 제출합니다. 모든 데이터는 현재 로그인한 회사(회사명_사업자번호)에 귀속됩니다.
          </p>
          <p><strong>백엔드 기본 주소</strong>: <code>{baseUrl}</code></p>

          <h4>2. 인증 (API 키)</h4>
          <p>외부 연동 카드에서 발급한 API 키를 아래 중 한 가지 방식으로 보내면 됩니다.</p>
          <ul>
            <li><code>Authorization: Bearer {`{API_KEY}`}</code></li>
            <li><code>X-API-Key: {`{API_KEY}`}</code></li>
          </ul>
          <p>API 키는 재발급 시에만 전체 값을 확인할 수 있으므로, 발급 직후 반드시 복사해 두세요.</p>

          <h4>3. 웹훅 URL로 리드 제출</h4>
          <p>
            <strong>웹훅 URL</strong>은 리드 데이터를 보낼 <strong>POST 요청의 주소(엔드포인트)</strong>입니다.
            리드 캡처 페이지 우측 <strong>외부 연동</strong> 카드에 표시된 웹훅 URL을 복사해, 아래처럼 <code>POST</code> 요청의 URL로 그대로 사용하면 됩니다. 인증에는 API 키를 사용합니다.
          </p>
          <p><strong>엔드포인트 (웹훅 URL = POST 대상 주소)</strong></p>
          <pre className="lead-capture-api-doc-pre"><code>POST {`{웹훅_URL}`}   ← 외부 연동에서 복사한 URL
Content-Type: application/json
Authorization: Bearer {`{API_KEY}`}   ← 재발급 시 복사한 API 키</code></pre>

          <p><strong>요청 본문 (JSON)</strong></p>
          <table>
            <thead>
              <tr>
                <th>필드</th>
                <th>타입</th>
                <th>필수</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>name</code></td>
                <td>string</td>
                <td>O</td>
                <td>이름</td>
              </tr>
              <tr>
                <td><code>email</code></td>
                <td>string</td>
                <td>O</td>
                <td>이메일</td>
              </tr>
              <tr>
                <td><code>source</code></td>
                <td>string</td>
                <td>X</td>
                <td>리드 소스 (예: Organic Search, LinkedIn)</td>
              </tr>
              <tr>
                <td><code>formId</code></td>
                <td>string</td>
                <td>X</td>
                <td>캡처 폼 ID (어느 폼에서 들어왔는지 구분 시 사용)</td>
              </tr>
              {customFields.length > 0 ? (
                customFields.map((def) => (
                  <tr key={def._id}>
                    <td><code>customFields.{def.key}</code></td>
                    <td>{TYPE_LABELS[def.type] || def.type}</td>
                    <td>{def.required ? 'O' : 'X'}</td>
                    <td>{def.label}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td><code>customFields</code></td>
                  <td>object</td>
                  <td>X</td>
                  <td>리드 캡처 빌더에서 정의한 커스텀 필드 (키: 값). 빌더에서 추가하면 위 테이블에 키가 표시됩니다.</td>
                </tr>
              )}
            </tbody>
          </table>

          <p><strong>요청 예시 (cURL)</strong></p>
          <pre className="lead-capture-api-doc-pre"><code>{`curl -X POST "${webhookExample}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk_live_YOUR_API_KEY" \\
  -d '{"name":"홍길동","email":"hong@example.com","source":"웹사이트 문의"${formId ? `,"formId":"${formId}"` : ''},"customFields":{}}'`}</code></pre>

          <p><strong>요청 예시 (JavaScript fetch)</strong></p>
          <pre className="lead-capture-api-doc-pre"><code>{`const response = await fetch("${webhookExample}", {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': \`Bearer \${API_KEY}\`
  },
  body: JSON.stringify(${exampleBodyStr})
});`}</code></pre>

          <h4>4. 응답</h4>
          <ul>
            <li><strong>200 OK</strong>: 리드가 정상 등록됨.</li>
            <li><strong>400 Bad Request</strong>: name, email 누락 또는 형식 오류. 본문에 <code>error</code> 메시지 포함.</li>
            <li><strong>401 Unauthorized</strong>: API 키 없음 또는 잘못됨.</li>
            <li><strong>404 Not Found</strong>: 웹훅 URL 또는 시크릿이 잘못됨.</li>
          </ul>

          <h4>5. 커스텀 필드</h4>
          <p>
            리드 캡처 페이지의 <strong>커스텀 필드 추가</strong>에서 정의한 필드는 <code>customFields</code> 객체로 보냅니다.
            키는 정의 시 사용한 <code>key</code>와 동일해야 하며, 타입(텍스트/숫자/선택 등)에 맞는 값을 넣어주세요.
          </p>
          <div className="lead-capture-api-doc-note">
            Typeform, Facebook 리드 등 서드파티에서는 해당 서비스의 웹훅 설정 화면에 위 웹훅 URL을 입력하고, 전달되는 필드를 위 스키마(name, email, source, formId, customFields)에 맞게 매핑하면 됩니다.
          </div>
        </div>
    </div>
  );

  if (inline) return content;
  return (
    <div className="lead-capture-api-doc-overlay" role="dialog" aria-modal="true" aria-labelledby="lead-capture-api-doc-title">
      {content}
    </div>
  );
}
