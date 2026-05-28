const CONTACT = 'develop@nexvia.co.kr';

export default function PrivacyPolicyBody() {
  return (
    <>
      <p className="legal-muted">시행일: 2026년 4월 18일 · 최종 수정일: 2026년 5월 27일</p>
      <p>
        주식회사 넥스비아(이하 &quot;회사&quot;)는 Nexvia CRM 서비스(이하 &quot;서비스&quot;)를 제공하면서 이용자의 개인정보를 중요하게
        생각하며, 「개인정보 보호법」 등 관련 법령을 준수합니다.
      </p>

      <h2>1. 수집하는 개인정보 항목</h2>
      <p>회사는 서비스 제공을 위해 다음과 같은 정보를 수집할 수 있습니다.</p>
      <ul>
        <li>
          <strong>계정·인증(이메일 가입)</strong>: 이용자가 입력한 이메일 주소(로그인 아이디), 이름, 연락처, 소속 회사·부서
          등 가입·프로필 정보, 이메일 인증·로그인 보안을 위한 일회용 인증번호 발송 기록(필요 시)
        </li>
        <li>
          <strong>계정·인증(OAuth)</strong>: Google 또는 Microsoft OAuth를 통해 제공받는 식별자, 이메일 주소, 표시 이름 등
          해당 플랫폼이 허용하는 범위의 프로필 정보
        </li>
        <li>
          <strong>서비스 이용 정보</strong>: CRM에 입력·저장되는 고객사·연락처·영업기회 등 업무 데이터(해당 데이터의 개인정보
          처리는 이용자(기업)의 업무 목적에 따릅니다)
        </li>
        <li>
          <strong>기술 정보</strong>: 접속 로그, IP, 쿠키, 기기·브라우저 정보(보안·통계·장애 대응 목적, 최소한으로 처리)
        </li>
      </ul>

      <h2>2. 민감정보 및 서비스에서 다루는 정보 유형</h2>
      <p>
        「개인정보 보호법」상 민감정보에 해당하는 정보를 처리할 경우, 회사는 법령에서 정한 요건(동의 등)을 갖추고 별도
        안내·동의 절차를 진행합니다. 이용자가 Google 연동을 사용하는 경우 Google API를 통해 접근·처리될 수 있는 정보 유형에
        는 다음이 포함될 수 있으며, 실제 수집·이용 범위는 이용자가 부여한 권한과 서비스 설정에 따릅니다. Google을 사용하지 않는
        계정은 해당 항목이 적용되지 않을 수 있습니다.
      </p>
      <ul>
        <li>연락처·조직 정보(Google Contacts 등 연동 시)</li>
        <li>캘린더 일정 정보(Google Calendar 연동 시)</li>
        <li>할 일 정보(Google Tasks 연동 시)</li>
        <li>
          Google Drive 상의 파일·폴더에 관한 정보(이용자가 서비스에 공유·연결한 범위 내, 파일명·식별자·내용 등 기능에 따라
          상이)
        </li>
      </ul>
      <p>
        위 항목 중 법령상 민감정보에 해당할 수 있는 정보는 해당 법령의 요건에 따라 처리하며, 서비스 내 별도 동의·설정이 있는
        경우 그에 따릅니다.
      </p>

      <h2>3. 개인정보의 이용 목적</h2>
      <ul>
        <li>회원 식별, 로그인(이메일·일회용 인증번호, OAuth 등) 및 서비스 제공·유지·개선</li>
        <li>이메일을 통한 인증번호 발송, 회사명·사업자번호 등으로 로그인 아이디 확인 등 계정 지원</li>
        <li>이용자가 연동을 선택한 경우에 한하여 Google API(Calendar, Drive, Contacts, Tasks 등) 기능 제공에 필요한 범위에서의 이용</li>
        <li>보안, 부정 이용 방지, 문의 응대, 법적 의무 이행</li>
      </ul>

      <h2>4. 개인정보 보호를 위한 기술적·관리적 조치</h2>
      <p>
        회사는 개인정보 및 서비스를 통해 처리되는 민감할 수 있는 정보를 보호하기 위해 다음과 같은 조치를 취합니다. 실제 적용
        세부는 인프라·서비스 구성에 따라 달라질 수 있으며, 핵심 원칙은 동일하게 유지됩니다.
      </p>
      <ul>
        <li>
          <strong>전송 구간 보호</strong>: 서비스와 이용자·외부 API 간 통신은 HTTPS(TLS) 등 암호화된 통신을 사용합니다.
        </li>
        <li>
          <strong>저장 및 접근 통제</strong>: 데이터베이스·애플리케이션에 대한 접근을 제한하고, 멀티테넌트(회사) 단위·역할
          기반 권한 등으로 불필요한 열람·변경을 방지합니다. 클라우드·호스팅 환경에서 제공하는 암호화·접근 통제 기능을 활용할 수
          있습니다.
        </li>
        <li>
          <strong>인증·권한</strong>: 로그인·세션·토큰 등을 통해 이용자 본인 및 권한이 있는 사용자만 정보에 접근하도록 하며,
          필요한 최소 권한만 부여하는 방향으로 기능을 설계합니다.
        </li>
        <li>
          <strong>Google 연동 데이터</strong>: Google OAuth로 발급받은 토큰 및 Google API를 통해 수신한 데이터는 서비스
          제공에 필요한 목적 범위에서만 처리하며, Google API Services User Data Policy 및 앱 검증(Verification) 절차에 부합하도록
          Limited Use 등 적용 요건을 준수합니다. 정책이 허용하지 않는 제3자 제공·광고 목적 등의 사용을 하지 않습니다. 보관
          기간·파기는 본 방침의 보관 및 파기, 관련 약관 및 이용자 설정에 따릅니다.
        </li>
        <li>
          <strong>로그·보안</strong>: 부정 접근·오남용 방지 및 장애 대응을 위해 필요한 범위에서 접속·처리 로그를 남길 수
          있으며, 수집 항목은 목적 달성에 필요한 최소한으로 합니다.
        </li>
        <li>
          <strong>재해·복구</strong>: 서비스 연속성을 위해 클라우드 제공자의 백업·복구 기능 등을 활용할 수 있으며, 개인정보
          유출 등 사고가 발생한 경우 관련 법령에 따른 통지 등 필요한 조치를 합니다.
        </li>
      </ul>

      <h2>5. Google 정보의 처리 (연동을 선택한 이용자에 한함)</h2>
      <p>
        서비스는 이용자가 Google 계정 연동을 사용하는 경우에 한하여 Google OAuth 및 Google API를 사용합니다. Google에서
        받은 정보는 <strong>서비스 제공에 필요한 목적</strong>으로만 사용하며, Google API 서비스 이용 약관·사용자 데이터 정책
        및 Google 앱 검증(Verification)·OAuth 동의 화면과 관련된 요구사항(예: Limited Use 요구사항 해당 시)을 준수합니다.
        자세한 내용은 별도 「Google API 및 연동 약관」을 참고하십시오.
      </p>

      <h2>6. Google 사용자 데이터의 공유·이전·공개 (Sharing, Transfer, and Disclosure)</h2>
      <p>
        본 조항은 Google OAuth·Google API를 통해 회사가 접근·처리하는 <strong>Google 사용자 데이터</strong>(이메일·프로필,
        Google Contacts·Calendar·Drive·Tasks 등 연동 기능에 따라 수신되는 데이터, OAuth 토큰 및 이를 통해 조회·저장된
        정보)에 대해, <strong>누구와 공유·이전·공개하는지</strong>를 명시합니다. Google 연동을 사용하지 않는 이용자에게는 본 조항이
        적용되지 않을 수 있습니다.
      </p>

      <div className="legal-box">
        <p>
          <strong>English — With whom we share, transfer, or disclose Google user data</strong>
        </p>
        <p>
          Nexvia Co., Ltd. does <strong>not</strong> sell, rent, or share Google user data with third parties for
          advertising, data brokerage, or purposes unrelated to providing the Nexvia CRM service. We comply with the
          Google API Services User Data Policy (including Limited Use, where applicable).
        </p>
        <p>
          We <strong>may</strong> share, transfer, or disclose Google user data only with the following parties and only
          as needed to operate the service:
        </p>
        <ul>
          <li>
            <strong>Google LLC (United States)</strong> — to perform OAuth and Google API calls (Calendar, Drive,
            Contacts, Tasks, etc.) that you enable.
          </li>
          <li>
            <strong>Service providers (processors)</strong> — to host and store data, including: MongoDB, Inc. (MongoDB
            Atlas), Railway Corp. (backend hosting), and Vercel, Inc. (frontend hosting). Some client-side API calls may
            occur directly between your device and Google; server-side storage uses our backend and database.
          </li>
          <li>
            <strong>Other authorized users in your company tenant</strong> — colleagues and admins in the same Nexvia
            organization account, according to your company&apos;s roles and permissions (CRM collaboration).
          </li>
          <li>
            <strong>Legal requirements</strong> — when required by applicable law, court order, or lawful government
            request.
          </li>
          <li>
            <strong>With your consent or at your direction</strong> — when you explicitly request an action in the
            product (e.g., sharing a document or using a calendar-related integrated feature).
          </li>
        </ul>
        <p>
          Data may be <strong>transferred internationally</strong> (primarily to the United States) because Google and the
          providers above may process data outside the Republic of Korea. We apply contractual and legal safeguards where
          required. Retention and deletion are described in Section 7 below and when you disconnect Google or delete your
          account.
        </p>
        <p className="legal-muted">
          Public URL of this policy: https://www.nexviacrm.co.kr/legal/privacy
        </p>
      </div>

      <h3>6.1 공유·제공하지 않는 경우</h3>
      <p>회사는 Google 사용자 데이터를 다음 목적으로 <strong>판매·임대·광고·데이터 브로커 제공 등과 같이 제3자에게 제공하지
        않습니다</strong>.</p>
      <ul>
        <li>맞춤형 광고·행동 타깃 광고·재마케팅</li>
        <li>신용 평가·대출 심사 등 Google 데이터와 무관한 부수 목적</li>
        <li>Google API Services User Data Policy가 금지하는 용도</li>
      </ul>

      <h3>6.2 공유·이전·공개하는 대상 및 목적</h3>
      <p>Google 사용자 데이터는 서비스 제공에 필요한 범위에서만 아래와 같이 공유·이전·공개될 수 있습니다.</p>
      <ul>
        <li>
          <strong>Google LLC (미국)</strong>: OAuth 인증, Calendar·Drive·Contacts·Tasks 등 API 호출을 위해
          Google과 데이터가 송수신됩니다. 이는 연동 기능 자체에 필요한 통신입니다.
        </li>
        <li>
          <strong>클라우드·인프라 수탁사(처리위탁)</strong>: 서비스 호스팅·DB 저장·백업을 위해 Google 사용자 데이터(토큰,
          연동으로 가져온 일정·연락처·할 일 등)가 다음 수탁사의 시설에서 처리·보관될 수 있습니다. 수탁사는 계약 등으로
          기밀·보안 의무를 부담합니다.
          <ul>
            <li>MongoDB, Inc. — MongoDB Atlas (데이터베이스, 미국 등 해외 리전 가능)</li>
            <li>Railway Corp. — 백엔드 애플리케이션 호스팅 (미국 등)</li>
            <li>Vercel, Inc. — 프론트엔드 웹 호스팅 (미국 등). 브라우저에서 직접 Google API를 호출하는 일부 처리는 이용자
              기기·Google과 직접 통신할 수 있으며, 서버 저장은 백엔드·DB 경로를 따릅니다.</li>
          </ul>
        </li>
        <li>
          <strong>동일 이용자가 소속한 기업(테넌트) 내 다른 권한 있는 사용자</strong>: CRM 특성상, 같은 회사 계정에 초대된
          관리자·동료가 회사 정책·권한 설정에 따라 동일 테넌트 내 업무 데이터를 열람할 수 있습니다(예: 공유된 일정·연락처 연동
          결과). 이는 이용자 소속 조직의 내부 업무 이용 범위입니다.
        </li>
        <li>
          <strong>법령·분쟁 대응</strong>: 법원 명령, 수사기관의 적법한 요청, 권리 보호·안전 확보 등 법령이 허용·요구하는
          범위에서만 공개할 수 있습니다.
        </li>
        <li>
          <strong>이용자 동의 또는 지시</strong>: 이용자가 서비스 기능을 통해 명시적으로 요청·동의한 경우(예: 특정 문서
          공유·일정 연동).
        </li>
      </ul>

      <h3>6.3 국외 이전</h3>
      <p>
        위 수탁사·Google LLC는 대한민국 외(주로 미국 등)에 소재할 수 있으며, Google 사용자 데이터가 국외로 이전·처리·보관될 수
        있습니다. 회사는 계약·표준계약조항 등 관련 법령이 요구하는 보호조치를 적용하는 방향으로 운영합니다.
      </p>

      <h3>6.4 보관 기간·삭제</h3>
      <p>
        Google 사용자 데이터의 보관·파기는 본 방침 제7조(보관 및 파기), 이용자의 연동 해제·계정 삭제 요청, Google 계정 권한
        철회에 따릅니다. 연동 해제 시 토큰 무효화 및 서비스 DB에 저장된 연동 데이터 삭제를 진행합니다(법령상 보관 의무가 있는
        항목은 예외).
      </p>

      <h2>7. 보관 및 파기</h2>
      <p>
        이용 목적 달성 후 또는 이용자가 삭제·탈퇴를 요청한 경우 지체 없이 파기합니다. 다만 관련 법령에 따라 보관이 필요한
        경우에는 해당 기간 동안 보관합니다.
      </p>

      <h2>8. 제3자 제공 및 처리위탁 (Google 데이터 외 일반 개인정보 포함)</h2>
      <p>
        회사는 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만 클라우드 호스팅·이메일 발송(SMTP 등) 등 서비스
        운영을 위해 필요한 범위에서 국내외 처리위탁을 둘 수 있으며, 위탁 시 계약 등으로 안전성을 확보합니다.{' '}
        <strong>Google 사용자 데이터의 공유·이전·공개 대상은 제6조를 우선 적용합니다.</strong>
      </p>

      <h2>9. 이용자의 권리</h2>
      <p>
        이용자는 개인정보 열람·정정·삭제·처리정지 요구 등을 할 수 있으며, Google 연동 데이터에 대해서도 연동 해제·계정 삭제
        요청을 통해 처리를 요청할 수 있습니다. 문의는 아래 연락처로 하실 수 있습니다.
      </p>

      <h2>10. 개인정보 보호책임자</h2>
      <p>
        이메일: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
      <p className="legal-muted">
        본 정책은 법령·서비스 변경에 따라 수정될 수 있으며, 변경 시 서비스 내 공지 또는 본 페이지를 통해 안내합니다.
      </p>
    </>
  );
}
