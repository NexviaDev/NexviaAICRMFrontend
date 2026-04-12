import { useMemo, useState } from 'react';
import './comment-author-avatar.css';

/** layout/sidebar.js 등과 동일 Cloudinary 클라우드 */
const CLOUDINARY_CLOUD_NAME = 'djcsvvhly';

/**
 * User.avatarPublicId 기준 CDN URL (폴더/파일명에 특수문자 있어도 세그먼트별 인코딩)
 * @param {string|null|undefined} publicId
 * @param {{ w?: number; h?: number }} [opts]
 * @returns {string|null}
 */
export function cloudinaryAvatarUrlFromPublicId(publicId, { w = 80, h = 80 } = {}) {
  if (publicId == null) return null;
  const pid = String(publicId).trim();
  if (!pid) return null;
  const encoded = pid.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,w_${w},h_${h},g_auto,f_auto,q_auto/${encoded}`;
}

/**
 * 사이드바(User.avatar) 우선, 없으면 Cloudinary public_id URL (layout/sidebar.js 와 동일한 우선순위)
 * @param {{ avatar?: string|null; avatarPublicId?: string|null; w?: number; h?: number }} p
 */
export function userAvatarImageUrl({ avatar, avatarPublicId, w = 80, h = 80 } = {}) {
  const a = avatar != null ? String(avatar).trim() : '';
  if (a && /^https?:\/\//i.test(a)) return a;
  return cloudinaryAvatarUrlFromPublicId(avatarPublicId, { w, h });
}

function initialsFromName(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const ns = s.replace(/\s/g, '');
  if (ns.length <= 2) return ns.toUpperCase();
  return (ns[0] + ns[ns.length - 1]).toUpperCase();
}

/**
 * 코멘트/답글 작성자 — User.avatar(URL) 우선, 없으면 avatarPublicId CDN, 실패 시 이니셜
 */
export function CommentAuthorAvatar({
  name,
  avatar,
  avatarPublicId,
  className = '',
  size = 80,
  imgClassName = 'comment-author-avatar-img'
}) {
  const url = useMemo(
    () => userAvatarImageUrl({ avatar, avatarPublicId, w: size, h: size }),
    [avatar, avatarPublicId, size]
  );
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(url) && !failed;

  return (
    <span
      className={[className, showImg ? 'comment-author-avatar--photo' : ''].filter(Boolean).join(' ')}
      title={name || ''}
    >
      {showImg ? (
        <img
          className={imgClassName}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        initialsFromName(name)
      )}
    </span>
  );
}
