"use client";

// 활성 지갑 추상화 — wagmi(브라우저 확장/인앱)와 ZIGAP 딥링크 세션의 합류점.
//
// 화면 코드는 useActiveAccount()/useSendContractTx() 만 쓰면 두 지갑을
// 구분할 필요가 없다. wagmi 연결이 있으면 그것이 우선하고, 없으면 ZIGAP
// 로그인 세션을 계정으로 취급한다. ZIGAP 세션은 항상 Xphere 메인넷 기준
// (다른 체인 로그인은 useZigapAccount 가 걸러낸다).

import { useCallback } from "react";
import {
  encodeFunctionData,
  numberToHex,
  type Abi,
} from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { CHAIN_ID } from "./chain";
import {
  requestZigapTransaction,
  useZigapAccount,
} from "./zigap";

export type WalletKind = "wagmi" | "zigap" | null;

export interface ActiveAccount {
  address: `0x${string}` | undefined;
  /** wagmi 는 지갑이 보고하는 체인, ZIGAP 은 항상 Xphere */
  chainId: number | undefined;
  kind: WalletKind;
  /** 트랜잭션을 보낼 수 있는 체인 상태인가 (ZIGAP 은 항상 true) */
  onXphere: boolean;
}

export function useActiveAccount(): ActiveAccount {
  const { address, chainId } = useAccount();
  const zigap = useZigapAccount();

  if (address) {
    return { address, chainId, kind: "wagmi", onXphere: chainId === CHAIN_ID };
  }
  if (zigap.address) {
    return {
      address: zigap.address,
      chainId: CHAIN_ID,
      kind: "zigap",
      onXphere: true,
    };
  }
  return { address: undefined, chainId: undefined, kind: null, onXphere: false };
}

export interface ContractTxRequest {
  address: `0x${string}`;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/**
 * 활성 지갑으로 컨트랙트 쓰기 트랜잭션을 보내고 tx 해시를 돌려준다.
 * wagmi → writeContractAsync, ZIGAP → calldata 인코딩 후 딥링크/QR 모달.
 * 호출부는 해시로 waitForTransactionReceipt 하면 된다 (두 경로 동일).
 */
export function useSendContractTx(): (
  req: ContractTxRequest,
) => Promise<`0x${string}`> {
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const account = useActiveAccount();

  return useCallback(
    async (req: ContractTxRequest) => {
      if (account.kind !== "zigap") {
        return writeContractAsync({
          address: req.address,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          abi: req.abi as any,
          functionName: req.functionName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: req.args as any,
          chainId: CHAIN_ID,
        });
      }

      if (!publicClient) throw new Error("no rpc client");
      const data = encodeFunctionData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        abi: req.abi as any,
        functionName: req.functionName,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        args: req.args as any,
      });
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateGas({
          account: account.address!,
          to: req.address,
          data,
        }),
        publicClient.getGasPrice(),
      ]);
      const result = await requestZigapTransaction({
        to: req.address,
        data,
        value: "0x0",
        // 견적에 50% 여유 — 티어 경계 등으로 상태가 바뀌어도 안 모자라게.
        gasLimit: numberToHex((gas * 15n) / 10n),
        gasPrice: numberToHex((gasPrice * 12n) / 10n),
      });
      if (result.status !== 1 || !result.txHash) {
        throw new Error(result.error || "ZIGAP transaction failed");
      }
      return result.txHash as `0x${string}`;
    },
    [account.kind, account.address, publicClient, writeContractAsync],
  );
}
