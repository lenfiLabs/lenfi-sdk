import {
  Data,
  Lucid,
  C,
  PolicyId,
  toUnit,
  UTxO,
  toHex,
  fromHex,
  Unit,
  networkToId,
} from "lucid-cardano";

import {
  aadaNftAction,
  AggregatedAssets,
  Asset,
  AssetClass,
  asset,
  AssetData,
  BatcherDatumCommon,
  DeployedValidators,
  PriceFeed,
  OracelValidatorDetails,
  Validators,
  ValidityRange,
  TokenPrice,
} from "./../types";

import {
  CollateralSpend,
  DelayedMergeSpend,
  LeftoversLeftovers,
  LiquidityTokenLiquidityToken,
  OracleValidatorFeedType,
  OracleValidatorWithdrawValidate,
  OrderContractBorrowOrderContract,
  OrderContractDepositOrderContract,
  OrderContractRepayOrderContract,
  OrderContractWithdrawOrderContract,
  PlaceholderNftPlaceholderNft,
  PoolConfigMint,
  PoolConfigSpend,
  PoolSpend,
} from "./../plutus";
import BigNumber from "bignumber.js";
import axios from "axios";

// Lp tokens from deposit
export function calculateReceivedLptokens(
  initialCount: bigint,
  alreadyLend: bigint,
  balanceToDeposit: bigint,
  totalLpTokens: bigint
): number {
  const initialCountBN = new BigNumber(Number(initialCount));
  const alreadyLendBN = new BigNumber(Number(alreadyLend));
  const balanceToDepositBN = new BigNumber(Number(balanceToDeposit));
  const totalLPTokensBN = new BigNumber(Number(totalLpTokens));

  const lpTokensToReceive = balanceToDepositBN
    .multipliedBy(totalLPTokensBN)
    .div(initialCountBN.plus(alreadyLendBN));

  return Math.floor(lpTokensToReceive.toNumber());
}

export function calculateLpsToBurn(
  initialCount: bigint,
  alreadyLend: bigint,
  balanceToWithdraw: bigint,
  totalLpTokens: bigint
): number {
  const initialCountBN = new BigNumber(Number(initialCount));
  const alreadyLendBN = new BigNumber(Number(alreadyLend));
  const balanceToWithdrawBN = new BigNumber(Number(balanceToWithdraw));
  const totalLPTokensBN = new BigNumber(Number(totalLpTokens));

  const lpTokensToBurn = balanceToWithdrawBN
    .multipliedBy(totalLPTokensBN)
    .div(initialCountBN.plus(alreadyLendBN));

  return Math.floor(lpTokensToBurn.toNumber());
}

export async function findAssetQuantity(
  data: AssetData[],
  assetPolicy: string,
  assetName: string
): Promise<number> {
  if (assetPolicy === "") {
    let assetQuantity: number = 0;

    data.forEach((item) => {
      if (item.assets.hasOwnProperty("lovelace")) {
        assetQuantity += Number(item.assets["lovelace"]);
      }
    });

    return assetQuantity;
  } else {
    let assetQuantity: number = 0;
    const assetKey = toUnit(assetPolicy, assetName);
    data.forEach((item) => {
      if (item.assets.hasOwnProperty(assetKey)) {
        assetQuantity += Number(item.assets[assetKey]);
      }
    });

    return assetQuantity;
  }
}

export function findAssetInUtxos(
  transactions: UTxO[],
  asset: string
): UTxO | null {
  for (let transaction of transactions) {
    if (transaction.assets.hasOwnProperty(asset)) {
      return transaction;
    }
  }
  return null; // return null if no such asset is found
}

export function isBatcherDatumCommon(value: any): value is BatcherDatumCommon {
  return value && value.batcherDatumType === 1;
}

export type InterestParams = {
  optimalUtilization: bigint;
  baseInterestRate: bigint;
  rslope1: bigint;
  rslope2: bigint;
};

// Returns interest rate in integer. Divide by 1000000 to get the actual interest rate.
export function getInterestRates(
  interestParams: InterestParams,
  loanAmount: bigint,
  lentOut: bigint,
  balance: bigint
): bigint {
  //log all params

  // These are parameters hardcoded into contract. It can be moved to referencable UTXO
  // in order to be updatable, but with the same validator hash
  const optimalUtilizationBN = new BigNumber(
    Number(interestParams.optimalUtilization)
  );
  const baseInterestRateBN = new BigNumber(
    Number(BigInt(interestParams.baseInterestRate) * 1000000n)
  );
  const rslope1BN = new BigNumber(Number(interestParams.rslope1));
  const rslope2BN = new BigNumber(Number(interestParams.rslope2));
  const oneMillionBN = new BigNumber(1000000);
  const loanAmountBN = new BigNumber(Number(loanAmount));
  const lentOutBN = new BigNumber(Number(lentOut));
  const balanceBN = new BigNumber(Number(balance));

  const utilizationRateBN = new BigNumber(
    lentOutBN
      .plus(loanAmountBN)
      .multipliedBy(oneMillionBN)
      .dividedBy(balanceBN.plus(lentOutBN))
  );

  if (utilizationRateBN.lte(optimalUtilizationBN)) {
    const utilizationCharge = utilizationRateBN.multipliedBy(rslope1BN);
    // Base interest rate + charge for utilied loan
    const interestRate = BigInt(
      Math.floor(
        baseInterestRateBN.plus(utilizationCharge).dividedBy(1000000).toNumber()
      )
    );

    return interestRate;
  } else {
    const lowCharge = rslope1BN.multipliedBy(optimalUtilizationBN);
    const highCharge = utilizationRateBN
      .minus(optimalUtilizationBN)
      .multipliedBy(rslope2BN);

    return BigInt(
      Math.floor(
        Number(
          baseInterestRateBN
            .plus(lowCharge)
            .plus(highCharge)
            .dividedBy(1000000)
            .toNumber()
        )
      )
    );
  }
}

export function generateReceiverAddress(lucid: Lucid, recipientAddress: any) {
  const stakeCredential =
    recipientAddress.stakeCredential &&
    recipientAddress.stakeCredential.Inline &&
    recipientAddress.stakeCredential.Inline[0] &&
    recipientAddress.stakeCredential.Inline[0].VerificationKeyCredential
      ? lucid.utils.keyHashToCredential(
          recipientAddress.stakeCredential.Inline[0]
            .VerificationKeyCredential[0]
        )
      : undefined;

  const receiverAddress = lucid.utils.credentialToAddress(
    lucid.utils.keyHashToCredential(
      recipientAddress.paymentCredential.VerificationKeyCredential[0]
    ),
    stakeCredential
  );

  return receiverAddress;
}
export function getPlatformFee(
  loanAmount: bigint,
  balance: bigint,
  lentOut: bigint,
  loanFeeDetails: PoolConfigSpend["datum"]["loanFeeDetails"]
): bigint {
  const utilizationRate = (loanAmount * 1000000n) / (lentOut + balance);

  if (utilizationRate < loanFeeDetails.tier_1Threshold) {
    return loanFeeDetails.tier_1Fee;
  } else if (utilizationRate < loanFeeDetails.tier_2Threshold) {
    return loanFeeDetails.tier_2Fee;
  } else {
    return loanFeeDetails.tier_3Fee;
  }
}

export function calculateInterestAmount(
  interestRate: bigint,
  loanAmount: bigint,
  loanStartTs: bigint,
  currentTs: number
): bigint {
  const secondsInYear = new BigNumber(31536000000);
  const oneMillion = new BigNumber(1000000);
  const interestRateBN = new BigNumber(Number(interestRate));
  const loanAmountBN = new BigNumber(Number(loanAmount));
  const loanStartTsBN = new BigNumber(Number(loanStartTs));
  const currentTsBN = new BigNumber(Number(currentTs));

  const resultInterestAmount = BigInt(
    Math.ceil(
      loanAmountBN
        .multipliedBy(interestRateBN)
        .multipliedBy(currentTsBN.minus(loanStartTsBN))
        .div(secondsInYear.multipliedBy(oneMillion))
        .toNumber()
    )
  );

  if (resultInterestAmount > 0) {
    return resultInterestAmount;
  } else {
    return 1n;
  }
}

export function filterUtxoByTxHash(txHash: string, utxos: UTxO[]) {
  return utxos.filter((item) => item.txHash === txHash);
}

export function getValidityRange(lucid: Lucid): ValidityRange {
  const validFromInit = new Date().getTime() - 120000;
  const validToInit = new Date(validFromInit + 10 * 60 * 1000); // add 10 minutes (TTL: time to live);

  const validFromSlot = lucid.utils.unixTimeToSlot(validFromInit);
  const validToSlot = lucid.utils.unixTimeToSlot(validToInit.getTime());

  const validFrom = lucid.utils.slotToUnixTime(validFromSlot);
  const validTo = lucid.utils.slotToUnixTime(validToSlot);

  return { validFrom, validTo };
}

export function getOutputReference(utxo: UTxO) {
  return {
    transactionId: { hash: utxo.txHash },
    outputIndex: BigInt(utxo.outputIndex),
  };
}

export function parseValidators(json: any): DeployedValidators {
  const validators: DeployedValidators = {};
  for (const key in json) {
    validators[key] = {
      ...json[key],
      assets: {
        ...json[key].assets,
        lovelace: BigInt(json[key].assets.lovelace),
      },
    };
  }
  return validators;
}


export const purifiedAsset = (
  policy_id: string,
  asset_name: string
): string => {
  if (policy_id === "") {
    return "lovelace";
  } else {
    return toUnit(policy_id, asset_name);
  }
};

export type OutputReference = {
  transactionId: { hash: string };
  outputIndex: bigint;
};

export const dummyOutputRef: OutputReference = {
  transactionId: { hash: "" },
  outputIndex: BigInt(12),
};

export function collectValidators(
  lucid: Lucid,
  poolTokenName: string,
  govTokenName: string
) {
  const delegatorNftPolicy = new PlaceholderNftPlaceholderNft(3n);
  const delegatorNftPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(delegatorNftPolicy);

  const tempGovTokenPolicy = new PlaceholderNftPlaceholderNft(7n); // Making up the token. But it could be basically any NFT or even adahandle.
  const govNft = {
    policyId: lucid.utils.mintingPolicyToId(tempGovTokenPolicy),
    assetName: govTokenName,
  };

  const oracleNftPolicy = new PlaceholderNftPlaceholderNft(1n);
  const oracleNftPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(oracleNftPolicy);

  const poolConfigValidator = new PoolConfigSpend(govNft);
  const poolConfigPolicy = new PoolConfigMint(govNft);
  const poolConfigPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(poolConfigPolicy);
  const poolValidator = new PoolSpend(delegatorNftPolicyId, poolConfigPolicyId);
  const poolScriptHash = lucid.utils.validatorToScriptHash(poolValidator);

  const lpTokenPolicy = new LiquidityTokenLiquidityToken(
    poolScriptHash,
    poolTokenName
  );
  const lpTokenPolicyId: PolicyId =
    lucid.utils.mintingPolicyToId(lpTokenPolicy);

  const leftoverValidator = new LeftoversLeftovers();
  const leftoverValidatorPkh =
    lucid.utils.validatorToScriptHash(leftoverValidator);

  const mergeScript = new DelayedMergeSpend(poolScriptHash);
  const mergeScriptHash = lucid.utils.validatorToScriptHash(mergeScript);

  const collateralValidator = new CollateralSpend({
    poolScriptHash: poolScriptHash,
    liquidationsPkh: leftoverValidatorPkh,
    paramMergeScriptHash: mergeScriptHash,
  });

  const collateralValidatorHash =
    lucid.utils.validatorToScriptHash(collateralValidator);

  const orderContractBorrow = new OrderContractBorrowOrderContract();
  const orderContractDeposit = new OrderContractDepositOrderContract();
  const orderContractRepay = new OrderContractRepayOrderContract();
  const orderContractWithdraw = new OrderContractWithdrawOrderContract();

  return {
    poolScriptHash,
    delegatorNftPolicy,
    delegatorNftPolicyId,
    poolValidator,
    lpTokenPolicy,
    poolConfigValidator,
    orderContractBorrow,
    orderContractDeposit,
    orderContractWithdraw,
    orderContractRepay,
    lpTokenPolicyId,
    leftoverValidator,
    leftoverValidatorPkh,
    poolConfigPolicy,
    poolConfigPolicyId,
    collateralValidator,
    collateralValidatorHash,
    oracleNftPolicyId,
    oracleNftPolicy,
    mergeScript,
    mergeScriptHash,
    govNft,
  };
}

export function createNftRedeemer(
  action: aadaNftAction,
  txHash: string,
  outputIndex?: number
): any {
  switch (action) {
    case "MintR":
      if (outputIndex === undefined) {
        throw new Error("outputIndex is required for MintR action");
      }
      return {
        constructor: {
          index: 0,
          fields: [
            {
              constructor: {
                index: 0,
                fields: [
                  {
                    constructor: {
                      index: 0,
                      fields: [{ bytes: txHash }],
                    },
                  },
                  { integer: outputIndex },
                ],
              },
            },
          ],
        },
      };
    case "BurnR":
      return {
        constructor: {
          index: 1,
          fields: [{ bytes: txHash }],
        },
      };
    default:
      throw new Error("Unknown action: " + action);
  }
}
// Calculated ADA needed to purchase this amount of loan tokens.
export function calculateAdaNeededForPurchase(
  amount_in_exchange: number, // TokenA in the pool
  lovelaces: number, // TokenB (ADA) in the pool
  buyAmount: number // Amount of TokenA to buy
): BigNumber {
  const tokenABalance = new BigNumber(amount_in_exchange);
  const tokenBBalance = new BigNumber(lovelaces);
  const buyAmountBN = new BigNumber(buyAmount);
  const feeRate = new BigNumber(1).minus(0.003); // 0.3% fee rate

  // Calculate the invariant (K)
  const K = tokenABalance.times(tokenBBalance);

  // Calculate new TokenA balance in the pool after the purchase
  const newTokenABalance = tokenABalance.plus(buyAmountBN);

  // Calculate new TokenB balance in the pool using the invariant
  // Note: newTokenBBalance * newTokenABalance should be equal to K
  const newTokenBBalance = K.dividedBy(newTokenABalance);

  // Calculate the actual amount of TokenB (ADA) needed for the purchase
  let tokenBSellAmount = tokenBBalance.minus(newTokenBBalance);

  // Apply fee
  tokenBSellAmount = tokenBSellAmount.times(feeRate);

  // Return 0 if the calculation results in a negative number (unfeasible trade)
  return tokenBSellAmount.isNegative() ? new BigNumber(0) : tokenBSellAmount;
}

export function calculateAdaReceivedFromSale(
  amount_in_exchange: number, // TokenA in the pool
  lovelaces: number, // TokenB (ADA) in the pool
  sellAmount: number, // Amount of TokenA to sell
  decimals: number // Number of decimals for the token.
): BigNumber {
  const tokenABalance = new BigNumber(amount_in_exchange); // Balance of TokenA in the pool
  const tokenBBalance = new BigNumber(lovelaces); // Balance of TokenB (ADA) in the pool
  const tokenASellAmount = new BigNumber(sellAmount); // Amount of TokenA to sell

  const feeRate = new BigNumber(1).minus(0.003); // 0.3% fee rate
  const tokenASellAmountAfterFee = tokenASellAmount.times(feeRate);

  // Calculate the invariant (K)
  const K = tokenABalance.times(tokenBBalance);

  // Calculate new TokenA balance in the pool after the sale
  const newTokenABalance = tokenABalance.plus(tokenASellAmountAfterFee);

  // Calculate new TokenB (ADA) balance in the pool using the invariant
  const newTokenBBalance = K.dividedBy(newTokenABalance);

  // Calculate the actual amount of TokenB (ADA) received from the sale
  let tokenBReceived = tokenBBalance.minus(newTokenBBalance);

  return tokenBReceived.isNegative() ? new BigNumber(0) : tokenBReceived;
}

export async function getPoolArtifacts(
  poolTokenName: string,
  validators: Validators,
  lucid: Lucid
) {
  const poolUTxO = await lucid.provider.getUtxoByUnit(
    validators.poolScriptHash + poolTokenName
  );
  const poolDatumMapped: PoolSpend["datum"] = Data.from<PoolSpend["datum"]>(
    poolUTxO.datum!,
    PoolSpend["datum"]
  );

  const configUTxO = await lucid.provider.getUtxoByUnit(
    toUnit(
      validators.poolConfigPolicyId,
      poolDatumMapped.params.poolConfigAssetname
    )
  );

  if (configUTxO == null) {
    throw "Could not find pool config";
  }

  const poolConfigDatum: PoolConfigSpend["datum"] = Data.from<
    PoolConfigSpend["datum"]
  >(configUTxO.datum!, PoolConfigSpend["datum"]);

  return {
    configUTxO,
    poolUTxO,
    poolDatumMapped,
    poolConfigDatum,
  };
}

export const mapAssets = (assets: asset[]): AggregatedAssets => {
  const result = new Map<string, Map<string, bigint>>();
  for (const deposit of assets) {
    const { policyId, assetName, amount } = deposit;

    let assetMap = result.get(policyId);
    if (!assetMap) {
      assetMap = new Map<string, bigint>();
      result.set(policyId, assetMap);
    }

    let currentAmount = assetMap.get(assetName) || BigInt(0);
    currentAmount += BigInt(amount);
    assetMap.set(assetName, currentAmount);
  }

  // Sort by policyId, assetName and then amount
  const sortedResult = new Map<string, Map<string, bigint>>(
    [...result.entries()].sort()
  );

  for (const [policyId, assetMap] of sortedResult) {
    const sortedAssetMap = new Map<string, bigint>(
      [...assetMap.entries()].sort()
    );
    sortedResult.set(policyId, sortedAssetMap);
  }

  return sortedResult;
};

export const MIN_ADA = 2000000n;

export function constructValueWithMinAda(
  value: Map<string, Map<string, bigint>>
) {
  const adaAmount = value.get("")?.get("") || 0n;
  if (adaAmount < MIN_ADA) {
    const newValue = new Map<string, Map<string, bigint>>();
    newValue.set("", new Map([["", MIN_ADA]]));
    for (const [policyId, assetMap] of value) {
      for (const [assetName, amount] of assetMap) {
        if (policyId === "") {
          continue;
        }
        newValue.set(policyId, new Map([[assetName, amount]]));
      }
    }
    return newValue;
  }

  return value;
}

export function toUnitOrLovelace(policyId: PolicyId, assetName?: string): Unit {
  if (policyId + assetName === "") {
    return "lovelace";
  }
  return toUnit(policyId, assetName);
}

export type OutputValue = { [key: string]: bigint };
export function updateUserValue(
  userValues: OutputValue,
  newValue: OutputValue
): OutputValue {
  // Merge and sum values for existing keys, or add new keys
  for (const [newKey, newVal] of Object.entries(newValue)) {
    userValues[newKey] = (userValues[newKey] || 0n) + newVal;
  }

  // Create a new object with keys sorted, placing 'lovelace' first
  const sortedUserValues: OutputValue = {};
  const keys = Object.keys(userValues).sort((a, b) => {
    if (a === "lovelace") return -1;
    if (b === "lovelace") return 1;
    return a.localeCompare(b);
  });

  keys.forEach((key) => {
    sortedUserValues[key] = userValues[key];
  });

  return sortedUserValues;
}

type AggregatedDeposits = Map<string, Map<string, bigint>>;

export const aggregateDeposits = (deposits: Asset[]): AggregatedDeposits => {
  const result = new Map<string, Map<string, bigint>>();
  for (const deposit of deposits) {
    const { policyId, assetName, amount } = deposit;

    let assetMap = result.get(policyId);
    if (!assetMap) {
      assetMap = new Map<string, bigint>();
      result.set(policyId, assetMap);
    }

    let currentAmount = assetMap.get(assetName) || BigInt(0);
    currentAmount += BigInt(amount);
    assetMap.set(assetName, currentAmount);
  }

  // Sort by policyId, assetName and then amount
  const sortedResult = new Map<string, Map<string, bigint>>(
    [...result.entries()].sort()
  );

  for (const [policyId, assetMap] of sortedResult) {
    const sortedAssetMap = new Map<string, bigint>(
      [...assetMap.entries()].sort()
    );
    sortedResult.set(policyId, sortedAssetMap);
  }

  return sortedResult;
};

export const OutputReference = Object.assign({
  title: "OutputReference",
  dataType: "constructor",
  index: 0,
  fields: [
    {
      title: "transactionId",
      description:
        "A unique transaction identifier, as the hash of a transaction body. Note that the transaction id\n isn't a direct hash of the `Transaction` as visible on-chain. Rather, they correspond to hash\n digests of transaction body as they are serialized on the network.",
      anyOf: [
        {
          title: "TransactionId",
          dataType: "constructor",
          index: 0,
          fields: [{ dataType: "bytes", title: "hash" }],
        },
      ],
    },
    { dataType: "integer", title: "outputIndex" },
  ],
});

export function nameFromUTxO(utxo: UTxO) {
  const { hash_blake2b256 } = C;
  const the_output_reference = Data.to<OutputReference>(
    {
      transactionId: { hash: utxo.txHash },
      outputIndex: BigInt(utxo.outputIndex),
    },
    OutputReference
  );
  const assetName = toHex(hash_blake2b256(fromHex(the_output_reference)));
  return assetName;
}

export interface ApiResponse {
  signature: string; // Adjust according to your actual API response structure
}

export interface FetchError {
  error: string;
  details: any;
}

export const fetchDataFromEndpoints = async (
  apiEndpoints: string[],
  requestData: any
): Promise<Array<ApiResponse | FetchError>> => {
  const fetchPromises = apiEndpoints.map((url) =>
    axios
      .post(url, requestData) // Use axios.post to send the request
      .then((response) => response.data as ApiResponse) // Access the response data directly
      .catch((error) => ({
        error: `Failed to fetch from ${url}`,
        details: error.response ? error.response.data : error.message, // Provide more detailed error info
      }))
  );

  const timeoutPromise = new Promise<"timeout">((resolve) =>
    setTimeout(resolve, 5000, "timeout")
  );

  const results = await Promise.race([
    Promise.allSettled(fetchPromises),
    timeoutPromise,
  ]);

  if (results === "timeout") {
    return Promise.all(
      fetchPromises.map((promise) =>
        promise.catch((error) => ({
          error: "Timeout before response",
          details: error,
        }))
      )
    );
  } else {
    return results.map((result) =>
      result.status === "fulfilled"
        ? result.value
        : { error: "Failed to fetch", details: result.reason }
    );
  }
};

export async function collectOracleDetails(
  oracleNft: AssetClass,
  asset: AssetClass,
  lucid: Lucid,
  oracleDetails: OracelValidatorDetails[],
  tokenPrice: TokenPrice
): Promise<OracelValidatorDetails[]> {
  const oracleUtxo = await lucid.provider.getUtxoByUnit(
    toUnit(oracleNft.policyId, oracleNft.assetName)
  );
  const data: PriceFeed = {
    Pooled: [
      {
        token: {
          policyId: asset.policyId,
          assetName: asset.assetName,
        },

        tokenAAmount: BigInt(tokenPrice.amount_in_exchange),
        tokenBAmount: BigInt(tokenPrice.lovelaces),
        validTo: BigInt(Date.now() + 14 * 60 * 1000),
      },
    ],
  };

  const requestData = {
    data: Data.to(data, OracleValidatorFeedType["_redeemer"]),
  };

  const apiEndpoints = [
    "https://oracle-node-0.lenfi.io/validateData",
    // Add more endpoints as needed
  ];

  const responses = await fetchDataFromEndpoints(apiEndpoints, requestData);

  for (const response of responses) {
    if ("signature" in response) {
      const loanOracleDetailsFeed: OracleValidatorWithdrawValidate["redeemer"] =
        {
          data: data,
          signatures: [
            {
              signature: response.signature,
              keyPosition: 0n,
            },
          ],
        };

      const oracleValidatorHash = lucid.utils.getAddressDetails(
        oracleUtxo.address
      ).paymentCredential?.hash;

      const oracelRewardAddress = C.RewardAddress.new(
        networkToId(lucid.network),
        C.StakeCredential.from_scripthash(
          C.ScriptHash.from_hex(oracleValidatorHash || "")
        )
      )
        .to_address()
        .to_bech32(undefined);

      oracleDetails.push({
        nftReferenceUtxo: oracleUtxo,
        rewardAddress: oracelRewardAddress,
        redeemer: loanOracleDetailsFeed,
      });
    }
  }
  return oracleDetails;
}

export function assetGainAdaSale(
  oracleDatum: PriceFeed,
  sellAmount: bigint,
  assetAPolicyId: string,
  assetATokenName: string
): bigint {
  if ("Pooled" in oracleDatum) {
    const sellAmountBN = new BigNumber(Number(sellAmount));
    const tokenBAmountBN = new BigNumber(
      Number(oracleDatum.Pooled[0].tokenAAmount)
    );
    const tokenAAmount = new BigNumber(
      Number(oracleDatum.Pooled[0].tokenBAmount)
    );

    const nominator = sellAmountBN
      .multipliedBy(new BigNumber(997))
      .multipliedBy(tokenBAmountBN);

    const denominator = tokenAAmount
      .multipliedBy(new BigNumber(1000))
      .plus(sellAmountBN.multipliedBy(new BigNumber(997)));

    const assetReturn = nominator.dividedBy(denominator);

    return BigInt(Math.floor(assetReturn.toNumber()));

    // return amount;
  } else if ("Aggregated" in oracleDatum) {
    const aggregatedData = oracleDatum.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw new Error("Token not found in Aggregated price feed");
    }

    // Assuming a similar calculation is required for Aggregated data
    // Replace with the appropriate logic as needed
    const adaSellAmountBN = new BigNumber(Number(sellAmount));

    const priceInLovelaces = new BigNumber(
      Number(aggregatedData.tokenPriceInLovelaces)
    );
    const denominator = new BigNumber(Number(aggregatedData.denominator));

    return BigInt(
      adaSellAmountBN
        .dividedBy(priceInLovelaces.dividedBy(denominator))
        .integerValue(BigNumber.ROUND_FLOOR)
        .toString()
    );
  } else {
    throw new Error("Invalid price feed data");
  }
}

export function getAdaAmountIfBought(
  assetAPolicyId: PolicyId,
  assetATokenName: string,
  oracleDatum: PriceFeed,
  assetAmount: bigint
): bigint {
  if ("Pooled" in oracleDatum) {
    const pooledData = oracleDatum.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw "Token not found in Pooled price feed 1 ";
    }
    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenAAmountBN = new BigNumber(Number(pooledData.tokenAAmount));
    const tokenBAmountBN = new BigNumber(Number(pooledData.tokenBAmount));

    return BigInt(
      Math.floor(
        Number(
          assetAmountBN
            .multipliedBy(1000)
            .multipliedBy(tokenBAmountBN)
            .dividedBy(tokenAAmountBN.minus(assetAmountBN).multipliedBy(997))
        )
      )
    );
  } else if ("Aggregated" in oracleDatum) {
    // New logic for Aggregated
    const aggregatedData = oracleDatum.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw "Token not found in Aggregated price feed 2";
    }
    return BigInt(
      Math.floor(
        Number(
          new BigNumber(Number(assetAmount))
            .multipliedBy(Number(aggregatedData.tokenPriceInLovelaces))
            .dividedBy(Number(aggregatedData.denominator))
        )
      )
    );
  } else {
    throw "Invalid price feed data";
  }
}

export function getAdaAmountIfSold(
  assetAPolicyId: PolicyId,
  assetATokenName: string,
  oracleDatum: PriceFeed,
  assetAmount: bigint
): bigint {
  if ("Pooled" in oracleDatum) {
    // Existing logic for Pooled
    const pooledData = oracleDatum.Pooled.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!pooledData) {
      throw "Token not found in Pooled price feed";
    }
    const assetAmountBN = new BigNumber(Number(assetAmount));
    const tokenAAmountBN = new BigNumber(Number(pooledData.tokenAAmount));
    const tokenBAmountBN = new BigNumber(Number(pooledData.tokenBAmount));

    return BigInt(
      Math.floor(
        Number(
          assetAmountBN
            .multipliedBy(997)
            .multipliedBy(tokenBAmountBN)
            .dividedBy(
              tokenAAmountBN
                .multipliedBy(1000)
                .plus(assetAmountBN.multipliedBy(997))
            )
        )
      )
    );
  } else if ("Aggregated" in oracleDatum) {
    // New logic for Aggregated
    const aggregatedData = oracleDatum.Aggregated.find(
      (item) =>
        item.token.policyId === assetAPolicyId &&
        item.token.assetName === assetATokenName
    );
    if (!aggregatedData) {
      throw "Token not found in Aggregated price feed 1";
    }
    return BigInt(
      Math.floor(
        Number(
          new BigNumber(Number(assetAmount))
            .multipliedBy(Number(aggregatedData.tokenPriceInLovelaces))
            .dividedBy(Number(aggregatedData.denominator))
        )
      )
    );
  } else {
    throw "Invalid price feed data";
  }
}
