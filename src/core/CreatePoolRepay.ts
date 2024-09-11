import {
  Data,
  Lucid,
  Credential,
  toUnit,
  TxComplete,
  UTxO,
} from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  calculateInterestAmount,
  collectValidators,
  generateReceiverAddress,
  getOutputReference,
  getPlatformFee,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import { BuilderResponse, DeployedValidators, ValidityRange } from "../types";
import { CollateralMint, CollateralSpend, PoolSpend } from "../plutus";

export interface RepayParams {
  lucid: Lucid;
  validityRange: ValidityRange;
  poolTokenName: string;
  loanTxHash: string;
  loanTxOutputIndex: number;
}

export async function repayLoan(params: RepayParams): Promise<BuilderResponse> {
  const { lucid, validityRange, poolTokenName, loanTxHash, loanTxOutputIndex } =
    params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    const stakeCredential: Credential = {
      type: "Script",
      hash: poolTokenName,
    };

    const poolAddress = lucid.utils.validatorToAddress(
      validators.poolValidator,
      stakeCredential
    );

    const poolDatumMapped = poolArtifacts.poolDatumMapped;
    const poolConfigDatum = poolArtifacts.poolConfigDatum;

    const utxoToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
      {
        txHash: loanTxHash,
        outputIndex: loanTxOutputIndex,
      },
    ]);

    const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
      utxoToConsumeCollateral[0],
      CollateralSpend.datum
    );

    const accumulatedInterest = calculateInterestAmount(
      collateralDatumMapped.interestRate,
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.depositTime,
      validityRange.validTo
    );

    poolDatumMapped.balance =
      poolDatumMapped.balance +
      collateralDatumMapped.loanAmount +
      accumulatedInterest +
      poolArtifacts.poolConfigDatum.poolFee;
    poolDatumMapped.lentOut =
      poolDatumMapped.lentOut - collateralDatumMapped.loanAmount;

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              CloseLoan: {
                loanAmount: collateralDatumMapped.loanAmount,
                repayAmount:
                  collateralDatumMapped.loanAmount + accumulatedInterest,
                continuingOutput: 0n,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: null,
      },
    };

    const burnRedeemer: CollateralMint["redeemer"] = {
      mints: [],
      burns: [{ tokenName: collateralDatumMapped.borrowerTn }],
    };

    const collateralRedeemer: CollateralSpend["redeemer"] = {
      wrapper: {
        action: "CollateralRepay",
        interest: accumulatedInterest,
        mergeType: {
          ImmediateWithPool: [getOutputReference(poolArtifacts.poolUTxO)],
        },
      },
    };
    const platformFee = getPlatformFee(
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.balance,
      collateralDatumMapped.lentOut,
      collateralDatumMapped.poolConfig.loanFeeDetails
    );

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    let txBuilder = lucid
      .newTx()
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .collectFrom(
        [utxoToConsumeCollateral[0]],
        Data.to(collateralRedeemer, CollateralSpend.redeemer)
      )
      .payToContract(
        poolAddress,
        {
          inline: Data.to(poolDatumMapped, PoolSpend.datum),
        },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.loanCs.policyId,
            poolDatumMapped.params.loanCs.assetName
          )]: poolDatumMapped.balance,
          [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(1),
        }
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
      .readFrom([poolArtifacts.configUTxO])
      .readFrom([deployedValidators.poolValidator])
      .readFrom([deployedValidators.collateralValidator])
      .validFrom(validityRange.validFrom)
      .validTo(validityRange.validTo);

    if (platformFee > 0n) {
      const datum = Data.to(collateralDatumMapped.borrowerTn);

      let feeAmount = (accumulatedInterest * platformFee) / 1000000n;

      const fee_receiver_address = generateReceiverAddress(
        lucid,
        poolArtifacts.poolConfigDatum.loanFeeDetails.platformFeeCollectorAddress
      );
      txBuilder.payToContract(
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
    }

    const completedTx = await txBuilder.complete();

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
