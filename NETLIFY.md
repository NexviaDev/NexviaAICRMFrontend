# Netlify 배포 – 백엔드(Heroku) 연결

프론트엔드(Netlify)가 백엔드(Heroku) API를 쓰려면 **환경 변수**를 설정한 뒤 다시 배포해야 합니다.

## 1. Netlify 환경 변수 설정

Netlify 대시보드 → **Site configuration** → **Environment variables** → **Add a variable** (또는 **Add single variable** / **Import from .env**).

| 이름 | 값 | 설명 |
|------|-----|------|
| `VITE_API_URL` | `https://nexviaaicrm-09d65bddf221.herokuapp.com` | 백엔드 API 오리진 (Heroku 실제 Web URL, 끝에 `/` 없이) |
| `VITE_GOOGLE_MAPS_API_KEY` | (Google Cloud에서 발급한 키) | 지도/주소 검색용. 비우면 지도 기능만 비활성화됨 |

- **주의**: API 키는 **저장소에 커밋하지 마세요**. Netlify 대시보드에서만 입력하세요.
- **Key**: `VITE_API_URL`
- **Value**: `https://nexviaaicrm.herokuapp.com`
- **Scopes**: 모든 브랜치(Production 등)에 적용 권장

저장 후 **Trigger deploy**로 사이트를 다시 배포하세요. (기존 빌드 캐시 사용 시 새 값이 반영되지 않을 수 있으므로, 필요하면 “Clear cache and deploy” 선택)

### 1-1. 시크릿 스캔으로 배포가 막힐 때 (AIza*** 감지)

Vite 빌드 시 `VITE_GOOGLE_MAPS_API_KEY`가 번들에 인라인되면 Netlify 시크릿 스캔이 "노출된 API 키"로 판단해 배포를 실패시킬 수 있습니다. Google Maps API 키는 보통 **HTTP 리퍼러 제한**으로만 사용하므로, 빌드 결과에 이 값이 포함되는 것은 허용하도록 설정하세요.

**Netlify 대시보드** → 해당 사이트 → **Site configuration** → **Environment variables** → **Add a variable** (또는 **Edit**):

| 이름 | 값 | 설명 |
|------|-----|------|
| `SECRETS_SCAN_SMART_DETECTION_ENABLED` | `false` | 스마트 시크릿 스캔 완전 비활성화 (AIza*** 등 빌드 출력 검사 안 함) |

- `SECRETS_SCAN_SMART_DETECTION_OMIT_VALUES=true`만으로는 빌드 실패가 해제되지 않는 경우가 많습니다. **반드시 `SECRETS_SCAN_SMART_DETECTION_ENABLED=false`** 를 추가하세요.
- 실제 비밀값(DB 비밀번호 등)이 저장소/빌드에 없음을 확인한 뒤에만 사용하세요.

## 2. 확인

- 배포가 끝난 뒤 https://nexviaaicrm.netlify.app 에서 로그인·API 연동이 되는지 확인합니다.
- 로그인(Google OAuth 포함)은 백엔드의 `FRONTEND_URL`이 `https://nexviaaicrm.netlify.app` 로 설정되어 있어야 정상 동작합니다. (이미 Heroku 쪽에 설정됨)

## 3. 로컬 개발

로컬에서는 `VITE_API_URL`을 비워 두면 Vite 프록시(`/api` → `http://localhost:5000`)가 사용됩니다.  
다른 백엔드 주소를 쓰려면 `.env` 또는 `.env.local`에 `VITE_API_URL=...` 를 넣으면 됩니다.
