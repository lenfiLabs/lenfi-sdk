import { Data, Lucid, Credential } from "lucid-cardano";
import { BuilderResponse } from "../types";
import { PoolStakePoolStake } from "../plutus";

export interface DelegationParameters {
  lucid: Lucid;
  poolTokenName: string;
  stakePoolHash: string;
  stakeValidatorTxHash: string;
  stakeValidatorTxOutput: number;
  poolOwnerNftId: string;
}

export async function delegatePool(
  params: DelegationParameters
): Promise<BuilderResponse> {
  const {
    lucid,
    poolTokenName,
    stakePoolHash,
    stakeValidatorTxHash,
    stakeValidatorTxOutput,
    poolOwnerNftId,
  } = params;

  try {
    const poolOwnerUTxO = await lucid.provider.getUtxoByUnit(poolOwnerNftId);

    const stakeCredentials: Credential = {
      type: "Script",
      hash: poolTokenName,
    };
    const rewardsAddress =
      lucid.utils.credentialToRewardAddress(stakeCredentials);

    let delegateRedeemer: PoolStakePoolStake["redeemer"] = {
      Publish: [
        {
          poolOwnerOref: {
            transactionId: { hash: poolOwnerUTxO.txHash },
            outputIndex: BigInt(poolOwnerUTxO.outputIndex),
          },
        },
      ],
    };

    const validatorsUtxos = await lucid.utxosByOutRef([
      {
        txHash: stakeValidatorTxHash,
        outputIndex: Number(stakeValidatorTxOutput),
      },
    ]);

    const completedTx = await lucid
      .newTx()
      .collectFrom([poolOwnerUTxO])
      .readFrom(validatorsUtxos)
      .delegateTo(
        rewardsAddress,
        stakePoolHash,
        Data.to(delegateRedeemer, PoolStakePoolStake.redeemer)
      )
      .complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
