import BigNumber from "bignumber.js";
import { UTxO } from "lucid-cardano";
import { OracleValidatorWithdrawValidate, PoolSpend } from "../plutus";
import { collectValidators } from "./../utils/helpers";
export interface TokenPrice {
  accepted_as_collateral: boolean;
  accepted_as_loan: boolean;
  amount_in_exchange: number;
  decimals: string;
  initial_collateral_ratio: number;
  liquidation_threshold: number;
  lovelaces: number;
  token_id: string;
  token_name: string;
  token_nice_name: string;
  token_policy: string;
}
export interface PoolDatum {
  collateralValidatorHash: string;
  collateralStakeHash: string;
  loanTokenPolicy: string;
  loanTokenName: string;
  collateralTokenPolicy: string;
  collateralTokenName: string;
  balance: bigint;
  lentOut: bigint;
  collateralOraclePolicy: string;
  collateralOracleName: string;
  loanOraclePolicy: string;
  loanOracleName: string;
  totalLPTokens: bigint;
  lpTokenPolicy: string;
  lpTokenName: string;
  poolTokenName: string;
  liquidationThreshold: bigint;
}

export interface AssetClass {
  policyId: string;
  assetName: string;
}
interface BatcherDatumResultBase {
  batcherType: number;
  isError: boolean;
}

export type BatcherDatumResult =
  | (BatcherDatumCommon & BatcherDatumResultBase)
  | (BatcherDatumBorrower & BatcherDatumResultBase)
  | (BatcherDatumError & BatcherDatumResultBase);

export type BatcherDatumError = {
  error: string;
};

export type BatcherDatumCommon = {
  creatorPubKeyHash: string;
  creatorStakeKeyHash?: string;
  poolNftPolicy: string;
  poolNftName: string;
  lpTokenPolicy: string;
  lpTokenName: string;
  minLpTokensToReceive: number;
  batcherFee: number;
  depositAda: number;
};

export type BatcherDatumBorrower = {
  creatorPubKeyHash: string;
  creatorStakeKeyHash?: string;
  poolNftPolicy: string;
  poolNftName: string;
  toReceivePolicy: string;
  toReceiveName: string;
  toReceiveMinAmount: number;
  collateralAssetPolicy: string;
  collateralAssetName: string;
  collateralAmount: number;
  maxInterestRate: number;
  batcherFee: number;
  depositAda: number;
};
export type DeployedValidators = Record<string, UTxO>;
export type AssetData = {
  txHash: string;
  outputIndex: number;
  assets: {
    [key: string]: bigint;
  };
  address: string;
  datumHash: string | undefined;
  datum: string;
  scriptRef: any;
};

export interface LpTokenCalculation {
  depositAmount: bigint;
  lpTokenMintAmount: bigint;
}

export type Asset = {
  policyId: string;
  assetName: string;
  amount: bigint;
};

export interface WithdrawDetails {
  withdrawAmount: number;
  lpTokenBurnAmount: number;
}

export interface poolDetails {
  currentBalance: BigNumber;
  alreadyLend: BigNumber;
  lpTokens: BigNumber;
}

export interface ExtractedCollateralDatum {
  poolNftName: string;
  loanTokenPolicy: string;
  loanTokenName: string;
  loanAmount: number;
  collateralTokenPolicy: string;
  collateralTokenName: string;
  collateralAmount: number;
  interestRate: number;
  loanStartTs: number;
  borrowerTokenName: string;
  collateralOraclePolicy: string;
  collateralOracleName: string;
  loanOraclePolicy: string;
  kiabsOracleName: string;
  isError: boolean;
  error?: string;
}

export interface ValidityRange {
  validFrom: number;
  validTo: number;
}

export interface TxObject {
  txHash: string;
  outputIndex: number;
  assets: { lovelace: bigint };
  address: string;
  datumHash: string | undefined;
  datum: string;
  scriptRef: string | null;
}

export interface TokenData {
  accepted_as_collateral: boolean;
  accepted_as_loan: boolean;
  decimals: number;
  liquidation_threshold: number;
  initial_collateral_ratio: number;
  oracle_nft_id: string;
  token_id: string;
  token_nice_name: string;
  token_policy: string;
  token_name: string;
}
export interface TokenParameters {
  oracleNft: string;
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

export interface OracleDatum {
  poolNftPolicyId: string;
  poolNftName: string;
  oracleNftPolicyId: string;
  oracleNftName: string;
  tokenaAPolicyId: string;
  tokenaAName: string;
  tokenaBPolicyId: string;
  tokenaBName: string;
  tokenAAmount: number;
  tokenBAmount: number;
  expirationTime: number;
}
export type Validators = ReturnType<typeof collectValidators>;

export type PriceFeed =
  | {
      Aggregated: [
        {
          token: { policyId: string; assetName: string };
          tokenPriceInLovelaces: bigint;
          denominator: bigint;
          validTo: bigint;
        }
      ];
    }
  | {
      Pooled: [
        {
          token: { policyId: string; assetName: string };
          tokenAAmount: bigint;
          tokenBAmount: bigint;
          validTo: bigint;
        }
      ];
    };

export type aadaNftAction = "MintR" | "BurnR";

export type StakeCredential =
  | {
      Inline: [
        | { VerificationKeyCredential: [string] }
        | {
            ScriptCredential: [string];
          }
      ];
    }
  | {
      Pointer: {
        slotNumber: bigint;
        transactionIndex: bigint;
        certificateIndex: bigint;
      };
    }
  | null;

export type DatumValue = {
  utxo: string;
};

export type asset = {
  policyId: string;
  assetName: string;
  amount: number;
};

export type AggregatedAssets = Map<string, Map<string, bigint>>;

export interface PoolArtifacts {
  poolUtxoToConsume: UTxO;
  paramsUtxoHash: string;
  paramsUtxoIndex: number;
  poolDatumMapped: PoolSpend["datum"];
}

export type OracelValidatorDetails = {
  nftReferenceUtxo: UTxO;
  rewardAddress: string;
  redeemer: OracleValidatorWithdrawValidate["redeemer"];
};
