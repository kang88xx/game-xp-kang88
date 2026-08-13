# Handoff — x-phere 리브랜딩 + 컨트랙트 이관 (updated 2026-08-13)

## 오늘 완료 (커밋 `7144610`, 프로덕션 배포됨)

x-phere.com / stake.x-phere.com 기반 전면 리디자인. 빌드·배포 확인 완료:
https://game-xp-kang88.vercel.app (탭 타이틀 "Xphere Mainnet Mini Game")

- **팔레트/타이포**: 순블랙 그라운드, 엠버→크림슨 램프(`--grad-brand`, `--grad-btn`),
  Pretendard + 시스템 모노. 다크가 기본 테마.
- **모션**: 그라디언트 pill CTA(글로우+호버 리프트), 타이머 burnband(플리커+ember 27개),
  burnshift 숫자 슬라이드(팔린드롬 그라디언트), 스탯카드 sheen 스윕, live-ping 도트.
- **레이아웃**: 풀폭 타이머 → Burned(1):Prize Pool(2) 가로형 스탯 → 배팅카드(버튼 인라인)
  → Fee(범례 한줄 인라인+컨트랙트 링크) → Timer Tiers. 사이드바: 아레나/Your Prizes/
  Recent Bets(Latest 12)/History.
- **클레임**: 한줄 헤더(이름+Public/Whitelist 칩), 상태 pill(Ended/live), 자격 사유를
  비활성 버튼 안에 표시.
- **버그픽스**: 언레이어드 `* { border-color }` 전역 규칙이 Tailwind border 색상
  유틸리티 전부를 무력화하던 문제 제거 (이 빌드는 author `@layer`를 평탄화함 — 주의).
- 파비콘: 투명 배경 버드 글리프 (icon.svg/png + favicon.ico, ICO는 RGBA PNG 필수).

## 진행 중 — LMS 컨트랙트 재배포 (토큰 대기)

**배경**: 기존 KangLMS `0x9552…2fe2`의 owner `0xe3d1…0358` 개인키 분실 → 소유권 이전
불가 → 새 지갑으로 재배포하기로 결정. 베팅 토큰도 KDG에서 신규 토큰으로 교체 예정
(외부에서 발행해서 가져옴 — **반드시 Xphere 체인(20250217) 위의 표준 ERC-20이어야 함**,
fee-on-transfer/리베이스 불가).

**.env.deploy 현재 상태** (gitignored):
- `DEPLOYER_PRIVATE_KEY` = 새 지갑 `0x980E1DE4E5baD5CfB444AE47865A3a9FeddC143f` (가스 ~1 XP 보유)
- `NEW_OWNER` = 0x980E…143f
- `LMS_TOKEN` = **(비어있음 — 새 토큰 주소 나오면 입력)**
- `LMS_TREASURY` = `0x8d75BD466f1c1998408F81fddC75B9C61Cb2Ab7A` (15%)
- `LMS_BURN` = `0x3cDab84c91C8974b6A4FdC9bb7CB8fF22f2a6B81` (5%)
- 주의: 토큰·수수료지갑은 KangLMS에 **immutable** — 배포 전 최종 확인 필수.

**재배포 절차** (토큰 주소 확보 후):
1. `LMS_TOKEN=` 입력 → `node scripts/compile-contract.mjs KangLMS` → `npm run deploy:lms`
2. `.env.local`: `NEXT_PUBLIC_LMS_CONTRACT` + `NEXT_PUBLIC_LMS_DEPLOY_BLOCK` 교체
   (Vercel env도 동일하게) — deploy 스크립트가 블록 번호 출력함
3. `lib/tokens`: 새 토큰 심볼/주소/데시멀/로고 교체 (KDG 참조 전부)
4. `app/page.tsx` `FEE_WALLETS` 상수(표시용)를 새 트레저리/번 주소로 교체
5. 온체인 owner == 0x980E…143f 검증

**기존 컨트랙트 (방치 예정)**:
- KangLMS `0x9552…2fe2` — 진행 중 라운드의 풀은 승자가 직접 claim 가능(권한 불필요).
  owner 기능(pause 등)은 영구 잠김.

## ⚠️ 미해결 — 에어드랍 소유권 & 예전 배포키

- Airdrop `0x06583bf2…478e`의 owner = `0x70b4B19F85041bEa823A72D41f841Dc4e028B39D`.
- 그 키는 .env.deploy에 있었으나 **새 키로 교체하는 과정에서 덮어써져 리포/디스크에
  백업이 없음** (원래 "AUTO-GENERATED throwaway TESTNET deployer" 주석이 달려 있던 키).
- **사용자가 다른 곳(패스워드 매니저 등)에 이 키를 백업해 뒀는지 확인 필요.**
  - 있으면: `LMS_OWNER_PRIVATE_KEY=` 자리에 임시로 넣고 transfer-owner.mjs를 airdrop용
    서명자로 확장하거나, DEPLOYER에 임시 복원 후 `node scripts/transfer-owner.mjs airdrop`.
  - 없으면: 에어드랍도 새 지갑으로 **재배포** (`deploy-airdrop.mjs`) 후
    `NEXT_PUBLIC_AIRDROP_CONTRACT` 교체. 기존 캠페인은 전부 종료된 테스트 데이터라 영향 적음.

## 지갑 정리표

| 용도 | 주소 | 키 상태 |
|---|---|---|
| 새 운영/배포 지갑 (목표 owner) | `0x980E1DE4E5baD5CfB444AE47865A3a9FeddC143f` | .env.deploy 보유 ✓ |
| 새 트레저리 (fee 15%) | `0x8d75BD466f1c1998408F81fddC75B9C61Cb2Ab7A` | 사용자 관리 |
| 새 번 (fee 5%) | `0x3cDab84c91C8974b6A4FdC9bb7CB8fF22f2a6B81` | 사용자 관리 |
| 구 배포키 / Airdrop owner | `0x70b4…B39D` | **백업 여부 불명 ⚠️** |
| 구 LMS owner | `0xe3d1…0358` | 분실 확정 |

## 열어둔 디자인 논의
- 배지/칩/텍스트 시안은 전부 반영 완료. 남은 제안 없음.
- 시안 목업 HTML들은 스크래치패드(세션 임시 폴더)에 있었음 — 재생성 필요시 대화 참조.

## 개발 메모
- dev 서버: `npm run dev` (.devserver.log). 헤드리스 QA: gstack `/browse`.
- globals.css 수정이 핫리로드에 안 잡히면 `touch app/globals.css`.
- tsc 검증: `npx tsc --noEmit` (파이프 없이 — `| head` 붙이면 exit code가 head 것이 됨).
