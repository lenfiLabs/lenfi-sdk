import { Data, Lucid, Credential, toUnit, TxComplete } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { GOV_TOKEN_NAME } from "../constants";
import {
  collectOracleDetails,
  collectValidators,
  getInterestRates,
  getOutputReference,
  getPoolArtifacts,
  nameFromUTxO,
  parseValidators,
  toUnitOrLovelace,
} from "../utils/helpers";
import {
  BuilderResponse,
  DeployedValidators,
  OracelValidatorDetails,
  TokenPrice,
  ValidityRange,
} from "../types";
import {
  CollateralMint,
  CollateralSpend,
  OracleValidatorWithdrawValidate,
  PoolSpend,
} from "../plutus";

export interface BorrowParams {
  lucid: Lucid;
  validityRange: ValidityRange;
  loanAmount: bigint;
  collateralAmount: bigint;
  poolTokenName: string;
  collateralTokenPrice: TokenPrice | undefined;
  loanTokenPrice: TokenPrice | undefined;
}


export async function createLoan(params: BorrowParams): Promise<BuilderResponse> {
  const {
    lucid,
    loanAmount,
    validityRange,
    collateralAmount,
    poolTokenName,
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
    const collateralAddress = lucid.utils.validatorToAddress(
      validators.collateralValidator,
      stakeCredential
    );

    const poolDatumMapped = poolArtifacts.poolDatumMapped;
    const poolConfigDatum = poolArtifacts.poolConfigDatum;

    if (loanAmount < poolConfigDatum.minLoan) {
      throw new Error("Protocol does not allow this small loan amount");
    }

    let interestRate = getInterestRates(
      poolConfigDatum.interestParams,
      loanAmount,
      poolDatumMapped.lentOut,
      poolDatumMapped.balance
    );

    poolDatumMapped.balance =
      poolDatumMapped.balance - loanAmount + poolConfigDatum.poolFee;
    poolDatumMapped.lentOut = poolDatumMapped.lentOut + loanAmount;

    const borrowerTokenName = nameFromUTxO(poolArtifacts.poolUTxO);
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
                continuingOutput: 0n,
              },
            },
          ],
        },
        configRef: getOutputReference(poolArtifacts.configUTxO),
        order: null,
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

    const collateralData: CollateralSpend["datum"] = {
      poolNftName: poolDatumMapped.params.poolNftName,
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
      tag: null,
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

    const valueToSendToPool = {
      [toUnit(validators.poolScriptHash, poolTokenName)]: 1n,
    };

    if (poolDatumMapped.balance > 0n) {
      valueToSendToPool[
        toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )
      ] = poolDatumMapped.balance;
    }

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
      .payToContract(
        poolAddress,
        { inline: Data.to(poolDatumMapped, PoolSpend.datum) },
        valueToSendToPool
      )
      .payToContract(
        collateralAddress,
        { inline: Data.to(collateralData, CollateralSpend.datum) },
        {
          [toUnitOrLovelace(
            poolDatumMapped.params.collateralCs.policyId,
            poolDatumMapped.params.collateralCs.assetName
          )]: BigInt(collateralAmount),
        }
      )
      .readFrom([deployedValidators.collateralValidator])
      .mintAssets(
        {
          [toUnit(validators.collateralValidatorHash, borrowerTokenName)]: 1n,
        },
        Data.to(borrowerTokenRedeemer, CollateralMint.redeemer)
      )
      .readFrom([poolArtifacts.configUTxO])
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

    const completedTx = await txBuilder.complete();

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
