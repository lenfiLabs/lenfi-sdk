import { Blockfrost, Lucid, TxComplete } from "lucid-cardano";
import { createDeposit, DepositParams, DepositResult } from "./src";
import dotenv from "dotenv";
const richAddress =
  "addr1qxk5nch3qxw606df505w7wgu4zqcs7na4976p9mx8sfhgwk9rql5ks69jqvtrn47gmy5galr0jdyc6cknq3pqp567s4q33t2ey";
const emptyAddress =
  "addr1qxc7m9mn3tqk92leqyr0g5v7lx7fgt5mkdw3xw8lr2lfjnqa7awytlua5w7u9t60wjads0t40x9rpmwmk9qydgjms3yqnadgt5";
dotenv.config();

describe("depositScript", () => {
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

      const depositParams: DepositParams = {
        lucid,
        balanceToDeposit: 51000000n,
        poolTokenId:
          "32e8c0ae314ef4be452c16a999867f66d1a1791fc972cb2f7c74e38d7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
        lpValidatorTxHash:
          "17d2a5a56aacc0905b0abc6d40beee70a207155acf7e712f18d0c59c95fc5cba",
        lpValidatorTxOutput: 0,
      };

      const depositResult: DepositResult = await createDeposit(depositParams);

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
          "Missing input or output for some native asset"
        );
        expect(depositResult.tx).toBeUndefined();
      }
    });
  };

  // Run tests for both addresses
  testDeposit(richAddress);
  testDeposit(emptyAddress);
});
