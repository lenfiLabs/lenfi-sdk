import { Data, Lucid, getAddressDetails } from "lucid-cardano";
import { GOV_TOKEN_NAME } from "../constants";
import {
  calculateLpsToBurn,
  collectValidators,
  getPoolArtifacts,
  toUnitOrLovelace,
  addAssets,
  getWalletStakeCredentials,
} from "../utils/helpers";
import { BuilderResponse, OutputValue } from "../types";
import { OrderContractWithdrawOrderContract } from "../plutus";

export interface BatcherWithdrawParams {
  lucid: Lucid;
  amountToWithdraw: bigint;
  poolTokenName: string;
}

/**
 * Creates a batcher withdraw transaction for the Lenfi protocol.
 * 
 * @param {Object} params - The parameters for creating a batcher withdraw.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
 * @param {bigint} params.amountToWithdraw - The amount of tokens to withdraw from the pool.
 * @param {string} params.poolTokenName - The name of the pool token.
 * 
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status and either the completed transaction or an error message.
 * 
 * @throws {Error} Throws an error if the withdrawal amount is below the minimum allowed by the protocol.
 */

export async function createBatcherWithdraw(
  params: BatcherWithdrawParams
): Promise<BuilderResponse> {
  const { lucid, amountToWithdraw, poolTokenName } = params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);
    const batcherAddress = lucid.utils.validatorToAddress(
      validators.orderContractWithdraw
    );

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    const poolDatumMapped = poolArtifacts.poolDatumMapped;
    const poolConfigDatum = poolArtifacts.poolConfigDatum;

    if (amountToWithdraw < poolConfigDatum.minTransition) {
      throw new Error("Protocol does not allow this small withdrawal");
    }

    let lpsToBurn = calculateLpsToBurn(
      poolDatumMapped.balance,
      poolDatumMapped.lentOut,
      amountToWithdraw,
      poolDatumMapped.totalLpTokens
    );

    const walletAddress = await lucid.wallet.address();
    const walletDetails = getAddressDetails(walletAddress);

    const walletStakeCredentials = getWalletStakeCredentials(walletDetails);

    const batcherDatum: OrderContractWithdrawOrderContract["datum"] = {
      controlCredential: {
        VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
      },
      poolNftCs: {
        policyId: validators.poolScriptHash,
        assetName: poolTokenName,
      },
      batcherFeeAda: BigInt(2000000),
      order: {
        lpTokensBurn: BigInt(lpsToBurn),
        partialOutput: {
          address: {
            paymentCredential: {
              VerificationKeyCredential: [
                walletDetails.paymentCredential!.hash,
              ],
            },
            stakeCredential: walletStakeCredentials,
          },
          value: new Map([["", new Map([["", BigInt(2000000)]])]]),
          datum: "NoDatum",
        },
        receiveAsset: {
          policyId: poolDatumMapped.params.loanCs.policyId,
          assetName: poolDatumMapped.params.loanCs.assetName,
        },
        lpAsset: {
          policyId: poolDatumMapped.params.lpToken.policyId,
          assetName: poolDatumMapped.params.lpToken.assetName,
        },
      },
    };

    const assetName = toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    );

    const withdrawValue = {
      [assetName]: BigInt(lpsToBurn),
    };

    let valueSendToBatcher: OutputValue = { lovelace: 4000000n };

    if (poolArtifacts.poolConfigDatum.poolFee > 0n) {
      const poolFee = {
        [assetName]: BigInt(poolArtifacts.poolConfigDatum.poolFee),
      };
      valueSendToBatcher = addAssets(valueSendToBatcher, poolFee);
    }

    // Add new value to the datum value
    valueSendToBatcher = addAssets(valueSendToBatcher, withdrawValue);

    const completedTx = await lucid
      .newTx()
      .payToContract(
        batcherAddress,
        {
          inline: Data.to(
            batcherDatum,
            OrderContractWithdrawOrderContract.datum
          ),
        },
        valueSendToBatcher
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
