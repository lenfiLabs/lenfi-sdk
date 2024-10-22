import { Data, Lucid, Credential } from "lucid-cardano";
import { BuilderResponse } from "../types";
import { PoolStakePoolStake } from "../plutus";
import { getOutputReference } from "../utils/helpers";

export interface DelegationParameters {
  /**
   * The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
   */
  lucid: Lucid;

  /**
   * The name of the pool token.
   */
  poolTokenName: string;

  /**
   * The hash of the stake pool to delegate to.
   */
  stakePoolHash: string;

  /**
   * The transaction hash where the stake validator script is stored for reference.
   */
  stakeValidatorTxHash: string;

  /**
   * The transaction output index where the stake validator script is stored for reference.
   */
  stakeValidatorTxOutput: number;

  /**
   * The ID of the NFT owned by the pool owner.
   */
  poolOwnerNftId: string;
}

/**
 * Delegates a Lenfi pool to a stake pool.
 * 
 * @param {DelegationParameters} params - The parameters for delegating a pool.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
 * @param {string} params.poolTokenName - The name of the pool token.
 * @param {string} params.stakePoolHash - The hash of the stake pool to delegate to.
 * @param {string} params.stakeValidatorTxHash - The transaction hash where the stake validator script is stored for reference.
 * @param {number} params.stakeValidatorTxOutput - The transaction output index where the stake validator script is stored for reference.
 * @param {string} params.poolOwnerNftId - The ID of the NFT owned by the pool owner.
 * 
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status and either the completed transaction or an error message.
 * 
 * @throws {Error} Throws an error if the delegation process fails for any reason.
 */

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
          poolOwnerOref: getOutputReference(poolOwnerUTxO),
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
