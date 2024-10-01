import { Data, Lucid, toUnit, stakeCredentialOf } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { defaultConfig, GOV_TOKEN_NAME } from "../constants";
import {
  collectValidators,
  nameFromUTxO,
  OutputReference,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import { AssetClass, BuilderResponse, DeployedValidators } from "../types";
import {
  LiquidityTokenLiquidityToken,
  PlaceholderNftPlaceholderNft,
  PoolConfigSpend,
  PoolMint,
  PoolSpend,
  PoolStakePoolStake,
} from "../plutus";

export interface TokenParameters {
  oracleNft: AssetClass;
  initialCollateralRatio: number;
  liquidationThreshold: number;
  liquidationFee: number;
  minFee: number;
  poolFee: number;
  minTransition: number;
  minLiquidationAmount: number;
  mergeActionFee: number;
  minLoanAmount: number;
  tokenId: string;
}

export interface PoolParameters {
  lucid: Lucid;
  loanAsset: AssetClass;
  collateralAsset: AssetClass;
  initialDepositAmount: bigint;
  delegationSpoBech: string;
  delegationSpoId: string;
  loanTokenParameters: TokenParameters;
  collateralTokenParameters: TokenParameters;
}

export async function createPool(
  params: PoolParameters
): Promise<BuilderResponse> {
  const {
    lucid,
    loanAsset,
    collateralAsset,
    initialDepositAmount,
    delegationSpoBech,
    delegationSpoId,
    loanTokenParameters,
    collateralTokenParameters,
  } = params;

  try {
    const walletUtxos = await lucid.wallet.getUtxos();
    const utxoToConsume = walletUtxos[walletUtxos.length - 1];

    const configNftName = nameFromUTxO(utxoToConsume);
    const initialOutputRef: OutputReference = {
      transactionId: { hash: utxoToConsume.txHash },
      outputIndex: BigInt(utxoToConsume.outputIndex),
    };
    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    const initValidators = collectValidators(lucid, "", GOV_TOKEN_NAME);

    const stakingValidator = new PoolStakePoolStake(
      initValidators.poolScriptHash,
      {
        policyId: initValidators.delegatorNftPolicyId,
        assetName: configNftName,
      },
      initialOutputRef
    );
    const stakeKeyHash = lucid.utils.validatorToScriptHash(stakingValidator);
    const poolTokenName = stakeKeyHash;

    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);

    const rewardsAddress =
      lucid.utils.validatorToRewardAddress(stakingValidator);

    const lpTokenPolicy = new LiquidityTokenLiquidityToken(
      validators.poolScriptHash,
      poolTokenName
    );
    const lpTokenPolicyId = lucid.utils.validatorToScriptHash(lpTokenPolicy);

    const poolDatum: PoolSpend["datum"] = {
      params: {
        collateralAddress: {
          paymentCredential: {
            ScriptCredential: [validators.collateralValidatorHash],
          },
          stakeCredential: {
            Inline: [
              {
                ScriptCredential: [stakeKeyHash],
              },
            ],
          },
        },
        loanCs: loanAsset,
        collateralCs: collateralAsset,
        oracleCollateralAsset: collateralTokenParameters.oracleNft,
        oracleLoanAsset: loanTokenParameters.oracleNft,
        lpToken: {
          policyId: lpTokenPolicyId,
          assetName: poolTokenName,
        },
        poolNftName: poolTokenName,
        poolConfigAssetname: configNftName,
      },
      balance: BigInt(initialDepositAmount),
      lentOut: BigInt(0),
      totalLpTokens: BigInt(initialDepositAmount), // Minting same amount of LP tokens as deposit amount
    };

    const delegatorNftRedeemer: PlaceholderNftPlaceholderNft["r"] = {
      action: {
        MintNFT: [
          {
            transactionId: {
              hash: utxoToConsume.txHash,
            },
            outputIndex: BigInt(utxoToConsume.outputIndex),
          },
          0n,
        ],
      },
      inner: undefined,
    };

    const poolNftRedeemer: PoolMint["redeemer"] = {
      MintPoolNFT: [
        {
          outputIndex: 0n,
          initialPoolDelegation: delegationSpoId,
        },
      ],
    };

    const lpTokenRedeemer: LiquidityTokenLiquidityToken["redeemer"] = {
      CreatePool: {
        producedOutput: 0n,
      },
    };

    const withdrawRedeemer: PoolStakePoolStake["redeemer"] = {
      CreatePool: [
        {
          transactionId: { hash: utxoToConsume.txHash },
          outputIndex: BigInt(utxoToConsume.outputIndex),
        },
      ],
    };

    const poolContractAddress = lucid.utils.validatorToAddress(
      validators.poolValidator,
      stakeCredentialOf(rewardsAddress)
    );

    const poolConfigValidatorAddress = lucid.utils.validatorToAddress(
      validators.poolConfigValidator
    );

    const lpUnit = toUnit(lpTokenPolicyId, poolTokenName);
    const poolNft = toUnit(validators.poolScriptHash, poolTokenName);
    const delegatorNft = toUnit(validators.delegatorNftPolicyId, configNftName);
    const configNft = toUnit(validators.poolConfigPolicyId, configNftName);

    defaultConfig.initialCollateralRatio = BigInt(
      collateralTokenParameters.initialCollateralRatio
    );
    defaultConfig.liquidationThreshold = BigInt(
      collateralTokenParameters.liquidationThreshold
    );
    defaultConfig.minFee = BigInt(loanTokenParameters.minFee);
    defaultConfig.poolFee = BigInt(loanTokenParameters.poolFee);
    defaultConfig.minTransition = BigInt(loanTokenParameters.minTransition);
    defaultConfig.mergeActionFee = BigInt(loanTokenParameters.mergeActionFee);
    defaultConfig.minLoan = BigInt(loanTokenParameters.minLoanAmount);
    defaultConfig.minLiquidationFee = BigInt(
      collateralTokenParameters.minLiquidationAmount
    );

    // Which ever liquidation fee is higher is applied to the pool
    if (
      collateralTokenParameters.liquidationFee >
      loanTokenParameters.liquidationFee
    ) {
      defaultConfig.loanFeeDetails.liquidationFee = BigInt(
        collateralTokenParameters.liquidationFee
      );
    } else {
      defaultConfig.loanFeeDetails.liquidationFee = BigInt(
        loanTokenParameters.liquidationFee
      );
    }

    // If Deposit token is ADA set new pool rates
    if (loanAsset.policyId === "") {
      defaultConfig.interestParams.baseInterestRate = 60_000n;
      defaultConfig.interestParams.optimalUtilization = 650_000n;
      defaultConfig.interestParams.rslope1 = 200_000n;
      defaultConfig.interestParams.rslope2 = 1_000_000n;
    } else {
      defaultConfig.interestParams.baseInterestRate = 30_000n;
      defaultConfig.interestParams.optimalUtilization = 450_000n;
      defaultConfig.interestParams.rslope1 = 75_000n;
      defaultConfig.interestParams.rslope2 = 3_000_000n;
    }

    const completedTx = await lucid
      .newTx()
      .collectFrom([utxoToConsume])
      .readFrom([deployedValidators.poolValidator])
      .mintAssets(
        {
          [poolNft]: BigInt(1),
        },
        Data.to(poolNftRedeemer, PoolMint["redeemer"])
      )
      .payToAddressWithData(
        poolContractAddress,
        { inline: Data.to(poolDatum, PoolSpend.datum) },
        {
          [toUnitOrLovelace(loanAsset.policyId, loanAsset.assetName)]:
            initialDepositAmount,
          [poolNft]: BigInt(1),
        }
      )
      .attachMintingPolicy(lpTokenPolicy)
      .mintAssets(
        {
          [lpUnit]: initialDepositAmount,
        },
        Data.to(lpTokenRedeemer, LiquidityTokenLiquidityToken.redeemer)
      )
      .readFrom([deployedValidators.delegatorNftPolicy])
      .mintAssets(
        {
          [delegatorNft]: BigInt(1),
        },
        Data.to(delegatorNftRedeemer, PlaceholderNftPlaceholderNft.r)
      )
      .readFrom([deployedValidators.poolConfigPolicy])
      .mintAssets(
        {
          [configNft]: BigInt(1),
        },
        Data.to(delegatorNftRedeemer, PlaceholderNftPlaceholderNft.r)
      )
      .payToAddressWithData(
        poolConfigValidatorAddress,
        { inline: Data.to(defaultConfig, PoolConfigSpend.datum) },
        {
          [configNft]: 1n,
        }
      )
      .registerStake(rewardsAddress)
      .delegateTo(
        rewardsAddress,
        delegationSpoBech,
        Data.to(withdrawRedeemer, PoolStakePoolStake.redeemer)
      )
      .attachCertificateValidator(stakingValidator)
      .complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
