import { Data, Lucid, toUnit, Credential } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  collectValidators,
  getOutputReference,
  getPoolArtifacts,
  parseValidators,
} from "../utils/helpers";
import { BuilderResponse, DeployedValidators } from "../types";
import {
  LiquidityTokenLiquidityToken,
  PlaceholderNftPlaceholderNft,
  PoolMint,
  PoolSpend,
  PoolStakePoolStake,
} from "../plutus";

export interface DeleteParameters {
  lucid: Lucid;
  poolTokenName: string;
  lpValidatorTxHash: string;
  lpValidatorTxOutput: number;
  stakeValidatorTxHash: string;
  stakeValidatorTxOutput: number;
}

export async function deletePool(
  params: DeleteParameters
): Promise<BuilderResponse> {
  const {
    lucid,
    poolTokenName,
    lpValidatorTxHash,
    lpValidatorTxOutput,
    stakeValidatorTxHash,
    stakeValidatorTxOutput,
  } = params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);
    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );
    const poolArtifacts = await getPoolArtifacts(
      poolTokenName,
      validators,
      lucid
    );
    const poolDatumMapped = poolArtifacts.poolDatumMapped;
    const lpTokensToWithdraw = Number(poolDatumMapped.totalLpTokens);

    const poolOwnerUTxO = await lucid.provider.getUtxoByUnit(
      toUnit(
        validators.delegatorNftPolicyId,
        poolDatumMapped.params.poolConfigAssetname
      )
    );

    const delegateRedeemer: PoolStakePoolStake["redeemer"] = {
      Publish: [
        {
          poolOwnerOref: getOutputReference(poolOwnerUTxO),
        },
      ],
    };

    const stakeCredentials: Credential = {
      type: "Script",
      hash: poolTokenName,
    };

    const rewardAddress =
      lucid.utils.credentialToRewardAddress(stakeCredentials);

    const stakeAddressDetails = await lucid.provider.getDelegation(
      rewardAddress
    );
    const rewardsAmountInADA = stakeAddressDetails
      ? BigInt(stakeAddressDetails.rewards)
      : 0n;

    // Withdraw redeemer
    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: "Destroy",
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: null,
      },
    };

    const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
      DestroyPool: {
        poolOref: getOutputReference(poolArtifacts.poolUTxO),
      },
    };

    const poolNftRedeemer: PoolMint["redeemer"] = {
      BurnPoolNFT: [poolTokenName],
    };

    const delegatorNftRedeemer: PlaceholderNftPlaceholderNft["r"] = {
      action: {
        BurnNFT: [poolDatumMapped.params.poolConfigAssetname],
      },
      inner: undefined,
    };

    const validatorsUtxos = await lucid.utxosByOutRef([
      {
        txHash: lpValidatorTxHash,
        outputIndex: Number(lpValidatorTxOutput),
      },
      {
        txHash: stakeValidatorTxHash,
        outputIndex: Number(stakeValidatorTxOutput),
      },
    ]);

    const referenceScriptUtxo =
      [
        deployedValidators["poolValidator"],
        deployedValidators["delegatorNftPolicy"],
        deployedValidators["poolConfigPolicy"],
        deployedValidators["leftoverValidator"],
        poolArtifacts.configUTxO,
      ] || validatorsUtxos;

    const txBuilder = lucid
      .newTx()
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .readFrom(referenceScriptUtxo)
      .collectFrom(validatorsUtxos, Data.void())
      .mintAssets(
        {
          [toUnit(
            poolDatumMapped.params.lpToken.policyId,
            poolDatumMapped.params.lpToken.assetName
          )]: BigInt(lpTokensToWithdraw) * -1n,
        },
        Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
      )
      .mintAssets(
        {
          [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(-1),
        },
        Data.to(poolNftRedeemer, PoolMint.redeemer)
      )
      .mintAssets(
        {
          [toUnit(
            validators.delegatorNftPolicyId,
            poolDatumMapped.params.poolConfigAssetname
          )]: BigInt(-1),
        },
        Data.to(delegatorNftRedeemer, PlaceholderNftPlaceholderNft.r)
      );

    if (!(rewardsAmountInADA > 0n)) {
      txBuilder.deregisterStake(
        rewardAddress,
        Data.to(delegateRedeemer, PoolStakePoolStake.redeemer)
      );
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
