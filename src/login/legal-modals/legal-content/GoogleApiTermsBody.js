const CONTACT = 'develop@nexvia.co.kr';

export default function GoogleApiTermsBody() {
  return (
    <>
      <p className="legal-muted">시행일: 2026년 3월 20일 · 최종 수정일: 2026년 5월 11일</p>

      <div className="legal-box">
        <p>
          <strong>Google에서 확인하지 않은 앱</strong>에 대해 OAuth 동의 화면에서 안내가 표시될 수 있습니다. 이는 Google의
          정상적인 보안 안내이며, 앱이 Google의 검증(Verification) 절차를 완료하기 전 단계에서 나타날 수 있습니다.
        </p>
        <p style={{ marginBottom: 0 }}>
          <strong>개발자 연락처:</strong> {CONTACT} (Nexvia CRM)
        </p>
      </div>

      <h2>1. 적용 범위</h2>
      <p>
        본 문서는 Nexvia CRM이 Google API(Gmail, Google Calendar, Google Drive, Google Contacts, Google Chat, Google Tasks
        등) 및 관련 OAuth 2.0 연동을 사용할 때의 목적·범위·이용자 고지를 설명합니다. Google API 서비스 이용약관, Google API
        서비스 사용자 데이터 정책, OAuth 동의 화면 정책 등 Google의 정책이 우선 적용됩니다.
      </p>

      <h2>2. 민감한 범위(Scopes) 요청 시 안내</h2>
      <p>
        서비스는 이메일·캘린더·드라이브·연락처 등 기능 제공을 위해 Google이 정한 범위의 OAuth 스코프를 요청할 수 있습니다.
        Google은 이러한 요청에 대해 &quot;앱이 Google 계정의 민감한 정보에 대한 액세스를 요청한다&quot;는 문구를 표시할 수
        있습니다. 이는 <strong>기능 구현에 필요한 최소 범위</strong>를 요청하기 위한 절차이며, 회사는 스코프를 필요 이상으로
        넓히지 않도록 설계합니다.
      </p>

      <h2>3. 고급(Advanced)으로 계속하기</h2>
      <p>
        OAuth 화면에서 &quot;고급&quot; 또는 유사한 링크를 통해 진행할 경우, Google은 사용자에게 위험을 이해했는지, 개발자를
        신뢰하는지 확인하는 문구를 보여줄 수 있습니다. 이용자는 본 문서 및 개인정보 보호정책을 읽고, 신뢰할 수 있을 때만
        접근을 허용해 주시기 바랍니다.
      </p>

      <h2>4. Google API 서비스 — 사용자 데이터의 사용(Limited Use)</h2>
      <p>회사는 Google에서 요구하는 경우 다음을 준수합니다(해당하는 범위에 한함).</p>
      <ul>
        <li>앱의 주요 기능을 제공·개선하기 위한 목적으로만 Google 사용자 데이터를 요청·사용합니다.</li>
        <li>허용된 전송·보관·사용 범위를 벗어나지 않습니다.</li>
        <li>
          사람이 Google 사용자 데이터를 읽을 수 있게 하는 경우(예: 동의·보안·법적 의무)를 제외하고, 자동화된 수단으로
          스팸·광고 판매 등 금지된 용도로 사용하지 않습니다.
        </li>
      </ul>
      <p className="legal-muted">
        세부 요구사항은 Google API Services User Data Policy 및 앱에 적용되는 제품별 정책을 따릅니다.
      </p>

      <h2>5. 데이터 최소화·보안·투명성(이용자·검토자용)</h2>
      <ul>
        <li>
          <strong>목적 제한</strong>: 수집한 Google 연동 데이터는 CRM 기능(메일·일정·파일·연락처 연동 등) 제공에 사용합니다.
        </li>
        <li>
          <strong>저장</strong>: 서비스는 회사가 정한 인프라(예: 호스팅 DB)에 암호화 통신(HTTPS)을 통해 저장·전송됩니다.
        </li>
        <li>
          <strong>제3자 판매</strong>: Google 사용자 데이터를 광고 중개·판매 목적으로 제3자에게 판매하지 않습니다.
        </li>
        <li>
          <strong>측정·감사</strong>: 접근 로그·동의 범위·정책 준수 여부를 내부적으로 점검할 수 있으며, Google 또는 감독
          기관이 요구하는 범위에서 협조합니다.
        </li>
      </ul>

      <h2>6. 검증(Verification) 진행 상황</h2>
      <p>
        OAuth 동의 화면 공개 상태 및 Google 검증 요건은 Google Cloud Console 설정과 심사 일정에 따라 달라질 수 있습니다.
        회사는 정책에 맞게 앱 설명·개인정보처리방침 URL·데모 계정(필요 시) 등을 유지·제출합니다. 검증 완료 전에도 본 고지와
        개인정보 보호정책은 공개됩니다.
      </p>

      <h2>7. 문의</h2>
      <p>
        Google 연동·데이터 처리 관련 문의: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </>
  );
}
