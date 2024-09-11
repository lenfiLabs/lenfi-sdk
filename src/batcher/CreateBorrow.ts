import { Address, Data, Lucid, getAddressDetails } from "lucid-cardano";
import { GOV_TOKEN_NAME, MIN_ADA } from "../constants";
import {
  calculateLpsToBurn,
  collectValidators,
  constructValueWithMinAda,
  getInterestRates,
  getPoolArtifacts,
  toUnitOrLovelace,
  addAssets,
  getWalletStakeCredentials,
} from "../utils/helpers";
import {
  BuilderResponse,
  OutputValue,
  TokenPrice,
  ValidityRange,
} from "../types";
import { OrderContractBorrowOrderContract } from "../plutus";

export interface BatcherBorrowParams {
  lucid: Lucid;
  poolTokenName: string;
  validityRange: ValidityRange;
  loanAmount: bigint;
  collateralAmount: bigint;
  collateralTokenPrice: TokenPrice | undefined;
  loanTokenPrice: TokenPrice | undefined;
}

export async function createBatcherBorrow(
  params: BatcherBorrowParams
): Promise<BuilderResponse> {
  const {
    lucid,
    poolTokenName,
    validityRange,
    loanAmount,
    collateralAmount,
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
    const batcherAddress: Address = lucid.utils.validatorToAddress(
      validators.orderContractBorrow
    );

    const poolDatumMapped = poolArtifacts.poolDatumMapped;

    let maxInterestRate = getInterestRates(
      poolArtifacts.poolConfigDatum.interestParams,
      loanAmount,
      poolDatumMapped.lentOut,
      poolDatumMapped.balance
    );

    const walletAddress = await lucid.wallet.address();
    const walletDetails = getAddressDetails(walletAddress);

    const walletStakeCredentials = getWalletStakeCredentials(walletDetails);

    const expectedOutput = new Map([
      [
        poolArtifacts.poolDatumMapped.params.loanCs.policyId,
        new Map([
          [
            poolArtifacts.poolDatumMapped.params.loanCs.assetName,
            BigInt(loanAmount),
          ],
        ]),
      ],
    ]);

    const batcherDatum: OrderContractBorrowOrderContract["datum"] = {
      controlCredential: {
        VerificationKeyCredential: [walletDetails.paymentCredential!.hash],
      },
      poolNftCs: {
        policyId: validators.poolScriptHash,
        assetName: poolTokenName,
      },
      batcherFeeAda: 2000000n,
      order: {
        expectedOutput: {
          address: {
            paymentCredential: {
              VerificationKeyCredential: [
                walletDetails.paymentCredential!.hash,
              ],
            },
            stakeCredential: walletStakeCredentials,
          },
          value: constructValueWithMinAda(expectedOutput),
          datum: "NoDatum",
          referenceScript: null,
        },
        partialOutput: {
          address: {
            paymentCredential: {
              VerificationKeyCredential: [
                walletDetails.paymentCredential!.hash,
              ],
            },
            stakeCredential: walletStakeCredentials,
          },
          value: new Map([["", new Map([["", MIN_ADA]])]]),
          datum: "NoDatum",
        },
        borrowerNftPolicy: validators.collateralValidatorHash,
        minCollateralAmount: collateralAmount,
        minDepositTime: BigInt(validityRange.validFrom),
        maxInterestRate: maxInterestRate,
        collateralAddress: poolDatumMapped.params.collateralAddress,
      },
    };

    const depositValue = {
      [toUnitOrLovelace(
        poolDatumMapped.params.collateralCs.policyId,
        poolDatumMapped.params.collateralCs.assetName
      )]: BigInt(collateralAmount),
    };

    let batcherDeposit = 4_000_000n;
    if (poolDatumMapped.params.collateralCs.policyId !== "") {
      batcherDeposit = 7_500_000n; // Increasing batcher deposit to handle native tokens (as they must come back in 2 outputs)
    }
    let valueSendToBatcher: OutputValue = { lovelace: batcherDeposit };

    valueSendToBatcher = addAssets(valueSendToBatcher, depositValue);

    if (poolArtifacts.poolConfigDatum.poolFee > 0n) {
      const poolFee = {
        [toUnitOrLovelace(
          poolDatumMapped.params.loanCs.policyId,
          poolDatumMapped.params.loanCs.assetName
        )]: BigInt(poolArtifacts.poolConfigDatum.poolFee),
      };
      valueSendToBatcher = addAssets(valueSendToBatcher, poolFee);
    }

    let tx = lucid.newTx().payToContract(
      batcherAddress,
      {
        inline: Data.to(batcherDatum, OrderContractBorrowOrderContract.datum),
      },
      valueSendToBatcher
    );

    if (loanTokenPrice?.token_name !== "ADA") {
      let priceDataLoan = {
        a: loanTokenPrice?.amount_in_exchange,
        l: loanTokenPrice?.lovelaces,
      };
      tx = tx.attachMetadata(404, priceDataLoan);
    }
    if (collateralTokenPrice?.token_name !== "ADA") {
      let priceDataCollateral = {
        a: collateralTokenPrice?.amount_in_exchange,
        l: collateralTokenPrice?.lovelaces,
      };
      tx = tx.attachMetadata(405, priceDataCollateral);
    }

    const completedTx = await tx.complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
