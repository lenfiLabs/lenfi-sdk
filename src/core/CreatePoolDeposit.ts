import { Data, Lucid, Credential, toUnit, TxComplete } from "lucid-cardano";
import deployedValidatorsJson from "./../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "./../constants";
import {
  calculateReceivedLptokens,
  collectValidators,
  getOutputReference,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
} from "./../utils/helpers";
import { DeployedValidators } from "./../types";
import { LiquidityTokenLiquidityToken, PoolSpend } from "./../plutus";

export interface DepositParams {
  lucid: Lucid;
  balanceToDeposit: bigint;
  poolTokenName: string;
  lpValidatorTxHash?: string;
  lpValidatorTxOutput?: number;
}

export interface DepositResult {
  success: boolean;
  error?: string;
  tx?: TxComplete;
}

export async function createDeposit(
  params: DepositParams
): Promise<DepositResult> {
  const {
    lucid,
    balanceToDeposit,
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


    if (balanceToDeposit < poolConfigDatum.minTransition) {
      throw new Error("Protocol does not allow this small deposit");
    }

    const lpTokensToReceive: number = calculateReceivedLptokens(
      poolDatumMapped.balance,
      poolDatumMapped.lentOut,
      balanceToDeposit,
      poolDatumMapped.totalLpTokens
    );

    poolDatumMapped.balance =
      poolDatumMapped.balance + balanceToDeposit + poolConfigDatum.poolFee;
    poolDatumMapped.totalLpTokens =
      poolDatumMapped.totalLpTokens + BigInt(lpTokensToReceive);

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              LpAdjust: {
                valueDelta: balanceToDeposit,
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

    let metadata = {
      msg: ["Lenfi: DEPOSITED to pool."],
    };

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    const txBuilder = lucid
      .newTx()
      .readFrom([deployedValidators.poolValidator])
      .payToAddressWithData(
        poolAddress,
        { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.loanCs.policyId,
            poolDatumMapped.params.loanCs.assetName
          )]: poolDatumMapped.balance,
          [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(1),
        }
      )
      .readFrom([poolArtifacts.configUTxO])
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )

      .mintAssets(
        {
          [toUnit(
            poolDatumMapped.params.lpToken.policyId,
            poolDatumMapped.params.lpToken.assetName
          )]: BigInt(lpTokensToReceive),
        },
        Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
      )
      .attachMetadata(674, metadata);

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
