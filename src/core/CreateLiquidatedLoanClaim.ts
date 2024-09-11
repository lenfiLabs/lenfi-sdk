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
