import {
  BatcherDepositParams,
  createBatcherDeposit,
} from "../src/batcher/CreateBatcherDeposit";

import { Blockfrost, Lucid } from "lucid-cardano";

import dotenv from "dotenv";
const richAddress =
  "addr1qxk5nch3qxw606df505w7wgu4zqcs7na4976p9mx8sfhgwk9rql5ks69jqvtrn47gmy5galr0jdyc6cknq3pqp567s4q33t2ey";
const emptyAddress =
  "addr1qxc7m9mn3tqk92leqyr0g5v7lx7fgt5mkdw3xw8lr2lfjnqa7awytlua5w7u9t60wjads0t40x9rpmwmk9qydgjms3yqnadgt5";
dotenv.config();

describe("batcherDepositScript", () => {
  const testDeposit = async (address: string) => {
    it(`should handle deposit for address: ${address}`, async () => {
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

      const depositParams: BatcherDepositParams = {
        lucid,
        balanceToDeposit: 51_000_000n,
        poolTokenName:
          "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
      };

      const depositResult = await createBatcherDeposit(depositParams);

      // Assert that depositResult is defined
      expect(depositResult).toBeDefined();

      if (address === richAddress) {
        // For richAddress, we expect a successful transaction
        expect(depositResult.success).toBe(true);
        expect(depositResult.error).toBeUndefined();
        expect(depositResult.tx).toBeDefined();
        if (depositResult.tx) {
          expect(typeof depositResult.tx.toString).toBe("function");
        } else {
          fail("Expected depositResult.tx to be defined for richAddress");
        }
      } else if (address === emptyAddress) {
        // For emptyAddress, we expect an unsuccessful transaction
        expect(depositResult.success).toBe(false);
        expect(depositResult.error).toBe(
          "Insufficient input in transaction"
        );
        expect(depositResult.tx).toBeUndefined();
      }
    });
  };

  // Run tests for both addresses
  testDeposit(richAddress);
  testDeposit(emptyAddress);
});
