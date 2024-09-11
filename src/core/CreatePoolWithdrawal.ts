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
  calculateLpsToBurn,
  collectValidators,
  getOutputReference,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import { BuilderResponse, DeployedValidators } from "../types";
import { LiquidityTokenLiquidityToken, PoolSpend } from "../plutus";

export interface WithdrawParams {
  lucid: Lucid;
  amountToWithdraw: bigint;
  poolTokenName: string;
  lpValidatorTxHash?: string;
  lpValidatorTxOutput?: number;
}

export async function createWithdrawal(
  params: WithdrawParams
): Promise<BuilderResponse> {
  const {
    lucid,
    amountToWithdraw,
    poolTokenName,
    lpValidatorTxHash,
    lpValidatorTxOutput,
  } = params;

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

    if (amountToWithdraw < poolConfigDatum.minTransition) {
      throw new Error("Protocol does not allow this small withdrawal");
    }

    let lpsToBurn = calculateLpsToBurn(
      poolDatumMapped.balance,
      poolDatumMapped.lentOut,
      amountToWithdraw,
      poolDatumMapped.totalLpTokens
    );

    poolDatumMapped.balance =
      poolDatumMapped.balance -
      BigInt(amountToWithdraw) +
      poolConfigDatum.poolFee;
    poolDatumMapped.totalLpTokens =
      poolDatumMapped.totalLpTokens - BigInt(lpsToBurn);

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              LpAdjust: {
                valueDelta: BigInt(amountToWithdraw) * -1n,
                continuingOutput: 0n,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: null,
      },
    };
    const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
      TransitionPool: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
        continuingOutput: 0n,
      },
    };

    let valueToRepay = {
      [toUnitOrLovelace(
        poolDatumMapped.params.loanCs.policyId,
        poolDatumMapped.params.loanCs.assetName
      )]: poolDatumMapped.balance,
      [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
    };

    if (poolDatumMapped.balance === 0n) {
      valueToRepay = {
        [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
      };
    }

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    const txBuilder = lucid
      .newTx()
      .readFrom([deployedValidators.poolValidator])
      .readFrom([poolArtifacts.configUTxO])

      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .payToContract(
        poolAddress,
        {
          inline: Data.to(poolDatumMapped, PoolSpend.datum),
        },
        valueToRepay
      )
      .mintAssets(
        {
          [toUnit(
            poolDatumMapped.params.lpToken.policyId,
            poolDatumMapped.params.lpToken.assetName
          )]: BigInt(lpsToBurn) * -1n,
        },
        Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
      );

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
