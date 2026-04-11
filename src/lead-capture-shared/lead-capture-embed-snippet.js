/**
 * 리드 캡처 «임베드 HTML+스크립트» 단일 소스.
 * - POST 대상: …/api/lead-capture-webhook/:secret (백엔드 receiveWebhook)
 * - 공개 페이지 `lead-capture-public.js`와 동일 엔드포인트; 공개 쪽은 React·API 기반 필드가 더 풍부함(select 등).
 */
export function buildLeadCaptureEmbedSnippet({
  rawWebhookUrl,
  formId,
  customFields = [],
  backendBaseUrl = ''
}) {
  const rawUrl = rawWebhookUrl || '';
  const fid = formId != null ? String(formId) : '';
  const fields = customFields || [];
  if (!rawUrl) return '';
  const url = (() => {
    try {
      const path = new URL(rawUrl).pathname || '';
      if (!path) return rawUrl;
      const base = (backendBaseUrl || '').replace(/\/$/, '');
      return base ? base + path : rawUrl;
    } catch (_) {
      return rawUrl;
    }
  })();
  const customKeysJson = JSON.stringify(fields.map((d) => d.key));
  const customInputs = fields
    .map((d) => {
      const placeholder = (d.label || d.key || '').replace(/"/g, '&quot;');
      const required = d.required ? ' required' : '';
      const type = d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text';
      return `  <input type="${type}" name="custom_${d.key}" placeholder="${placeholder}"${required} />`;
    })
    .join('\n');
  return `<!-- 리드 캡처 임베드: 기본 필드 + 빌더 커스텀 필드. 기본은 API 키 없이 접수합니다. 키로만 제한하려면 스크립트에서 Authorization 또는 x-api-key 헤더를 추가하세요. -->
<style>
  .lead-form-wrapper {
    max-width: 420px;
    margin: 0 auto;
    padding: 24px;
    border-radius: 16px;
    background: #ffffff;
    box-shadow: 0 10px 30px rgba(90, 103, 134, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .lead-form-title {
    font-size: 20px;
    font-weight: 700;
    margin-bottom: 16px;
    text-align: center;
    color: #3d4f6f;
  }
  .lead-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .lead-form input:not(.lead-form-file-hidden) {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    font-size: 14px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .lead-form input:not(.lead-form-file-hidden):focus {
    outline: none;
    border-color: #9aacd4;
    box-shadow: 0 0 0 3px rgba(154, 172, 212, 0.22);
  }
  .lead-form-file-caption {
    font-size: 13px;
    font-weight: 600;
    color: #5a6b86;
    margin-bottom: 2px;
  }
  .lead-form-file-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .lead-form-file-zone {
    position: relative;
    border-radius: 12px;
    border: 1.5px dashed #c8d4e8;
    background: linear-gradient(180deg, #fafbfd 0%, #f4f6fb 100%);
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }
  .lead-form-file-zone:focus-within:not(.lead-form-file-zone--filled) {
    border-color: #9aacd4;
    box-shadow: 0 0 0 3px rgba(154, 172, 212, 0.2);
  }
  .lead-form-file-zone--drag {
    border-color: #9aacd4;
    background: #eef2fb;
    box-shadow: 0 0 0 3px rgba(154, 172, 212, 0.25);
  }
  .lead-form-file-zone--filled {
    border-style: solid;
    border-color: #c5d4ec;
    background: #f8f9fd;
  }
  .lead-form-file-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 18px 16px 19px;
    cursor: pointer;
    text-align: center;
    border-radius: 12px;
    margin: 0;
  }
  .lead-form-file-empty:hover {
    background: rgba(255, 255, 255, 0.65);
  }
  .lead-form-file-illu {
    display: flex;
    color: #a8b8da;
    margin-bottom: 2px;
  }
  .lead-form-file-title {
    font-size: 15px;
    font-weight: 600;
    color: #4a5d78;
  }
  .lead-form-file-hint {
    font-size: 12px;
    color: #8899b5;
    line-height: 1.35;
  }
  .lead-form-file-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 6px;
  }
  .lead-form-file-badges span {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 3px 7px;
    border-radius: 6px;
    background: #e8ecf6;
    color: #6b7c99;
  }
  .lead-form-file-filled {
    display: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 14px 14px;
  }
  .lead-form-file-check {
    flex-shrink: 0;
    color: #7aab8f;
    display: flex;
  }
  .lead-form-file-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .lead-form-file-name {
    font-size: 14px;
    font-weight: 600;
    color: #3d4f6f;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lead-form-file-meta {
    font-size: 11px;
    color: #8b9bb5;
  }
  .lead-form-file-actions {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    margin-left: auto;
  }
  .lead-form-file-btn {
    padding: 6px 11px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid #c8d4e8;
    background: #fff;
    color: #5a6b86;
    cursor: pointer;
  }
  .lead-form-file-btn:hover {
    background: #f4f6fb;
    border-color: #9aacd4;
  }
  .lead-form-file-btn-muted {
    border-color: #e2e8f0;
    color: #8b9bb5;
  }
  .lead-form-file-btn-muted:hover {
    background: #fff5f5;
    border-color: #e8c4c8;
    color: #b85c6a;
  }
  .lead-form > button[type="submit"] {
    margin-top: 10px;
    padding: 14px;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, #8b9dc9, #b8a8d9);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
  }
  .lead-form > button[type="submit"]:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(139, 157, 201, 0.35);
  }
  .lead-form > button[type="submit"]:active {
    transform: scale(0.98);
  }
</style>
<div class="lead-form-wrapper">
  <div class="lead-form-title">문의 등록</div>
  <form id="lead-capture-form" class="lead-form">
    <input type="text" name="name" placeholder="이름" required />
    <input type="text" name="phone" inputmode="tel" autocomplete="tel" maxlength="15" placeholder="연락처 (숫자만, 하이픈 자동)" />
    <input type="email" name="email" placeholder="이메일" required />
    <input type="text" name="company" placeholder="회사명" />
    <input type="text" name="business_number" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="사업자등록번호 (선택)" />
    <input type="text" name="address" placeholder="회사 주소" />
    <div class="lead-form-file-wrap">
      <div class="lead-form-file-caption">명함 (이미지)</div>
      <div class="lead-form-file-zone">
        <input type="file" name="business_card" accept="image/*,.pdf" class="lead-form-file-hidden" id="lead-bc-${fid}" />
        <label for="lead-bc-${fid}" class="lead-form-file-empty">
          <span class="lead-form-file-illu" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.4" />
              <circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" />
              <path d="M3 17l5.5-5.5a1.2 1.2 0 011.7 0L14 15l3.5-3.5a1.2 1.2 0 011.7 0L21 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="lead-form-file-title">명함 이미지 첨부</span>
          <span class="lead-form-file-hint">눌러서 선택하거나 파일을 여기에 놓기</span>
          <span class="lead-form-file-badges"><span>JPG</span><span>PNG</span><span>PDF</span></span>
        </label>
        <div class="lead-form-file-filled">
          <span class="lead-form-file-check" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
              <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <div class="lead-form-file-info">
            <span class="lead-form-file-name"></span>
            <span class="lead-form-file-meta"></span>
          </div>
          <div class="lead-form-file-actions">
            <button type="button" class="lead-form-file-btn lead-form-file-btn-change">변경</button>
            <button type="button" class="lead-form-file-btn lead-form-file-btn-muted">제거</button>
          </div>
        </div>
      </div>
    </div>
${customInputs}
    <button type="submit">문의 보내기</button>
  </form>
</div>
<script>
(function() {
  var form = document.getElementById('lead-capture-form');
  if (!form) return;
  function leadFormDigits(s) {
    return String(s || '').replace(/\\D/g, '');
  }
  function formatPhoneInputEmbed(raw) {
    var d = leadFormDigits(raw);
    if (d.slice(0, 2) === '82' && d.length > 2) d = ('0' + d.slice(2)).slice(0, 11);
    d = d.slice(0, 11);
    if (!d) return '';
    if (d.slice(0, 2) === '02') {
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.slice(0, 2) + '-' + d.slice(2);
      if (d.length <= 9) return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6);
      return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6, 10);
    }
    if (d.slice(0, 2) === '01') {
      if (d.length <= 3) return d;
      if (d.length <= 7) return d.slice(0, 3) + '-' + d.slice(3);
      return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    }
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length <= 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
  }
  function formatBusinessNumberInputEmbed(raw) {
    var d = leadFormDigits(raw).slice(0, 10);
    if (!d) return '';
    if (d.length <= 3) return d;
    if (d.length <= 5) return d.slice(0, 3) + '-' + d.slice(3);
    return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
  }
  function formatPhoneForSaveEmbed(value) {
    if (value == null || value === '') return '';
    var digits = leadFormDigits(value);
    if (digits.length === 0) return '';
    if (digits.length === 11 && digits.slice(0, 3) === '010') return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
    if (digits.length === 10 && digits.slice(0, 2) === '02') return digits.slice(0, 2) + '-' + digits.slice(2, 6) + '-' + digits.slice(6);
    if (digits.length === 9 && digits.slice(0, 1) === '2') return '02-' + digits.slice(1, 4) + '-' + digits.slice(4);
    if (digits.length === 10 && digits.slice(0, 2) === '01') return digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
    if (digits.length >= 9 && digits.length <= 11) return digits.replace(/(\\d{2,3})(\\d{3,4})(\\d{4})/, '$1-$2-$3');
    return digits;
  }
  function formatBusinessNumberForSaveEmbed(value) {
    var s = leadFormDigits(value).slice(0, 10);
    if (!s) return '';
    if (s.length <= 3) return s;
    if (s.length <= 5) return s.slice(0, 3) + '-' + s.slice(3);
    return s.slice(0, 3) + '-' + s.slice(3, 5) + '-' + s.slice(5);
  }
  var phoneInp = form.querySelector('input[name="phone"]');
  var bnInp = form.querySelector('input[name="business_number"]');
  if (phoneInp) {
    phoneInp.addEventListener('input', function() {
      var next = formatPhoneInputEmbed(phoneInp.value);
      if (phoneInp.value !== next) phoneInp.value = next;
    });
  }
  if (bnInp) {
    bnInp.addEventListener('input', function() {
      var next = formatBusinessNumberInputEmbed(bnInp.value);
      if (bnInp.value !== next) bnInp.value = next;
    });
  }
  var customKeys = ${customKeysJson};
  var fileInput = form.querySelector('input[name="business_card"]');
  var fileZone = form.querySelector('.lead-form-file-zone');
  var fileEmpty = form.querySelector('.lead-form-file-empty');
  var fileFilled = form.querySelector('.lead-form-file-filled');
  var fileNameEl = fileFilled ? fileFilled.querySelector('.lead-form-file-name') : null;
  var fileMetaEl = fileFilled ? fileFilled.querySelector('.lead-form-file-meta') : null;
  var btnChange = form.querySelector('.lead-form-file-btn-change');
  var btnClear = form.querySelector('.lead-form-file-btn-muted');
  function syncLeadFormFile() {
    if (!fileInput || !fileEmpty || !fileFilled || !fileZone) return;
    if (fileInput.files && fileInput.files[0]) {
      var f = fileInput.files[0];
      fileEmpty.style.display = 'none';
      fileFilled.style.display = 'flex';
      fileZone.classList.add('lead-form-file-zone--filled');
      if (fileNameEl) fileNameEl.textContent = f.name;
      if (fileMetaEl) fileMetaEl.textContent = f.size >= 1048576 ? (f.size / 1048576).toFixed(2) + ' MB' : (f.size / 1024).toFixed(1) + ' KB';
    } else {
      fileEmpty.style.display = 'flex';
      fileFilled.style.display = 'none';
      fileZone.classList.remove('lead-form-file-zone--filled');
    }
  }
  function acceptLeadFile(file) {
    if (!file || !fileInput) return;
    var ok = (file.type && file.type.indexOf('image/') === 0) || (/\\.pdf$/i).test(file.name);
    if (!ok) { alert('이미지 또는 PDF만 첨부할 수 있습니다.'); return; }
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    } catch (e) { return; }
    syncLeadFormFile();
  }
  if (fileInput) fileInput.addEventListener('change', syncLeadFormFile);
  if (btnChange) btnChange.addEventListener('click', function(e) { e.preventDefault(); fileInput.click(); });
  if (btnClear) btnClear.addEventListener('click', function(e) { e.preventDefault(); fileInput.value = ''; syncLeadFormFile(); });
  if (fileZone) {
    ['dragenter','dragleave','dragover','drop'].forEach(function(ev) {
      fileZone.addEventListener(ev, function(e) { e.preventDefault(); e.stopPropagation(); });
    });
    fileZone.addEventListener('dragenter', function() { fileZone.classList.add('lead-form-file-zone--drag'); });
    fileZone.addEventListener('dragleave', function(e) {
      if (!fileZone.contains(e.relatedTarget)) fileZone.classList.remove('lead-form-file-zone--drag');
    });
    fileZone.addEventListener('drop', function(e) {
      fileZone.classList.remove('lead-form-file-zone--drag');
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      acceptLeadFile(f);
    });
  }
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var fd = new FormData(form);
    var customFieldsObj = {};
    var phoneSave = formatPhoneForSaveEmbed(fd.get('phone'));
    if (phoneSave) customFieldsObj.phone = phoneSave;
    var bnSave = formatBusinessNumberForSaveEmbed(fd.get('business_number'));
    if (bnSave) customFieldsObj.business_number = bnSave;
    ['company', 'address'].forEach(function(k) {
      var v = fd.get(k);
      if (v !== null && v !== undefined && v !== '') customFieldsObj[k] = v;
    });
    var fileInput = form.querySelector('input[name="business_card"]');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      var reader = new FileReader();
      reader.onload = function() {
        customFieldsObj.business_card = reader.result;
        sendBody(customFieldsObj);
      };
      reader.readAsDataURL(fileInput.files[0]);
    } else {
      sendBody(customFieldsObj);
    }
    function sendBody(extra) {
      customKeys.forEach(function(k) {
        var v = fd.get('custom_' + k);
        if (v !== null && v !== undefined && v !== '') extra[k] = v;
      });
      var body = { name: fd.get('name'), email: fd.get('email'), formId: '${fid}', customFields: extra };
      var leadCaptureHeaders = { 'Content-Type': 'application/json' };
      fetch('${url}', {
        method: 'POST',
        headers: leadCaptureHeaders,
        body: JSON.stringify(body)
      }).then(function(r) { return r.ok ? alert('등록되었습니다.') : r.json(); })
        .then(function(d) { if (d && d.error) alert(d.error); })
        .catch(function() { alert('전송에 실패했습니다.'); });
    }
  });
})();
</script>`;
}
