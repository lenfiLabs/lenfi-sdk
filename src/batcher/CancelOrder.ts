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
  cancelTxHash: string;
  cancelTxIndex: number;
}

export async function cancelBatcherOrder(
  params: CancelBatcherOrderParams
): Promise<BuilderResponse> {
  const { lucid, poolTokenName, cancelTxHash, cancelTxIndex } = params;

  try {
    const validators = collectValidators(lucid, poolTokenName, GOV_TOKEN_NAME);

    const batcherUtxos = (
      await lucid.utxosByOutRef([
        {
          txHash: cancelTxHash,
          outputIndex: cancelTxIndex,
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
