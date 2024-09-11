import { Data, Lucid, toUnit } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  calculateInterestAmount,
  collectValidators,
  generateReceiverAddress,
  getExpectedValueMap,
  getOutputReference,
  getPlatformFee,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import {
  BuilderResponse,
  DeployedValidators,
  getValueFromMapBorrow,
  ValidityRange,
} from "../types";
import {
  CollateralMint,
  CollateralSpend,
  OrderContractRepayOrderContract,
  PoolSpend,
} from "../plutus";

export interface BatcherExecuteRepayParams {
  lucid: Lucid;
  validityRange: ValidityRange;
  orderTxHash: string;
  orderTxOutputIndex: number;
}

export async function executeBatcherRepay(
  params: BatcherExecuteRepayParams
): Promise<BuilderResponse> {
  const { lucid, validityRange, orderTxHash, orderTxOutputIndex } = params;

  try {
    const orderUtxo = (
      await lucid.utxosByOutRef([
        {
          txHash: orderTxHash,
          outputIndex: orderTxOutputIndex,
        },
      ])
    )[0];

    if (orderUtxo == null) {
      return {
        success: false,
        error: "Did not find order utxo",
      };
    }

    const batcherDatumMapped: OrderContractRepayOrderContract["datum"] =
      await lucid.datumOf(orderUtxo, OrderContractRepayOrderContract.datum);
    const continuingOutputIdx = 0n;

    const poolNftName = batcherDatumMapped.poolNftCs.assetName;

    const validators = collectValidators(lucid, poolNftName, GOV_TOKEN_NAME);

    const poolArtifacts = await getPoolArtifacts(
      poolNftName,
      validators,
      lucid
    );
    var poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;
    const poolAddress = poolArtifacts.poolUTxO.address;

    const receiverAddress = generateReceiverAddress(
      lucid,
      batcherDatumMapped.order.expectedOutput.address
    );

    const utxosToConsumeCollateral = await lucid.utxosByOutRef([
      {
        txHash: batcherDatumMapped.order.order.transactionId.hash,
        outputIndex: Number(batcherDatumMapped.order.order.outputIndex),
      },
    ]);

    const utxoToConsumeCollateral = utxosToConsumeCollateral[0];

    const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
      utxoToConsumeCollateral,
      CollateralSpend.datum
    );

    const acumulatedInterest = calculateInterestAmount(
      collateralDatumMapped.interestRate,
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.depositTime,
      validityRange.validTo
    );

    const loanPlusInterest =
      acumulatedInterest + collateralDatumMapped.loanAmount;

    poolDatumMapped.balance =
      poolDatumMapped.balance +
      loanPlusInterest +
      poolArtifacts.poolConfigDatum.poolFee;

    poolDatumMapped.lentOut =
      poolDatumMapped.lentOut - BigInt(collateralDatumMapped.loanAmount);

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              CloseLoan: {
                loanAmount: BigInt(collateralDatumMapped.loanAmount),
                repayAmount:
                  BigInt(collateralDatumMapped.loanAmount) +
                  BigInt(acumulatedInterest),
                continuingOutput: continuingOutputIdx,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: getOutputReference(orderUtxo),
      },
    };

    const collateralAmount = getValueFromMapBorrow(
      batcherDatumMapped,
      poolDatumMapped.params.collateralCs.policyId,
      poolDatumMapped.params.collateralCs.assetName
    );

    if (typeof collateralAmount != "bigint") {
      throw "Could not find amount to receive";
    }

    const collateralRedeemer: CollateralSpend["redeemer"] = {
      wrapper: {
        action: "CollateralRepay",
        interest: acumulatedInterest,
        mergeType: {
          ImmediateWithPool: [getOutputReference(poolArtifacts.poolUTxO)],
        },
      },
    };

    const burnRedeemer: CollateralMint["redeemer"] = {
      mints: [],
      burns: [{ tokenName: collateralDatumMapped.borrowerTn }],
    };

    const batcherRedeemer: OrderContractRepayOrderContract["redeemer"] = {
      Process: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
        additionalData: undefined,
      },
    };

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    const collateralToReceive = getExpectedValueMap(
      batcherDatumMapped.order.expectedOutput.value
    );

    const tx = lucid
      .newTx()
      .readFrom([deployedValidators.poolValidator])
      .readFrom([poolArtifacts.configUTxO])
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .readFrom([deployedValidators.orderContractRepay])
      .collectFrom(
        [orderUtxo],
        Data.to(batcherRedeemer, OrderContractRepayOrderContract.redeemer)
      )
      .readFrom([deployedValidators.collateralValidator])
      .collectFrom(
        [utxoToConsumeCollateral],
        Data.to(collateralRedeemer, CollateralSpend.redeemer)
      )
      .payToContract(
        poolAddress,
        { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.loanCs.policyId,
            poolDatumMapped.params.loanCs.assetName
          )]: poolDatumMapped.balance,
          [toUnit(validators.poolScriptHash, poolNftName)]: BigInt(1),
        }
      )
      .payToAddress(receiverAddress, collateralToReceive)
      .mintAssets(
        {
          [toUnit(
            batcherDatumMapped.order.burnAsset.policyId,
            batcherDatumMapped.order.burnAsset.assetName
          )]: BigInt(-1),
        },
        Data.to(burnRedeemer, CollateralMint.redeemer)
      )
      .validFrom(validityRange.validFrom)
      .validTo(validityRange.validTo);

    const platformFee = getPlatformFee(
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.balance,
      collateralDatumMapped.lentOut,
      collateralDatumMapped.poolConfig.loanFeeDetails
    );

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
    }
    const completedTx = await tx.complete();

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
