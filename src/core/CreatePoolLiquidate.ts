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
  assetGainAdaSale,
  calculateInterestAmount,
  collectOracleDetails,
  collectValidators,
  generateReceiverAddress,
  getAdaAmountIfBought,
  getAdaAmountIfSold,
  getOutputReference,
  getPlatformFee,
  getPoolArtifacts,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import {
  BuilderResponse,
  DeployedValidators,
  OracelValidatorDetails,
  PriceFeed,
  TokenPrice,
  ValidityRange,
} from "../types";
import {
  CollateralMint,
  CollateralSpend,
  LeftoversLeftovers,
  OracleValidatorWithdrawValidate,
  PoolSpend,
} from "../plutus";
import BigNumber from "bignumber.js";

export interface LiquidateParams {
  lucid: Lucid;
  validityRange: ValidityRange;
  poolTokenName: string;
  loanTxHash: string;
  loanTxOutputIndex: number;
  collateralTokenPrice: TokenPrice | undefined;
  loanTokenPrice: TokenPrice | undefined;
}

export async function createLiquidation(
  params: LiquidateParams
): Promise<BuilderResponse> {
  const {
    lucid,
    validityRange,
    poolTokenName,
    loanTxHash,
    loanTxOutputIndex,
    collateralTokenPrice,
    loanTokenPrice,
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

    const utxoToConsumeCollateral: UTxO[] = await lucid.utxosByOutRef([
      {
        txHash: loanTxHash,
        outputIndex: loanTxOutputIndex,
      },
    ]);

    const collateralDatumMapped: CollateralSpend["datum"] = await lucid.datumOf(
      utxoToConsumeCollateral[0],
      CollateralSpend.datum
    );

    const accumulatedInterest = calculateInterestAmount(
      collateralDatumMapped.interestRate,
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.depositTime,
      validityRange.validTo
    );

    const loanPlusInterest =
      accumulatedInterest + collateralDatumMapped.loanAmount;

    poolDatumMapped.balance =
      poolDatumMapped.balance +
      loanPlusInterest +
      poolArtifacts.poolConfigDatum.poolFee;
    poolDatumMapped.lentOut =
      poolDatumMapped.lentOut - collateralDatumMapped.loanAmount;

    const collateralRedeemer: CollateralSpend["redeemer"] = {
      wrapper: {
        action: { CollateralLiquidate: [0n] },
        interest: accumulatedInterest,
        mergeType: {
          ImmediateWithPool: [getOutputReference(poolArtifacts.poolUTxO)],
        },
      },
    };

    let debtValueInAda = collateralDatumMapped.loanAmount + accumulatedInterest;

    let oracleDetails: OracelValidatorDetails[] = [];

    let loanTokenPriceFeed: PriceFeed = {
      Pooled: [
        {
          token: {
            policyId: poolDatumMapped.params.loanCs.policyId,
            assetName: poolDatumMapped.params.loanCs.assetName,
          },
          tokenAAmount: BigInt(loanTokenPrice?.amount_in_exchange || 0),
          tokenBAmount: BigInt(loanTokenPrice?.lovelaces || 0),
          validTo: BigInt(validityRange.validTo),
        },
      ],
    };

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

    let collateralTokenPriceFeed: PriceFeed = {
      Pooled: [
        {
          token: {
            policyId: poolDatumMapped.params.collateralCs.policyId,
            assetName: poolDatumMapped.params.collateralCs.assetName,
          },
          tokenAAmount: BigInt(collateralTokenPrice?.amount_in_exchange || 0),
          tokenBAmount: BigInt(collateralTokenPrice?.lovelaces || 0),
          validTo: BigInt(validityRange.validTo),
        },
      ],
    };

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

    if (poolDatumMapped.params.loanCs.policyId !== "") {
      // Loan is non-ADA so oracle will have first item.
      debtValueInAda = getAdaAmountIfBought(
        poolDatumMapped.params.loanCs.policyId,
        poolDatumMapped.params.loanCs.assetName,
        loanTokenPriceFeed,
        collateralDatumMapped.loanAmount + accumulatedInterest
      );
    }

    let collateralValueInAda = collateralDatumMapped.collateralAmount;

    if (poolDatumMapped.params.collateralCs.policyId !== "") {
      // Only collateral is non ADA
      collateralValueInAda = getAdaAmountIfSold(
        poolDatumMapped.params.collateralCs.policyId,
        poolDatumMapped.params.collateralCs.assetName,
        collateralTokenPriceFeed,
        collateralDatumMapped.collateralAmount
      );
    }

    // This is amount of remaining collateral liquidator can take
    const feePercentage = new BigNumber(
      Number(collateralDatumMapped.poolConfig.loanFeeDetails.liquidationFee)
    );

    let feeAmount =
      Math.floor(
        new BigNumber(Number(collateralValueInAda))
          .minus(Number(debtValueInAda))
          .multipliedBy(feePercentage)
          .dividedBy(1000000)
          .toNumber()
      ) + 1;

    if (feeAmount < collateralDatumMapped.poolConfig.minLiquidationFee) {
      feeAmount = Number(collateralDatumMapped.poolConfig.minLiquidationFee);
    }

    const remainingCollateralValue = new BigNumber(Number(collateralValueInAda))
      .minus(Number(debtValueInAda))
      .minus(feeAmount);

    let remaminingValueInCollateral = new BigNumber(0);

    if (collateralDatumMapped.collateralCs.policyId === "") {
      remaminingValueInCollateral = remainingCollateralValue;
    } else {
      remaminingValueInCollateral = new BigNumber(
        Number(
          assetGainAdaSale(
            collateralTokenPriceFeed,
            BigInt(Math.ceil(Number(remainingCollateralValue.toNumber()))),
            collateralDatumMapped.collateralCs.policyId,
            collateralDatumMapped.collateralCs.assetName
          )
        ) + 10
      );
    }

    const healthFactor = new BigNumber(Number(collateralValueInAda))
      .multipliedBy(1000000)
      .dividedBy(Number(debtValueInAda))
      .dividedBy(Number(collateralDatumMapped.poolConfig.liquidationThreshold));

    let payToAddresOutout = 0n;
    let txBuilder = lucid.newTx();
    if (remaminingValueInCollateral.gt(0) && healthFactor.lt(1)) {
      const leftoverAddress = lucid.utils.validatorToAddress(
        validators.leftoverValidator,
        stakeCredential
      );

      const liquidationDatum: LeftoversLeftovers["datum"] = {
        policyId: validators.collateralValidatorHash,
        assetName: collateralDatumMapped.borrowerTn,
      };

      // Compensate borrower remaining collateral
      txBuilder.payToContract(
        leftoverAddress,
        {
          inline: Data.to(liquidationDatum, LeftoversLeftovers.datum),
        },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.collateralCs.policyId,
            poolDatumMapped.params.collateralCs.assetName
          )]: BigInt(Math.ceil(Number(remaminingValueInCollateral.toNumber()))),
        }
      );

      payToAddresOutout += 1n;
    }

    const poolRedeemer: PoolSpend["redeemer"] = {
      wrapper: {
        action: {
          Continuing: [
            {
              CloseLoan: {
                loanAmount: collateralDatumMapped.loanAmount,
                repayAmount: loanPlusInterest,
                continuingOutput: payToAddresOutout,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: null,
      },
    };

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    txBuilder
      .readFrom([deployedValidators.poolValidator])
      .readFrom([poolArtifacts.configUTxO])
      .collectFrom(
        [poolArtifacts.poolUTxO],
        Data.to(poolRedeemer, PoolSpend.redeemer)
      )
      .readFrom([deployedValidators.collateralValidator])
      .collectFrom(
        [utxoToConsumeCollateral[0]],
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
          [toUnit(validators.poolScriptHash, poolTokenName)]: BigInt(1),
        }
      )
      .validFrom(validityRange.validFrom)
      .validTo(validityRange.validTo);

    oracleDetails.forEach(async (oracle) => {
      txBuilder
        .withdraw(
          oracle.rewardAddress,
          0n,
          Data.to(oracle.redeemer, OracleValidatorWithdrawValidate.redeemer)
        )
        .readFrom([oracle.nftReferenceUtxo]);
    });

    const platformFee = getPlatformFee(
      collateralDatumMapped.loanAmount,
      collateralDatumMapped.balance,
      collateralDatumMapped.lentOut,
      collateralDatumMapped.poolConfig.loanFeeDetails
    );

    if (platformFee > 0n) {
      const datum = Data.to(collateralDatumMapped.borrowerTn);

      let feeAmount = (accumulatedInterest * platformFee) / 1000000n;

      const fee_receiver_address = generateReceiverAddress(
        lucid,
        poolArtifacts.poolConfigDatum.loanFeeDetails.platformFeeCollectorAddress
      );

      txBuilder.payToContract(
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

    const completedTx = await txBuilder.complete();

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
