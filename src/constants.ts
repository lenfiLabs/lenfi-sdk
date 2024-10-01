import { PoolConfigSpend } from "./plutus";

export const GOV_TOKEN_NAME =
  "2fa97a300e0b18e217f4a431676e746832a3b0e2103697a573332a6369e3d6a0";
export const MIN_ADA = 2000000n;

export const defaultConfig: PoolConfigSpend["datum"] = {
  liquidationThreshold: 2_000_000n,
  initialCollateralRatio: 2_100_000n,
  poolFee: 1_000_000n,
  mergeActionFee: 2_000_000n,
  minTransition: 50_000_000n,
  minLoan: 50_000_000n,
  minFee: 5_000_000n,
  minLiquidationFee: 3_000_000n,
  loanFeeDetails: {
    tier_1Fee: 200_000n,
    tier_1Threshold: 0n,
    tier_2Fee: 200_000n,
    tier_2Threshold: 150_000n,
    tier_3Fee: 200_000n,
    tier_3Threshold: 450_000n,
    liquidationFee: 50000n,
    platformFeeCollectorAddress: {
      paymentCredential: {
        VerificationKeyCredential: [
          "0c8b9cc1657e5139be7a331036c5499f0c2dc09fd8680e9773e4a01a",
        ],
      },
      stakeCredential: {
        Inline: [
          {
            VerificationKeyCredential: [
              "6e0defd3cf3a4307652e956b3ca65789ca5b7836ae5494ebc546ad8a",
            ],
          },
        ],
      },
    },
  },
  interestParams: {
    optimalUtilization: 450_000n,
    baseInterestRate: 30_000n,
    rslope1: 75_000n,
    rslope2: 3_000_000n,
  },
};
