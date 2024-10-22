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

/**
 * Represents the parameters for configuring a token in the Lenfi protocol.
 */
export interface TokenParameters {
  /**
   * The asset class of the oracle NFT that is used for the price feeds and is locked in desired oracle script.
   */
  oracleNft: AssetClass;

  /**
   * The initial collateral ratio required for loans. (220% = 22_000_000)
   */
  initialCollateralRatio: bigint;

  /**
   * The threshold at which a loan becomes eligible for liquidation.
   */
  liquidationThreshold: bigint;

  /**
   * The fee charged during liquidation, expressed as a percentage.
   */
  liquidationFee: bigint;

  /**
   * The minimum fee that can be used with 'payFee' redeemer (withdraw stake rewards)
   */
  minFee: bigint;

  /**
   * The fee charged by the pool for any operations 
   */
  poolFee: bigint;

  /**
   * The minimum amount required for a transition (borrow, repay, deposit, withdraw).
   */
  minTransition: bigint;

  /**
   * The minimum amount that will be received within liquidation (as a liquidation fee)
   */
  minLiquidationAmount: bigint;

  /**
   * The fee charged for merging actions in the pool.
   */
  mergeActionFee: bigint;

  /**
   * The minimum amount that can be borrowed in a single loan.
   */
  minLoanAmount: bigint;
}

/**
 * Represents the parameters required to create a new Lenfi pool.
 */
export interface PoolParameters {
  /**
   * The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
   */
  lucid: Lucid;

  /**
   * The asset class of the token that can be borrowed from this pool.
   */
  loanAsset: AssetClass;

  /**
   * The asset class of the token that can be used as collateral in this pool.
   */
  collateralAsset: AssetClass;

  /**
   * The initial amount of tokens to deposit into the pool.
   */
  initialDepositAmount: bigint;

  /**
   * The Bech32 encoded address of the stake pool to delegate to.
   */
  delegationSpoBech: string;

  /**
   * The ID of the stake pool to delegate to.
   */
  delegationSpoId: string;

  /**
   * The parameters for configuring the loan token.
   */
  loanTokenParameters: TokenParameters;

  /**
   * The parameters for configuring the collateral token.
   */
  collateralTokenParameters: TokenParameters;
}

/**
 * Creates a new Lenfi pool with the specified parameters.
 * 
 * @param {PoolParameters} params - The parameters for creating a new pool.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain.
 * @param {AssetClass} params.loanAsset - The asset class of the token that can be borrowed from this pool.
 * @param {AssetClass} params.collateralAsset - The asset class of the token that can be used as collateral in this pool.
 * @param {bigint} params.initialDepositAmount - The initial amount of tokens to deposit into the pool.
 * @param {string} params.delegationSpoBech - The Bech32 encoded address of the stake pool to delegate to.
 * @param {string} params.delegationSpoId - The ID of the stake pool to delegate to.
 * @param {TokenParameters} params.loanTokenParameters - The parameters for configuring the loan token.
 * @param {TokenParameters} params.collateralTokenParameters - The parameters for configuring the collateral token.
 * 
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status and either the completed transaction or an error message.
 * 
 * @throws {Error} Throws an error if the pool creation process fails for any reason, such as insufficient funds or invalid parameters.
 */

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

    defaultConfig.initialCollateralRatio =
      collateralTokenParameters.initialCollateralRatio;
    defaultConfig.liquidationThreshold =
      collateralTokenParameters.liquidationThreshold;
    defaultConfig.minFee = loanTokenParameters.minFee;
    defaultConfig.poolFee = loanTokenParameters.poolFee;
    defaultConfig.minTransition = loanTokenParameters.minTransition;
    defaultConfig.mergeActionFee = loanTokenParameters.mergeActionFee;
    defaultConfig.minLoan = loanTokenParameters.minLoanAmount;
    defaultConfig.minLiquidationFee =
      collateralTokenParameters.minLiquidationAmount;

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
