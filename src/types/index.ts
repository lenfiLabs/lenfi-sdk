import { PolicyId, TxComplete, UTxO } from "lucid-cardano";
import {
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  OrderContractRepayOrderContract,
} from "../plutus";
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

export type Asset = {
  policyId: string;
  assetName: string;
  amount: bigint;
};

export interface ValidityRange {
  validFrom: number;
  validTo: number;
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

export type OracelValidatorDetails = {
  nftReferenceUtxo: UTxO;
  rewardAddress: string;
  redeemer: OracleValidatorWithdrawValidate["redeemer"];
};

export type InterestParams = {
  optimalUtilization: bigint;
  baseInterestRate: bigint;
  rslope1: bigint;
  rslope2: bigint;
};

export interface ApiResponse {
  signature: string; // Adjust according to your actual API response structure
}

export interface FetchError {
  error: string;
  details: any;
}

export type OutputValue = { [key: string]: bigint };

export interface BuilderResponse {
  success: boolean;
  error?: string;
  tx?: TxComplete;
}

export type BatcherOutput = {
  receiverAddress: string;
  datum:
    | {
        inline: string; // datum is an object with an 'inline' property, which is a string
      }
    | "";
  value: OutputValue;
};

type AssetName = string;
type Amount = bigint;

export function getValueFromMapBorrow(
  batcherDatum:
    | OrderContractBorrowOrderContract["datum"]
    | OrderContractRepayOrderContract["datum"],
  targetPolicyId: PolicyId,
  targetAssetName: AssetName
): bigint | null {
  const valueMap: Map<PolicyId, Map<AssetName, Amount>> | undefined =
    batcherDatum?.order?.expectedOutput?.value;

  if (!valueMap) {
    return null;
  }

  for (const [policyId, assetMap] of valueMap.entries()) {
    if (policyId === targetPolicyId) {
      for (const [assetName, amount] of assetMap.entries()) {
        if (assetName === targetAssetName) {
          // Returns the first found amount that matches policyId and assetName.
          return amount;
        }
      }
    }
  }

  return null;
}
