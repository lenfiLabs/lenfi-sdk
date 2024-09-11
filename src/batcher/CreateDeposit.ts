import { Data, Lucid, getAddressDetails } from "lucid-cardano";
import { GOV_TOKEN_NAME } from "../constants";
import {
  collectValidators,
  getPoolArtifacts,
  toUnitOrLovelace,
  updateUserValue,
} from "../utils/helpers";
import { BuilderResponse, OutputValue, StakeCredential } from "../types";
import { OrderContractDepositOrderContract } from "../plutus";

export interface BatcherDepositParams {
  lucid: Lucid;
  balanceToDeposit: bigint;
  poolTokenName: string;
}

export async function createBatcherDeposit(
  params: BatcherDepositParams
): Promise<BuilderResponse> {
  const { lucid, balanceToDeposit, poolTokenName } = params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);
    const batcherAddress = lucid.utils.validatorToAddress(
      validators.orderContractDeposit
    );

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    const poolDatumMapped = poolArtifacts.poolDatumMapped;
    const poolConfigDatum = poolArtifacts.poolConfigDatum;

    if (balanceToDeposit < poolConfigDatum.minTransition) {
      throw new Error("Protocol does not allow this small deposit");
    }

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

    const batcherDatum: OrderContractDepositOrderContract["datum"] = {
      controlCredential: {
        VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
      },
      poolNftCs: {
        policyId: validators.poolScriptHash,
        assetName: poolTokenName,
      },
      batcherFeeAda: 2000000n,
      order: {
        depositAmount: BigInt(balanceToDeposit),
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
        lpAsset: poolDatumMapped.params.lpToken,
      },
    };

    const loanAssetName = toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    );

    const valueToSendToBatcher: { [assetId: string]: bigint } = {};
    valueToSendToBatcher[loanAssetName] = BigInt(balanceToDeposit);

    const depositValue = {
      [loanAssetName]: BigInt(balanceToDeposit),
    };

    // Batcher must receive 2 ADA fee and 2 ADA deposit.
    let valueSendToBatcher: OutputValue = { lovelace: 4000000n };

    if (poolArtifacts.poolConfigDatum.poolFee > 0n) {
      const poolFee = {
        [loanAssetName]: BigInt(poolArtifacts.poolConfigDatum.poolFee),
      };
      valueSendToBatcher = updateUserValue(valueSendToBatcher, poolFee);
    }
    // Add new value to the datum value
    valueSendToBatcher = updateUserValue(valueSendToBatcher, depositValue);

    const completedTx = await lucid
      .newTx()
      .payToContract(
        batcherAddress,
        {
          inline: Data.to(
            batcherDatum,
            OrderContractDepositOrderContract.datum
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
