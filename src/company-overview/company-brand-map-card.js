import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

export const NEXVIA_BRAND_LOGO =
  'https://res.cloudinary.com/djcsvvhly/image/upload/v1774253553/NexviaLogo2_yy0myj.png';

/**
 * Google Maps 주소 검색 iframe (Geocoding/Maps JS API 키·과금 없음).
 */
function buildGoogleMapsEmbedUrl(address) {
  const q = String(address || '').trim();
  if (!q) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}&hl=ko&z=16&output=embed`;
}

function buildGoogleMapsBrowseUrl(address) {
  const q = String(address || '').trim();
  if (!q) return 'https://www.google.com/maps?hl=ko';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&hl=ko`;
}

/** 소속 회사 기본 정보용 로고 */
export function CompanyOverviewLogo({ companyName = '', logoUrl = '' }) {
  const src = String(logoUrl || '').trim() || NEXVIA_BRAND_LOGO;
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    setLogoFailed(false);
  }, [src]);
  if (logoFailed) {
    return (
      <div className="co-ref-company-logo-fallback" aria-hidden>
        {(companyName || 'N').slice(0, 1)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`${companyName || 'Nexvia'} 로고`}
      className="co-ref-company-logo"
      onError={() => setLogoFailed(true)}
    />
  );
}

/** 사업장 위치 지도 */
export default function CompanyBrandMapCard({
  companyName = '',
  address = '',
  addressDetail = '',
  showSubscriptionLink = false
}) {
  const fullAddress = useMemo(
    () => [address, addressDetail].map((s) => String(s || '').trim()).filter(Boolean).join(' '),
    [address, addressDetail]
  );
  const embedUrl = useMemo(() => buildGoogleMapsEmbedUrl(fullAddress), [fullAddress]);
  const browseUrl = useMemo(() => buildGoogleMapsBrowseUrl(fullAddress), [fullAddress]);

  return (
    <article className="co-ref-card co-ref-card--brand-map" aria-labelledby="co-brand-map-title">
      <div className="co-ref-card-head">
        <div className="co-ref-card-title-wrap">
          <span className="co-ref-card-icon tone-blue" aria-hidden>
            <span className="material-symbols-outlined">location_on</span>
          </span>
          <div>
            <h2 id="co-brand-map-title" className="co-ref-card-title">사업장 위치</h2>
            <p className="co-ref-card-sub">등록 주소 기준 지도</p>
          </div>
        </div>
        {showSubscriptionLink ? (
          <Link to="/subscription" className="co-ref-link co-ref-link--compact">
            구독관리
            <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
          </Link>
        ) : null}
      </div>

      <div className="co-ref-brand-map-body">
        <div className="co-ref-brand-map-frame">
          {!fullAddress ? (
            <p className="co-ref-brand-map-status">
              회사 정보에 주소를 등록하면 지도에 표시됩니다.
            </p>
          ) : (
            <iframe
              title={`${companyName || '회사'} 사업장 위치 지도`}
              src={embedUrl}
              className="co-ref-brand-map-iframe"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          )}
        </div>

        {fullAddress ? (
          <div className="co-ref-brand-map-foot">
            <span className="co-ref-brand-map-credit">Google Maps · 주소 검색 표시 (API 키 없음)</span>
            <a href={browseUrl} target="_blank" rel="noopener noreferrer" className="co-ref-link">
              크게 보기
              <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
            </a>
          </div>
        ) : null}
      </div>
    </article>
  );
}
