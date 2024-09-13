import { Data, Lucid, toUnit } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  collectValidators,
  generateReceiverAddress,
  getOutputReference,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
  addAssets,
} from "../utils/helpers";
import {
  BatcherOutput,
  BuilderResponse,
  DeployedValidators,
  OutputValue,
} from "../types";
import {
  LiquidityTokenLiquidityToken,
  OrderContractOutputreftype,
  OrderContractWithdrawOrderContract,
  PoolSpend,
} from "../plutus";
import BigNumber from "bignumber.js";

export interface BatcherExecuteWithdrawParams {
  lucid: Lucid;
  orderTxHash: string;
  orderTxOutputIndex: number;
  lpValidatorTxHash?: string;
  lpValidatorTxOutput?: number;
}

/**
 * Executes a batcher withdraw order in the Lenfi protocol.
 * 
 * @param {Object} params - The parameters for executing a batcher withdraw order.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
 * @param {string} params.orderTxHash - The transaction hash of the withdraw order to be executed.
 * @param {number} params.orderTxOutputIndex - The output index of the withdraw order in the transaction.
 * @param {string} [params.lpValidatorTxHash] - Optional. The transaction hash where the LP validator script is stored for reference.
 * @param {number} [params.lpValidatorTxOutput] - Optional. The transaction output index where the LP validator script is stored for reference.
 * 
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status and either the completed transaction or an error message.
 * 
 * @throws {Error} Throws an error if:
 *   - The order UTxO is not found
 *   - The amount to receive cannot be calculated
 */

export async function executeBatcherWithdraw(
  params: BatcherExecuteWithdrawParams
): Promise<BuilderResponse> {
  const {
    lucid,
    orderTxHash,
    orderTxOutputIndex,
    lpValidatorTxHash,
    lpValidatorTxOutput,
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
      OrderContractWithdrawOrderContract.datum
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

    const initialCountBN = new BigNumber(
      Number(batcherDatumMapped.order.lpTokensBurn)
    );
    const balanceBN = new BigNumber(
      Number(poolDatumMapped.balance + poolDatumMapped.lentOut)
    );
    const totalLPTokensBN = new BigNumber(
      Number(poolDatumMapped.totalLpTokens)
    );

    let amountToReceive = BigInt(
      Math.floor(
        initialCountBN
          .multipliedBy(balanceBN)
          .dividedToIntegerBy(totalLPTokensBN)
          .toNumber()
      )
    );

    poolDatumMapped.balance =
      poolDatumMapped.balance -
      BigInt(amountToReceive) +
      poolArtifacts.poolConfigDatum.poolFee;

    poolDatumMapped.totalLpTokens =
      poolDatumMapped.totalLpTokens -
      BigInt(batcherDatumMapped.order.lpTokensBurn);

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              LpAdjust: {
                valueDelta: amountToReceive * -1n,
                continuingOutput: continuingOutputIdx,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: getOutputReference(orderUtxo),
      },
    };

    const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
      TransitionPool: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
        continuingOutput: continuingOutputIdx,
      },
    };

    const batcherRedeemer: OrderContractWithdrawOrderContract["redeemer"] = {
      Process: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
        additionalData: undefined,
      },
    };

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    let datum = "";

    const thisOref: OrderContractOutputreftype["_redeemer"] =
      getOutputReference(orderUtxo);

    datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);

    const receiverAddress = generateReceiverAddress(
      lucid,
      batcherDatumMapped.order.partialOutput.address
    );

    const loanAsset = toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    );
    const toReceive = {
      [loanAsset]: amountToReceive,
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

    const receiverDetails: BatcherOutput = {
      receiverAddress,
      datum: { inline: datum },
      value: valueForUserToReceive,
    };


    let txBuilder = lucid
      .newTx()
      .readFrom([deployedValidators.poolValidator])
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .readFrom([deployedValidators.orderContractWithdraw])
      .collectFrom(
        [orderUtxo],
        Data.to(batcherRedeemer, OrderContractWithdrawOrderContract.redeemer)
      )
      .readFrom([poolArtifacts.configUTxO])
      .payToContract(
        poolAddress,
        { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
        {
          [loanAsset]: poolDatumMapped.balance,
          [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(1),
        }
      )
      .payToContract(
        receiverDetails.receiverAddress,
        receiverDetails.datum,
        receiverDetails.value
      )
      .mintAssets(
        {
          [toUnit(
            poolDatumMapped.params.lpToken.policyId,
            poolDatumMapped.params.lpToken.assetName
          )]: BigInt(BigInt(batcherDatumMapped.order.lpTokensBurn) * -1n),
        },
        Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
      );

    // If LP validator ref script is not provided - attach minting policy.
    if (lpValidatorTxHash != null && lpValidatorTxOutput != null) {
      const validatorsUtxos = await lucid.utxosByOutRef([
        {
          txHash: lpValidatorTxHash,
          outputIndex: Number(lpValidatorTxOutput),
        },
      ]);
      txBuilder.readFrom(validatorsUtxos);
    } else {
      txBuilder.attachMintingPolicy(validators.lpTokenPolicy);
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
