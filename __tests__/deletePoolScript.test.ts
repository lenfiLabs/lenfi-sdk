import { deletePool, DeleteParameters } from "../src";
import { Blockfrost, Lucid } from "lucid-cardano";

import dotenv from "dotenv";
const richAddress =
  "addr1qxwtt67h596rgqvs0q9ux7uuchtndqj6pcj8epl2nx6ex34pnluhv9zc9fx587m4e3gezj7k5zw8m3lvr35hvlrc5z7qpehpch";
dotenv.config();

describe("depositScript", () => {
  const testDelegate = async (address: string) => {
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

      const depositResult = await deletePool(poolDeletionParameters);

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
  testDelegate(richAddress);
});
