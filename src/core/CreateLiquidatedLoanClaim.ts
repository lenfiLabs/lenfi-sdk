import { Data, Lucid, toUnit } from "lucid-cardano";
import deployedValidatorsJson from "../deployedValidators.json" assert { type: "json" };
import { parseValidators } from "../utils/helpers";
import { BuilderResponse, DeployedValidators } from "../types";
import { CollateralMint, LeftoversLeftovers } from "../plutus";

export interface ClaimLiquidatedParams {
  lucid: Lucid;
  liquidationTxHash: string;
  liquidationTxOutputIndex: number;
}
/**
 * Claims the liquidated assets from a liquidation transaction in the Lenfi protocol.
 * 
 * This function allows the borrower to claim any remaining collateral after a liquidation has occurred.
 * 
 * @param {Object} params - The parameters for claiming liquidated assets.
 * @param {Lucid} params.lucid - The Lucid instance for interacting with the Cardano blockchain. With wallet attached.
 * @param {string} params.liquidationTxHash - The transaction hash of the liquidation transaction.
 * @param {number} params.liquidationTxOutputIndex - The output index of the liquidation UTxO in the transaction.
 * 
 * @returns {Promise<BuilderResponse>} A promise that resolves to an object containing the success status 
 * and either the completed transaction or an error message.
 * 
 * @throws {Error} Throws an error if:
 *   - The liquidation UTxO cannot be found
 *   - The liquidation datum cannot be parsed
 *   - There are issues with burning the borrower token
 */

export async function claimeLiquidated(
  params: ClaimLiquidatedParams
): Promise<BuilderResponse> {
  const { lucid, liquidationTxHash, liquidationTxOutputIndex } = params;

  try {
    const leftOverRedeemer = Data.void();
    const utxoToSpend = await lucid.utxosByOutRef([
      {
        txHash: liquidationTxHash,
        outputIndex: liquidationTxOutputIndex,
      },
    ]);

    const liquidationDatum: LeftoversLeftovers["datum"] = await lucid.datumOf(
      utxoToSpend[0],
      LeftoversLeftovers.datum
    );

    let borrowerTokenRedeemer: CollateralMint["redeemer"] = {
      mints: [],
      burns: [{ tokenName: liquidationDatum.assetName }],
    };

    const deployedValidators: DeployedValidators = parseValidators(
      deployedValidatorsJson
    );

    const completedTx = await lucid
      .newTx()
      .collectFrom(utxoToSpend, leftOverRedeemer)
      .mintAssets(
        {
          [toUnit(liquidationDatum.policyId, liquidationDatum.assetName)]:
            BigInt(-1),
        },
        Data.to(borrowerTokenRedeemer, CollateralMint.redeemer)
      )
      .readFrom([deployedValidators.collateralValidator])
      .readFrom([deployedValidators.leftoverValidator])
      .complete({ nativeUplc: false });

    return { success: true, tx: completedTx };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
