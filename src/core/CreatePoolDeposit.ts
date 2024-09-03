import {
  Data,
  Lucid,
  Credential,
  toUnit,
  TxComplete,
  UTxO,
} from "lucid-cardano";
import deployedValidatorsJson from "./../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "./../constants";
import {
  calculateReceivedLptokens,
  collectValidators,
  getOutputReference,
  getPoolArtifacts,
  getValidityRange,
  parseValidators,
  toUnitOrLovelace,
} from "./../utils/helpers";
import { DeployedValidators, ValidityRange } from "./../types";
import { LiquidityTokenLiquidityToken, PoolSpend } from "./../plutus";

export interface DepositParams {
  lucid: Lucid;
  balanceToDeposit: bigint;
  poolTokenId: string;
  lpValidatorTxHash: string;
  lpValidatorTxOutput: number;
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
    poolTokenId,
    lpValidatorTxHash,
    lpValidatorTxOutput,
  } = params;

  try {
    const validityRange: ValidityRange = getValidityRange(lucid);
    const poolTokenName = poolTokenId.substring(56);

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
      .validFrom(validityRange.validFrom)
      .validTo(validityRange.validTo)
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

    const completedTx = await txBuilder.complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
