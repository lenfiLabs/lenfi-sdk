import { Data, Lucid, Validator, getAddressDetails } from "lucid-cardano";
import { GOV_TOKEN_NAME } from "../constants";
import { collectValidators } from "../utils/helpers";
import { BuilderResponse } from "../types";
import {
  OrderContractBorrowOrderContract,
  OrderContractDepositOrderContract,
  OrderContractWithdrawOrderContract,
} from "../plutus";

export interface CancelBatcherOrderParams {
  lucid: Lucid;
  poolTokenName: string;
  orderTxHash: string;
  orderTxIndex: number;
}
/**
 * Cancels a batcher order in the Lenfi protocol.
 *
 * This function attempts to cancel an existing batcher order (deposit, withdraw, or borrow)
 * by consuming the UTxO that represents the order and returning the funds to the user.
 *
 * @param {Object} params - The parameters for cancelling a batcher order.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
 * @param {string} params.poolTokenName - The name of the pool token.
 * @param {string} params.orderTxHash - The transaction hash of the order to be cancelled.
 * @param {number} params.orderTxIndex - The output index of the order in the transaction.
 *
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status
 * and either the completed transaction or an error message.
 *
 * @throws {Error} Throws an error if:
 *   - The pool config cannot be found
 *   - The order cannot be found or is of an unknown type
 *   - The wallet details cannot be retrieved
 */

export async function cancelBatcherOrder(
  params: CancelBatcherOrderParams
): Promise<BuilderResponse> {
  const { lucid, poolTokenName, orderTxHash, orderTxIndex } = params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);

    const batcherUtxos = (
      await lucid.utxosByOutRef([
        {
          txHash: orderTxHash,
          outputIndex: orderTxIndex,
        },
      ])
    )[0];

    const batcherRedeemer: OrderContractDepositOrderContract["redeemer"] =
      "Cancel";
    var validator: Validator;

    if (batcherUtxos == null) {
      throw "Could not find pool config";
    }

    try {
      const orderDatum: OrderContractDepositOrderContract["datum"] = Data.from<
        OrderContractDepositOrderContract["datum"]
      >(batcherUtxos.datum!, OrderContractDepositOrderContract["datum"]);
      validator = validators.orderContractDeposit;
    } catch {
      try {
        const orderDatum: OrderContractWithdrawOrderContract["datum"] =
          Data.from<OrderContractWithdrawOrderContract["datum"]>(
            batcherUtxos.datum!,
            OrderContractWithdrawOrderContract["datum"]
          );
        validator = validators.orderContractWithdraw;
      } catch {
        try {
          const orderDatum: OrderContractBorrowOrderContract["datum"] =
            Data.from<OrderContractBorrowOrderContract["datum"]>(
              batcherUtxos.datum!,
              OrderContractBorrowOrderContract["datum"]
            );
          validator = validators.orderContractBorrow;
        } catch {
          throw "Could not find order";
        }
      }
    }

    const walletDetails = getAddressDetails(await lucid.wallet.address());
    if (!walletDetails["paymentCredential"]) {
      throw "Could not find wallet details";
    }

    const completedTx = await lucid
      .newTx()
      .collectFrom(
        [batcherUtxos],
        Data.to(batcherRedeemer, OrderContractDepositOrderContract.redeemer)
      )
      .addSignerKey(walletDetails["paymentCredential"]["hash"])
      .attachSpendingValidator(validator)
      .complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
