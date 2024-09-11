import { ValidityRange } from "../../dist/src/types";
import { Credential, Data, Lucid, UTxO, toUnit } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  calculateInterestAmount,
  collectValidators,
  generateReceiverAddress,
  getPlatformFee,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import { BuilderResponse, DeployedValidators } from "../types";
import { CollateralMint, CollateralSpend, DelayedMergeSpend } from "../plutus";

export interface BatcherRepayParams {
  lucid: Lucid;
  poolTokenName: string;
  validityRange: ValidityRange;
  loanTxHash: string;
  loanTxOutputIndex: number;
}

export async function createBatcherRepay(
  params: BatcherRepayParams
): Promise<BuilderResponse> {
  const { lucid, poolTokenName, loanTxHash, validityRange, loanTxOutputIndex } =
    params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);
    const stakeCredential: Credential = {
      type: "Script",
      hash: poolTokenName,
    };

    const mergeContractAddress = lucid.utils.validatorToAddress(
      validators.mergeScript,
      stakeCredential
    );

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    const utxoToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
      {
        txHash: loanTxHash,
        outputIndex: loanTxOutputIndex,
      },
    ]);

    if (utxoToConsumeCollateral.length === 0) {
      return {
        success: false,
        error: "Did not find loan utxo in the collateral",
      };
    }
    const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
      utxoToConsumeCollateral[0],
      CollateralSpend.datum
    );

    const acumulatedInterest = calculateInterestAmount(
      collateralDatumMapped.interestRate,
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.depositTime,
      validityRange.validTo + 600 * 1000 // 10 minutes, to account for the batcher submitting 10 mins later
    );
    var poolDatumMapped = poolArtifacts.poolDatumMapped;

    poolDatumMapped.balance =
      poolDatumMapped.balance +
      collateralDatumMapped.loanAmount +
      acumulatedInterest +
      poolArtifacts.poolConfigDatum.poolFee;

    poolDatumMapped.lentOut =
      poolDatumMapped.lentOut - collateralDatumMapped.loanAmount;

    const burnRedeemer: CollateralMint["redeemer"] = {
      mints: [],
      burns: [{ tokenName: collateralDatumMapped.borrowerTn }],
    };

    const platformFee = getPlatformFee(
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.balance,
      collateralDatumMapped.lentOut,
      poolArtifacts.poolConfigDatum.loanFeeDetails
    );

    let outputIndex = 0n;
    let tx = lucid.newTx();

    if (platformFee > 0n) {
      const datum = Data.to(collateralDatumMapped.borrowerTn);

      let feeAmount = (acumulatedInterest * platformFee) / 1000000n;

      const fee_receiver_address = generateReceiverAddress(
        lucid,
        poolArtifacts.poolConfigDatum.loanFeeDetails.platformFeeCollectorAddress
      );

      tx.payToContract(
        fee_receiver_address,
        {
          inline: datum,
        },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.loanCs.policyId,
            poolDatumMapped.params.loanCs.assetName
          )]: feeAmount,
        }
      );
      outputIndex += 1n;
    }

    const amountToRepay =
      collateralDatumMapped.loanAmount + BigInt(acumulatedInterest);

    const mergeDatum: DelayedMergeSpend["_datum"] = {
      borrowerTn: collateralDatumMapped.borrowerTn,
      poolNftName: collateralDatumMapped.poolNftName,
      repayAmount: amountToRepay,
      loanAmount: collateralDatumMapped.loanAmount,
      collateralOref: {
        transactionId: { hash: utxoToConsumeCollateral[0].txHash },
        outputIndex: BigInt(utxoToConsumeCollateral[0].outputIndex),
      },
    };
    const collateralRedeemer: CollateralSpend["redeemer"] = {
      wrapper: {
        action: "CollateralRepay",
        interest: BigInt(acumulatedInterest),
        mergeType: {
          DelayedIntoPool: [
            {
              outputIndex: BigInt(0) + outputIndex,
              amountRepaying: amountToRepay,
            },
          ],
        },
      },
    };


    let repayValue = {
      [toUnitOrLovelace(
        collateralDatumMapped.loanCs.policyId,
        collateralDatumMapped.loanCs.assetName
      )]:
        amountToRepay +
        collateralDatumMapped.poolConfig.mergeActionFee +
        poolArtifacts.poolConfigDatum.poolFee,
    };

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    tx.collectFrom(
      [utxoToConsumeCollateral[0]],
      Data.to(collateralRedeemer, CollateralSpend.redeemer)
    )
      .payToContract(
        mergeContractAddress,
        {
          inline: Data.to(mergeDatum, DelayedMergeSpend._datum),
        },
        repayValue
      )
      .mintAssets(
        {
          [toUnit(
            validators.collateralValidatorHash,
            collateralDatumMapped.borrowerTn
          )]: BigInt(-1),
        },
        Data.to(burnRedeemer, CollateralMint.redeemer)
      )
      .readFrom([deployedValidators.collateralValidator])
  
      .validFrom(validityRange.validFrom)
      .validTo(validityRange.validTo);

    const completedTx = await tx.complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
