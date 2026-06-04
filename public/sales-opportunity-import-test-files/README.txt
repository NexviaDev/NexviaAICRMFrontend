영업 기회 엑셀 가져오기 — 테스트 파일

파일: sales-opportunity-import-test-30rows.xlsx (데이터 30행 + 헤더 1행)

사용: 세일즈 현황 → 엑셀 가져오기(upload_file) → 이 파일 업로드

포함된 테스트 케이스
- 5,10,15,20,25,30행: 고객사명 비움 → 개인구매 자동
- 일부 행: 단계 INVALID_STAGE_X, 통화 XXX → 검증 단계에서 붉게 표시
- 없는고객사_999, 커스텀미등록제품, 없는유통사 등 → CRM 목록과 불일치 시 수정 필요

재생성:
  python3 demo-seeds/build-sales-opportunity-import-test-xlsx.py
  (또는 node demo-seeds/build-sales-opportunity-import-test-xlsx.js — frontend에 xlsx 패키지 필요)
