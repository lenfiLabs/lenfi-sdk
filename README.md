# lenfi-sdk

The lenfi-sdk is a TypeScript library that provides an interface to interact with the Lenfi protocol on the Cardano blockchain. This SDK simplifies the process of depositing, borrowing, repaying, and liquidating assets within the Lenfi ecosystem.

## Available Functions

Here's a list of all available functions in the lenfi-sdk:

1. `createDeposit`: Deposit assets into a Lenfi pool.
2. `createLoan`: Borrow assets from a Lenfi pool.
3. `repayLoan`: Repay a loan taken from a Lenfi pool.
4. `createLiquidation`: Liquidate an undercollateralized loan.
5. `createWithdrawal`: Withdraw assets from a Lenfi pool.
6. `createBatcherDeposit`: Create a batcher deposit order.
7. `createBatcherBorrow`: Create a batcher borrow order.
8. `createBatcherRepay`: Create a batcher repay order.
9. `createBatcherWithdraw`: Create a batcher withdraw order.
10. `executeBatcherDeposit`: Execute a batcher deposit order.
11. `executeBatcherBorrow`: Execute a batcher borrow order.
12. `executeBatcherRepay`: Execute a batcher repay order.
13. `executeBatcherWithdraw`: Execute a batcher withdraw order.
14. `cancelBatcherOrder`: Cancel a batcher order.
15. `claimeLiquidated`: Claim liquidated assets after a liquidation.
16. `createPool`: Create a new Lenfi pool.
17. `delegatePool`: Delegate a Lenfi pool to a stake pool.
18. `deletePool`: Delete a Lenfi pool.

## Direct Transactions vs. Batcher Transactions

By default, all transactions should be created to interact with the pool directly. This is the most efficient method during normal usage. However, during times of high network congestion or pool usage, you have the option to create a batcher transaction.

Batcher transactions work as follows:

1. Instead of interacting with the pool directly, you create an "order" transaction (using functions like `createBatcherDeposit`, `createBatcherBorrow`, etc.).
2. This order is then picked up and executed by a third party (often called a "keeper" or "bot") for a fee of 2 ADA.
3. The third party uses functions like `executeBatcherDeposit`, `executeBatcherBorrow`, etc., to process your order.

This batcher system helps to manage high-traffic periods by allowing transactions to be bundled and executed more efficiently. It also provides a way for transactions to be processed even when the user may not have enough ADA to cover network fees during congested periods.

Use batcher transactions when:
- The network is congested and transaction fees are high
- The pool is experiencing high usage and direct transactions are failing
- You want to ensure your transaction will be processed even if you're not online

Remember, while batcher transactions provide benefits during high-usage periods, they come with a 2 ADA fee and may not be processed as immediately as direct transactions.

You can also use 'Execute' batcher orders to collect that fee.

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

### Batcher Deposit

To create a batcher deposit order:

```typescript
import { createBatcherDeposit, BatcherDepositParams } from "lenfi-sdk";

const batcherDepositExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const depositParams: BatcherDepositParams = {
    lucid,
    balanceToDeposit: 51_000_000n,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
  };

  const depositResult = await createBatcherDeposit(depositParams);
  console.log(depositResult);
};
```

### Batcher Borrow

To create a batcher borrow order:

```typescript
import { createBatcherBorrow, BatcherBorrowParams } from "lenfi-sdk";
import { getValidityRange } from "lenfi-sdk/utils/helpers";

const batcherBorrowExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);
  const validityRange = getValidityRange(lucid);

  const borrowParams: BatcherBorrowParams = {
    lucid,
    validityRange,
    loanAmount: 51_000_000n,
    collateralAmount: 200_000_000n,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    collateralTokenPrice: await fetchTokenPrice(collateralTokenId),
    loanTokenPrice: await fetchTokenPrice(loanTokenId),
  };

  const borrowResult = await createBatcherBorrow(borrowParams);
  console.log(borrowResult);
};
```

### Batcher Repay

To create a batcher repay order:

```typescript
import { createBatcherRepay, BatcherRepayParams } from "lenfi-sdk";
import { getValidityRange } from "lenfi-sdk/utils/helpers";

const batcherRepayExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);
  const validityRange = getValidityRange(lucid);

  const repayParams: BatcherRepayParams = {
    lucid,
    validityRange,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    loanTxHash: "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
    loanTxOutputIndex: 1,
  };

  const repayResult = await createBatcherRepay(repayParams);
  console.log(repayResult);
};
```

### Batcher Withdraw

To create a batcher withdraw order:

```typescript
import { createBatcherWithdraw, BatcherWithdrawParams } from "lenfi-sdk";

const batcherWithdrawExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const withdrawParams: BatcherWithdrawParams = {
    lucid,
    amountToWithdraw: 51_000_000n,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
  };

  const withdrawResult = await createBatcherWithdraw(withdrawParams);
  console.log(withdrawResult);
};
```

### Execute Batcher Order

To execute a batcher order (example for deposit):

```typescript
import { executeBatcherDeposit, BatcherExecuteDepositParams } from "lenfi-sdk";

const executeBatcherDepositExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const executeParams: BatcherExecuteDepositParams = {
    lucid,
    orderTxHash: "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
    orderTxOutputIndex: 0,
  };

  const executeResult = await executeBatcherDeposit(executeParams);
  console.log(executeResult);
};
```

### Cancel Batcher Order

To cancel a batcher order:

```typescript
import { cancelBatcherOrder, CancelBatcherOrderParams } from "lenfi-sdk";

const cancelBatcherOrderExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const cancelParams: CancelBatcherOrderParams = {
    lucid,
    poolTokenName: "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    cancelTxHash: "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
    cancelTxIndex: 0,
  };

  const cancelResult = await cancelBatcherOrder(cancelParams);
  console.log(cancelResult);
};
```

### Claim Liquidated Assets

To claim liquidated assets after a liquidation:

```typescript
import { claimeLiquidated, ClaimLiquidatedParams } from "lenfi-sdk";

const claimLiquidatedExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const claimParams: ClaimLiquidatedParams = {
    lucid,
    liquidationTxHash: "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
    liquidationTxOutputIndex: 0,
  };

  const claimResult = await claimeLiquidated(claimParams);
  console.log(claimResult);
};
```

### Creating a Pool

To create a new Lenfi pool

```typescript
import { createPool, PoolParameters } from "lenfi-sdk";
import { Blockfrost, Lucid } from "lucid-cardano";

const createPoolExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const poolCreationParameters: PoolParameters = {
    lucid,
    loanAsset: {
      policyId: "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587",
      assetName: "41414441",
    },
    collateralAsset: {
      policyId: "",
      assetName: "",
    },
    initialDepositAmount: BigInt(1000000),
    delegationSpoBech:
      "pool1z5uqdk7dzdxaae5633fqfcu2eqzy3a3rgtuvy087fdld7yws0xt",
    delegationSpoId:
      "153806dbcd134ddee69a8c5204e38ac80448f62342f8c23cfe4b7edf",
    loanTokenParameters: {
      oracleNft: {
        policyId: "",
        assetName: "",
      },
      liquidationThreshold: 2_000_000n,
      initialCollateralRatio: 2_100_000n,
      liquidationFee: 12n,
      poolFee: 1_000_000n,
      minFee: 1_000_000n,
      mergeActionFee: 2_000_000n,
      minTransition: 50_000_000n,
      minLiquidationAmount: 29999n,
      minLoanAmount: 50_000_000n,
    },
    collateralTokenParameters: {
      oracleNft: {
        policyId: "",
        assetName: "",
      },
      liquidationThreshold: 2_000_000n,
      initialCollateralRatio: 2_100_000n,
      liquidationFee: 12n,
      poolFee: 1_000_000n,
      minFee: 1_000_000n,
      mergeActionFee: 2_000_000n,
      minTransition: 50_000_000n,
      minLiquidationAmount: 29999n,
      minLoanAmount: 50_000_000n,
    },
  };

  const createPoolResult = await createPool(poolCreationParameters);
  console.log(createPoolResult);
};
```

Lenfi as a protocol accepts pre-defined parameters for the fees, amounts or NFTs, you can pull these by token from https://api.lenfi.io/api/v0.1/tokens_parameters

### Delegating a Pool

To delegate a Lenfi pool to a stake pool:

```typescript
import { delegatePool, DelegationParameters } from "lenfi-sdk";
import { Blockfrost, Lucid } from "lucid-cardano";

const delegatePoolExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const poolDelegationParameters: DelegationParameters = {
    lucid,
    poolTokenName:
      "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    poolOwnerNftId:
      "c04e78ea267631f27975446a15d96ef1f3bbcdbf99577d3e552c663b1175ee981b6b88cd45d2cbfdf93ef48f968fa842588bde3027f2e4495f156c65",
    stakePoolHash:
      "pool1z5uqdk7dzdxaae5633fqfcu2eqzy3a3rgtuvy087fdld7yws0xt",
    stakeValidatorTxHash:
      "17d2a5a56aacc0905b0abc6d40beee70a207155acf7e712f18d0c59c95fc5cba",
    stakeValidatorTxOutput: 1,
  };

  const delegatePoolResult = await delegatePool(poolDelegationParameters);
  console.log(delegatePoolResult);
};
```

### Deleting a Pool

To delete a Lenfi pool:

```typescript
import { deletePool, DeleteParameters } from "lenfi-sdk";
import { Blockfrost, Lucid } from "lucid-cardano";

const deletePoolExample = async () => {
  const lucid = await initLucid(blockfrostApiKey, userAddress);

  const poolDeletionParameters: DeleteParameters = {
    lucid,
    poolTokenName:
      "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
    lpValidatorTxHash:
      "17d2a5a56aacc0905b0abc6d40beee70a207155acf7e712f18d0c59c95fc5cba",
    lpValidatorTxOutput: 0,
    stakeValidatorTxHash:
      "17d2a5a56aacc0905b0abc6d40beee70a207155acf7e712f18d0c59c95fc5cba",
    stakeValidatorTxOutput: 1,
  };

  const deletePoolResult = await deletePool(poolDeletionParameters);
  console.log(deletePoolResult);
};
```

To find more examples, please check the `__tests__` folder.

## Transaction Handling

The returned object contains a transaction body (CBOR) which can be signed and submitted to the Cardano blockchain.

## Error Handling

All functions return a result object with a `success` boolean. If `success` is `false`, check the `error` property for details about what went wrong.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.