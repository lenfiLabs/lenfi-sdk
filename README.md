# lenfi-sdk

The lenfi-sdk is a TypeScript library that provides an interface to interact with the Lenfi protocol on the Cardano blockchain. This SDK simplifies the process of depositing, borrowing, repaying, and liquidating assets within the Lenfi ecosystem.

## Installation

To install the lenfi-sdk, use npm:

```bash
npm install lenfi-sdk
```

## Prerequisites

Before using the SDK, make sure you have:

1. A Blockfrost API key
2. Access to a Cardano wallet (address)

## Usage

Here are examples of how to use the main functions provided by the lenfi-sdk:

### Initializing Lucid

For all operations, you'll need to initialize the Lucid library:

```typescript
import { Blockfrost, Lucid } from "lucid-cardano";

const initLucid = async (blockfrostApiKey: string, address: string) => {
  const lucid = await Lucid.new(
    new Blockfrost(
      "https://cardano-mainnet.blockfrost.io/api/v0",
      blockfrostApiKey
    ),
    "Mainnet"
  );

  lucid.selectWalletFrom({ address });
  return lucid;
};
```

### Depositing

To deposit assets into a Lenfi pool:

```typescript
import { createDeposit, DepositParams } from "lenfi-sdk";

const depositExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const depositParams: DepositParams = {
    lucid,
    balanceToDeposit: 51000000n,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    lpValidatorTxHash: "17d2a5a56aacc0905b0abc6d40beee70a207155acf7e712f18d0c59c95fc5cba",
    lpValidatorTxOutput: 0,
  };

  const depositResult = await createDeposit(depositParams);
  console.log(depositResult);
};
```
The lpValidatorTxHash and lpValidatorTxOutput are references to the UTXO where the script is deployed. If not provided, the script will attach the validator to the transaction. Attaching will result in a higher transaction fee.

### Borrowing

To borrow assets from a Lenfi pool:

```typescript
import { createLoan, BorrowParams } from "lenfi-sdk";
import { getValidityRange } from "lenfi-sdk/utils/helpers";

const borrowExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);
  const validityRange = getValidityRange(lucid);

  const borrowParams: BorrowParams = {
    lucid,
    validityRange,
    loanAmount: 51_000_000n,
    collateralAmount: 200_000_000n,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    collateralTokenPrice: await fetchTokenPrice(collateralTokenId),
    loanTokenPrice: await fetchTokenPrice(loanTokenId),
  };

  const borrowResult = await createLoan(borrowParams);
  console.log(borrowResult);
};
```

### Repaying

To repay a loan:

```typescript
import { repayLoan, RepayParams } from "lenfi-sdk";
import { getValidityRange } from "lenfi-sdk/utils/helpers";

const repayExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);
  const validityRange = getValidityRange(lucid);

  const repayParams: RepayParams = {
    lucid,
    validityRange,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    loanTxHash: "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
    loanTxOutputIndex: 1,
  };

  const repayResult = await repayLoan(repayParams);
  console.log(repayResult);
};
```

### Liquidating

To liquidate an undercollateralized loan:

```typescript
import { createLiquidation, LiquidateParams } from "lenfi-sdk";
import { getValidityRange } from "lenfi-sdk/utils/helpers";

const liquidateExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);
  const validityRange = getValidityRange(lucid);

  const liquidateParams: LiquidateParams = {
    lucid,
    validityRange,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    loanTxHash: "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
    loanTxOutputIndex: 1,
    loanTokenPrice: await fetchTokenPrice(loanTokenId),
    collateralTokenPrice: await fetchTokenPrice(collateralTokenId),
  };

  const liquidateResult = await createLiquidation(liquidateParams);
  console.log(liquidateResult);
};
```

### Withdrawing

To withdraw assets from a Lenfi pool:

```typescript
import { createWithdrawal, WithdrawParams } from "lenfi-sdk";

const withdrawExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const withdrawParams: WithdrawParams = {
    lucid,
    amountToWithdraw: 51000000n,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    lpValidatorTxHash: "17d2a5a56aacc0905b0abc6d40beee70a207155acf7e712f18d0c59c95fc5cba",
    lpValidatorTxOutput: 0,
  };

  const withdrawResult = await createWithdrawal(withdrawParams);
  console.log(withdrawResult);
};
```
The lpValidatorTxHash and lpValidatorTxOutput are references to the UTXO where the script is deployed. If not provided, the script will attach the validator to the transaction. Attaching will result in a higher transaction fee.

## Transaction handling
Returned object contains transaction body (CBOR) which can be signed and submitted to Cardano blockchain.

## Error Handling

All functions return a result object with a `success` boolean. If `success` is `false`, check the `error` property for details about what went wrong.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.