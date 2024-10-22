import { Blockfrost, Lucid } from "lucid-cardano";
import { createPool, PoolParameters } from "../src";
import dotenv from "dotenv";
const richAddress =
  "addr1qxk5nch3qxw606df505w7wgu4zqcs7na4976p9mx8sfhgwk9rql5ks69jqvtrn47gmy5galr0jdyc6cknq3pqp567s4q33t2ey";
dotenv.config();

describe("depositScript", () => {
  const testCreation = async (address: string) => {
    it(`should build transaction for pool creation ${address}`, async () => {
      const blockfrostApiKey = process.env.BLOCKFROST_API_KEY;
      if (!blockfrostApiKey) {
        throw new Error(
          "BLOCKFROST_API_KEY is not set in the environment variables"
        );
      }

      const lucid = await Lucid.new(
        new Blockfrost(
          "https://cardano-mainnet.blockfrost.io/api/v0",
          blockfrostApiKey
        ),
        "Mainnet"
      );

      lucid.selectWalletFrom({ address });

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

      const depositResult = await createPool(poolCreationParameters);

      // Assert that depositResult is defined
      expect(depositResult).toBeDefined();

      // For richAddress, we expect a successful transaction
      expect(depositResult.success).toBe(true);
      expect(depositResult.error).toBeUndefined();
      expect(depositResult.tx).toBeDefined();
      if (depositResult.tx) {
        expect(typeof depositResult.tx.toString).toBe("function");
      } else {
        fail("Expected depositResult.tx to be defined");
      }
    });
  };

  // Run tests for both addresses
  testCreation(richAddress);
});
