"use client";

// ZIGAP 지갑 정식 통합 (zigap-utils) — 로그인·트랜잭션 딥링크/QR 흐름.
//
// zigap-utils 는 EIP-1193 프로바이더가 아니라 자체 store-and-forward 프로토콜을
// 쓴다: 데스크톱은 QR, 모바일(같은 폰)은 딥링크로 ZIGAP 앱을 열고 결과가
// 서버 경유로 돌아온다. 그래서 wagmi 커넥터로 만들 수 없고, 별도 세션과
// 트랜잭션 모달을 이 모듈이 담당한다.
//
//   · useZigapAccount()        — 로그인 세션 (zigap-utils localStorage 기반)
//   · openZigapLogin()         — LoginQR 모달 열기 (모바일이면 원탭 딥링크)
//   · requestZigapTransaction()— SendTransactionQR 모달로 tx 서명·전송
//   · <ZigapHost />            — 두 모달의 단일 호스트 (providers 에 마운트)
//
// wagmi 경로와의 합류점은 lib/active-account.ts 의 useActiveAccount() 와
// useSendContractTx() 다 — 화면 코드는 어느 지갑인지 몰라도 된다.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { getAddress } from "viem";
import { useZigap } from "zigap-utils";
import { CHAIN_ID } from "./chain";
import { toast } from "@/components/toast";

// LoginQR / SendTransactionQR 는 브라우저 전용(웹소켓·localStorage)이라
// SSR 프리렌더에서 제외한다.
const LoginQR = dynamic(() => import("zigap-utils").then((m) => m.LoginQR), {
  ssr: false,
});
const SendTransactionQR = dynamic(
  () => import("zigap-utils").then((m) => m.SendTransactionQR),
  { ssr: false },
);

const DAPP_NAME = "XP GAME";
const DAPP_URL = "https://xp.game.kang88.io";
/** zigap-utils 네트워크 키 — v2xphere = Xphere 메인넷(XP, chainId 20250217) */
const ZIGAP_NETWORK = "v2xphere" as const;

// ─── ZIGAP 전용 트랜잭션 타입 (zigap-utils TransactionType0 형태) ───────────

export interface ZigapTxRequest {
  to: string;
  data?: string;
  /** hex string, 기본 "0x0" */
  value?: string;
  /** hex string — 호출부에서 estimateGas 결과에 여유를 얹어 전달 */
  gasLimit: string;
  /** hex string */
  gasPrice: string;
}

export interface ZigapTxResult {
  txHash: string;
  status: 0 | 1;
  error: string;
}

// ─── 모달 상태 external store (use-wallet.tsx 의 픽커와 같은 패턴) ──────────

interface PendingTx {
  tx: ZigapTxRequest;
  resolve: (r: ZigapTxResult) => void;
  reject: (e: Error) => void;
}

type HostState = {
  login: boolean;
  pendingTx: PendingTx | null;
};

let hostState: HostState = { login: false, pendingTx: null };
const listeners = new Set<() => void>();

function setHostState(next: Partial<HostState>): void {
  hostState = { ...hostState, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATE: HostState = { login: false, pendingTx: null };
function useHostState(): HostState {
  return useSyncExternalStore(
    subscribe,
    () => hostState,
    () => SERVER_STATE,
  );
}

/** ZIGAP 로그인 모달을 연다 (모바일이면 라이브러리가 딥링크로 전환). */
export function openZigapLogin(): void {
  setHostState({ login: true });
}

/**
 * ZIGAP 으로 트랜잭션 서명·전송을 요청한다. 모달이 뜨고, 사용자가 앱에서
 * 승인하면 txHash 로 resolve — 닫거나 실패하면 reject.
 */
export function requestZigapTransaction(
  tx: ZigapTxRequest,
): Promise<ZigapTxResult> {
  return new Promise<ZigapTxResult>((resolve, reject) => {
    if (hostState.pendingTx) {
      reject(new Error("another ZIGAP transaction is in progress"));
      return;
    }
    setHostState({ pendingTx: { tx, resolve, reject } });
  });
}

// ─── 세션 훅 ────────────────────────────────────────────────────────────────

export interface ZigapAccount {
  /** 체크섬 주소 — 미로그인/만료/타 네트워크면 null */
  address: `0x${string}` | null;
  logout: () => void;
}

/**
 * zigap-utils 가 localStorage 에 보관하는 로그인 세션을 앱 계정 형태로 노출.
 * Xphere(v2xphere) 로그인만 인정한다.
 */
export function useZigapAccount(): ZigapAccount {
  const { userInfo, logout, isWindowLoaded } = useZigap();

  let address: `0x${string}` | null = null;
  if (isWindowLoaded && userInfo?.address) {
    const network = (userInfo.network ?? "").toLowerCase();
    // expireDateTime 은 "YYYY-MM-DD HH:mm:ss" — Safari 는 공백 구분을 못
    // 읽으므로 ISO 형태로 바꿔 파싱한다 (만료 처리 자체는 라이브러리가 함).
    const expired =
      !!userInfo.expireDateTime &&
      new Date(userInfo.expireDateTime.replace(" ", "T")).getTime() <
        Date.now();
    if (!expired && (network === ZIGAP_NETWORK || network === "xp")) {
      try {
        address = getAddress(userInfo.address);
      } catch {
        address = null;
      }
    }
  }

  const doLogout = useCallback(() => {
    logout();
    // useZigap 은 localStorage 를 마운트 시 한 번만 읽어서 다른 컴포넌트가
    // 즉시 갱신되지 않는다 — 리로드로 전 화면을 일관되게 되돌린다.
    window.location.reload();
  }, [logout]);

  return { address, logout: doLogout };
}

// ─── 모달 호스트 ────────────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[96] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in max-h-[calc(100dvh-4rem)] w-full max-w-sm overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 -mt-1.5 flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** ZIGAP 로그인·트랜잭션 모달 — app/providers.tsx 에 한 번 마운트. */
export function ZigapHost() {
  const state = useHostState();
  // LoginQR 을 세션마다 새로 마운트해 만료된 QR 재사용을 막는다.
  const [loginNonce, setLoginNonce] = useState(0);

  const closeLogin = useCallback(() => {
    setHostState({ login: false });
    setLoginNonce((n) => n + 1);
  }, []);

  const closeTx = useCallback(() => {
    const pending = hostState.pendingTx;
    setHostState({ pendingTx: null });
    pending?.reject(new Error("closed"));
  }, []);

  return (
    <>
      {state.login && (
        <ModalShell title="Connect ZIGAP" onClose={closeLogin}>
          <div className="flex flex-col items-center gap-3">
            <LoginQR
              key={loginNonce}
              dapp={DAPP_NAME}
              url={DAPP_URL}
              availableNetworks={[ZIGAP_NETWORK]}
              sigMessage={`Sign in to ${DAPP_NAME} (Xphere Mainnet)`}
              validSeconds={600}
              expire={{ type: "EXTEND", seconds: 60 * 60 * 24 }}
              onReceive={({ status }) => {
                if (status === "SUCCESS") {
                  setHostState({ login: false });
                  toast.success("ZIGAP connected");
                  // useZigap 소비처들은 localStorage 를 마운트 시 한 번만
                  // 읽는다 — 리로드로 세션을 전 화면에 반영한다.
                  setTimeout(() => window.location.reload(), 400);
                } else if (status === "ERROR") {
                  toast.error("ZIGAP login failed — try again");
                }
              }}
            />
            <p className="text-center text-xs leading-relaxed text-[var(--muted)]">
              On this phone the ZIGAP app opens automatically — on desktop,
              scan the QR with the ZIGAP app.
            </p>
          </div>
        </ModalShell>
      )}

      {state.pendingTx && (
        <ModalShell title="Approve in ZIGAP" onClose={closeTx}>
          <div className="flex flex-col items-center gap-3">
            <SendTransactionQR
              dapp={DAPP_NAME}
              url={DAPP_URL}
              availableNetworks={ZIGAP_NETWORK}
              validSeconds={300}
              transaction={{
                type: 0,
                to: state.pendingTx.tx.to,
                data: state.pendingTx.tx.data,
                value: state.pendingTx.tx.value ?? "0x0",
                gasLimit: state.pendingTx.tx.gasLimit,
                gasPrice: state.pendingTx.tx.gasPrice,
                chainId: CHAIN_ID,
              }}
              onReceive={({
                status,
                result,
              }: {
                status: "REQUEST" | "ACCOUNT" | "SUCCESS" | "ERROR";
                result?: ZigapTxResult;
              }) => {
                const pending = hostState.pendingTx;
                if (!pending) return;
                if (status === "SUCCESS" && result) {
                  setHostState({ pendingTx: null });
                  pending.resolve(result);
                } else if (status === "ERROR") {
                  setHostState({ pendingTx: null });
                  pending.reject(
                    new Error(result?.error || "ZIGAP transaction failed"),
                  );
                }
              }}
            />
            <p className="text-center text-xs leading-relaxed text-[var(--muted)]">
              Approve the transaction in the ZIGAP app to continue.
            </p>
          </div>
        </ModalShell>
      )}
    </>
  );
}
