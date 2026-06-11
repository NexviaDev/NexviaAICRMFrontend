/** 추가 필드 정의 — 활성(표시·입력) 여부 */

export function isCustomFieldDefinitionActive(def) {
  return !!def && def.disabled !== true;
}

export function filterActiveCustomFieldDefinitions(definitions = []) {
  return (definitions || []).filter(isCustomFieldDefinitionActive);
}
