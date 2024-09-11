import { Data, Lucid, toUnit } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  calculateReceivedLptokens,
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
  OrderContractDepositOrderContract,
  OrderContractOutputreftype,
  PoolSpend,
} from "../plutus";

export interface BatcherExecuteDepositParams {
  lucid: Lucid;
  orderTxHash: string;
  orderTxOutputIndex: number;
  lpValidatorTxHash?: string;
  lpValidatorTxOutput?: number;
}

export async function executeBatcherDeposit(
  params: BatcherExecuteDepositParams
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
      OrderContractDepositOrderContract.datum
    );

    const poolTokenName = batcherDatumMapped.poolNftCs.assetName;
    let continuingOutputIdx = 0n;

    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);

    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );

    const poolAddress = poolArtifacts.poolUTxO.address;

    var poolDatumMapped = poolArtifacts.poolDatumMapped;

    const lpTokensToReceive: number = calculateReceivedLptokens(
      poolDatumMapped.balance,
      poolDatumMapped.lentOut,
      batcherDatumMapped.order.depositAmount,
      poolDatumMapped.totalLpTokens
    );

    const batcherRedeemer: OrderContractDepositOrderContract["redeemer"] = {
      Process: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
        additionalData: undefined,
      },
    };

    const receiverAddress = generateReceiverAddress(
      lucid,
      batcherDatumMapped.order.partialOutput.address
    );

    const toReceive = {
      [poolDatumMapped.params.lpToken.policyId +
      poolDatumMapped.params.lpToken.assetName]: BigInt(lpTokensToReceive),
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

    let datum = "";

    const thisOref: OrderContractOutputreftype["_redeemer"] = {
      transactionId: { hash: orderUtxo.txHash },
      outputIndex: BigInt(orderUtxo.outputIndex),
    };

    datum = Data.to(thisOref, OrderContractOutputreftype._redeemer);

    const receiverDetails: BatcherOutput = {
      receiverAddress,
      datum: { inline: datum },
      value: valueForUserToReceive,
    };

    const balanceToDeposit = batcherDatumMapped.order.depositAmount;

    poolDatumMapped.balance = BigInt(
      poolDatumMapped.balance +
        BigInt(balanceToDeposit) +
        poolArtifacts.poolConfigDatum.poolFee
    );

    poolDatumMapped.totalLpTokens = BigInt(
      poolDatumMapped.totalLpTokens + BigInt(lpTokensToReceive)
    );

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              LpAdjust: {
                valueDelta: balanceToDeposit,
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

    const loanAssetName = toUnitOrLovelace(
      poolDatumMapped.params.loanCs.policyId,
      poolDatumMapped.params.loanCs.assetName
    );

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    let txBuilder = lucid
      .newTx()
      .readFrom([deployedValidators.poolValidator])
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .readFrom([deployedValidators.orderContractDeposit])
      .collectFrom(
        [orderUtxo],
        Data.to(batcherRedeemer, OrderContractDepositOrderContract.redeemer)
      )
      .readFrom([poolArtifacts.configUTxO])
      .payToContract(
        poolAddress,
        { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
        {
          [loanAssetName]: poolDatumMapped.balance,
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
          [toUnit(validators.lpTokenPolicyId, poolTokenName)]:
            BigInt(lpTokensToReceive),
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
