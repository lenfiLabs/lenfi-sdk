import { Credential, Data, Lucid, toUnit } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  collectOracleDetails,
  collectValidators,
  generateReceiverAddress,
  getExpectedValueMap,
  getInterestRates,
  getOutputReference,
  getPoolArtifacts,
  getValueFromMap,
  nameFromUTxO,
  parseValidators,
  toUnitOrLovelace,
  addAssets,
} from "../utils/helpers";
import {
  BatcherOutput,
  BuilderResponse,
  DeployedValidators,
  OracelValidatorDetails,
  OutputValue,
  TokenPrice,
  ValidityRange,
} from "../types";
import {
  CollateralMint,
  CollateralSpend,
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  PoolSpend,
} from "../plutus";

export interface BatcherExecuteBorrowParams {
  lucid: Lucid;
  validityRange: ValidityRange;
  orderTxHash: string;
  orderTxOutputIndex: number;
  collateralTokenPrice: TokenPrice | undefined;
  loanTokenPrice: TokenPrice | undefined;
}

/**
 * Executes a batcher borrow order in the Lenfi protocol.
 * 
 * @param {Object} params - The parameters for executing a batcher borrow order.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
 * @param {ValidityRange} params.validityRange - The validity range for the transaction.
 * @param {string} params.orderTxHash - The transaction hash of the borrow order to be executed.
 * @param {number} params.orderTxOutputIndex - The output index of the borrow order in the transaction.
 * @param {TokenPrice | undefined} params.collateralTokenPrice - The price information for the collateral token.
 * @param {TokenPrice | undefined} params.loanTokenPrice - The price information for the loan token.
 * 
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status and either the completed transaction or an error message.
 * 
 * @throws {Error} Throws an error if:
 *   - The order UTxO is not found
 *   - The loan amount is greater than the pool balance
 *   - The interest rate is too high
 *   - The loan or collateral amount cannot be determined
 */

export async function executeBatcherBorrow(
  params: BatcherExecuteBorrowParams
): Promise<BuilderResponse> {
  const {
    lucid,
    validityRange,
    orderTxHash,
    orderTxOutputIndex,
    collateralTokenPrice,
    loanTokenPrice,
  } = params;

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

    const batcherDatumMapped = await lucid.datumOf(
      orderUtxo,
      OrderContractBorrowOrderContract.datum
    );

    const poolTokenName = batcherDatumMapped.poolNftCs.assetName;

    let continuingOutputIdx = 0n;

    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);
    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    var poolDatumMapped = poolArtifacts.poolDatumMapped;

    const poolAddress = poolArtifacts.poolUTxO.address;

    const poolStakeCredentials: Credential = {
      type: "Script",
      hash: poolTokenName,
    };

    const collateralContractAddress = lucid.utils.validatorToAddress(
      validators.collateralValidator,
      poolStakeCredentials
    );

    var poolDatumMapped: PoolSpend["datum"] = poolArtifacts.poolDatumMapped;
    const poolConfigDatum = poolArtifacts.poolConfigDatum;

    const borrowerTokenName = nameFromUTxO(poolArtifacts.poolUTxO);
    const collateralAmount = batcherDatumMapped.order.minCollateralAmount;

    const expectedOrderValue = batcherDatumMapped.order.expectedOutput.value;

    const loanAmount: bigint | null = getValueFromMap(
      expectedOrderValue,
      poolArtifacts.poolDatumMapped.params.loanCs.policyId,
      poolArtifacts.poolDatumMapped.params.loanCs.assetName
    );

    if (typeof loanAmount != "bigint") {
      throw "Could not find amount to receive";
    }

    if (loanAmount >= poolDatumMapped.balance) {
      throw "trying to borrow more than pool has";
    }

    poolDatumMapped.balance =
      poolDatumMapped.balance - loanAmount + poolConfigDatum.poolFee;
    poolDatumMapped.lentOut = poolDatumMapped.lentOut + loanAmount;

    let interestRate = getInterestRates(
      poolConfigDatum.interestParams,
      loanAmount,
      poolDatumMapped.lentOut,
      poolDatumMapped.balance
    );

    if (
      Number(interestRate) > Number(batcherDatumMapped.order.maxInterestRate)
    ) {
      throw "Interest rate is too high";
    }

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              Borrow: {
                loanAmount: loanAmount,
                collateralAmount: collateralAmount,
                borrowerTn: borrowerTokenName,
                interestRate: interestRate,
                continuingOutput: continuingOutputIdx,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: getOutputReference(orderUtxo),
      },
    };

    const batcherRedeemer: OrderContractBorrowOrderContract["redeemer"] = {
      Process: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
        additionalData: {
          borrowerTokenName: borrowerTokenName,
          additionalAda: 0n,
        },
      },
    };

    const borrowerTokenRedeemer: CollateralMint["redeemer"] = {
      mints: [
        {
          outputReference: getOutputReference(poolArtifacts.poolUTxO),
          outputPointer: 1n,
        },
      ],
      burns: [],
    };

    let collateralData: CollateralSpend["datum"] = {
      poolNftName: poolTokenName,
      loanCs: poolDatumMapped.params.loanCs,
      loanAmount: loanAmount,
      poolConfig: poolArtifacts.poolConfigDatum,
      collateralCs: poolDatumMapped.params.collateralCs,
      collateralAmount: collateralAmount,
      interestRate: interestRate,
      depositTime: BigInt(validityRange.validFrom),
      borrowerTn: borrowerTokenName,
      oracleCollateralAsset: poolDatumMapped.params.oracleCollateralAsset,
      oracleLoanAsset: poolDatumMapped.params.oracleLoanAsset,
      tag: getOutputReference(orderUtxo),
      lentOut: poolDatumMapped.lentOut - loanAmount,
      balance: poolDatumMapped.balance + loanAmount - poolConfigDatum.poolFee,
    };

    let oracleDetails: OracelValidatorDetails[] = [];

    if (
      poolDatumMapped.params.loanCs.policyId !== "" &&
      loanTokenPrice != null
    ) {
      oracleDetails = await collectOracleDetails(
        poolDatumMapped.params.oracleLoanAsset,
        poolDatumMapped.params.loanCs,
        lucid,
        oracleDetails,
        loanTokenPrice
      );
    }

    if (
      poolDatumMapped.params.collateralCs.policyId !== "" &&
      collateralTokenPrice != null
    ) {
      oracleDetails = await collectOracleDetails(
        poolDatumMapped.params.oracleCollateralAsset,
        poolDatumMapped.params.collateralCs,
        lucid,
        oracleDetails,
        collateralTokenPrice
      );
    }

    const receiverAddress = generateReceiverAddress(
      lucid,
      batcherDatumMapped.order.partialOutput.address
    );

    const loanToReceive = getExpectedValueMap(
      batcherDatumMapped.order.expectedOutput.value
    );

    const partialOutput = getExpectedValueMap(
      batcherDatumMapped.order.partialOutput.value
    );

    partialOutput[
      toUnit(validators.collateralValidatorHash, borrowerTokenName)
    ] = 1n;

    const toReceive = {
      [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
    };

    let valueForUserToReceive: OutputValue = {};

    for (const [policyId, assetMap] of batcherDatumMapped.order.partialOutput
      .value) {
      for (const [assetName, amount] of assetMap) {
        valueForUserToReceive[toUnitOrLovelace(policyId, assetName)] = amount;
      }
    }
    // Add new value to the datum value
    valueForUserToReceive = addAssets(valueForUserToReceive, toReceive);

    const receiverDetails: BatcherOutput[] = [
      {
        receiverAddress, // partial output
        datum: "",
        value: valueForUserToReceive,
      },
      {
        receiverAddress,
        datum: "",
        value: loanToReceive,
      },
    ];

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    const tx = lucid
      .newTx()
      .readFrom([deployedValidators.poolValidator])
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .readFrom([poolArtifacts.configUTxO])
      .payToContract(
        poolAddress,
        { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.loanCs.policyId,
            poolDatumMapped.params.loanCs.assetName
          )]: BigInt(poolDatumMapped.balance),
          [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
        }
      )
      .payToContract(
        collateralContractAddress,
        { inline: Data.to(collateralData, CollateralSpend.datum) },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.collateralCs.policyId,
            poolDatumMapped.params.collateralCs.assetName
          )]: BigInt(collateralAmount),
        }
      )
      .readFrom([deployedValidators.orderContractBorrow])
      .collectFrom(
        [orderUtxo],
        Data.to(batcherRedeemer, OrderContractBorrowOrderContract.redeemer)
      )
      .payToAddress(
        receiverDetails[0].receiverAddress,
        receiverDetails[0].value
      )
      .payToAddress(
        receiverDetails[1].receiverAddress,
        receiverDetails[1].value
      )
      .readFrom([deployedValidators.collateralValidator])
      .mintAssets(
        {
          [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
        },
        Data.to(borrowerTokenRedeemer, CollateralMint.redeemer)
      )
      .validFrom(validityRange.validFrom)
      .validTo(validityRange.validTo);

    oracleDetails.forEach(async (oracle) => {
      tx.withdraw(
        oracle.rewardAddress,
        0n,
        Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
      ).readFrom([oracle.nftReferenceUtxo]);
    });

    const completedTx = await tx.complete();

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
