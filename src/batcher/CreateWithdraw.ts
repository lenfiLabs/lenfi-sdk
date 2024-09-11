import { Data, Lucid, getAddressDetails } from "lucid-cardano";
import { GOV_TOKEN_NAME } from "../constants";
import {
  calculateLpsToBurn,
  collectValidators,
  getPoolArtifacts,
  toUnitOrLovelace,
  updateUserValue,
} from "../utils/helpers";
import { BuilderResponse, OutputValue, StakeCredential } from "../types";
import { OrderContractWithdrawOrderContract } from "../plutus";

export interface BatcherWithdrawParams {
  lucid: Lucid;
  amountToWithdraw: bigint;
  poolTokenName: string;
}

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

    let stakeCredentials: StakeCredential | null = null;

    if (walletDetails["stakeCredential"]) {
      if (walletDetails["stakeCredential"]["type"] === "Key") {
        stakeCredentials = {
          Inline: [
            {
              VerificationKeyCredential: [
                walletDetails["stakeCredential"]["hash"],
              ],
            },
          ],
        };
      } else if (walletDetails["stakeCredential"]["type"] === "Script") {
        stakeCredentials = {
          Inline: [
            {
              ScriptCredential: [walletDetails["stakeCredential"]["hash"]],
            },
          ],
        };
      }
    }

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
            stakeCredential: stakeCredentials,
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
      valueSendToBatcher = updateUserValue(valueSendToBatcher, poolFee);
    }

    // Add new value to the datum value
    valueSendToBatcher = updateUserValue(valueSendToBatcher, withdrawValue);

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
