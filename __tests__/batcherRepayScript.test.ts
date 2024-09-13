import { Blockfrost, Lucid } from "lucid-cardano";
import dotenv from "dotenv";
import { BatcherRepayParams, createBatcherRepay } from "../src";
import { getValidityRange } from "../src/utils/helpers";
const richAddress =
  "addr1qxk5nch3qxw606df505w7wgu4zqcs7na4976p9mx8sfhgwk9rql5ks69jqvtrn47gmy5galr0jdyc6cknq3pqp567s4q33t2ey";
const emptyAddress =
  "addr1qxc7m9mn3tqk92leqyr0g5v7lx7fgt5mkdw3xw8lr2lfjnqa7awytlua5w7u9t60wjads0t40x9rpmwmk9qydgjms3yqnadgt5";
dotenv.config();

describe("batcherWithdrawScript", () => {
  const testRepay = async (address: string) => {
    it(`should handle withdraw for address: ${address}`, async () => {
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

      const validityRange = getValidityRange(lucid);

      const repayParams: BatcherRepayParams = {
        lucid,
        validityRange,
        poolTokenName:
          "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
        loanTxHash:
          "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
        loanTxOutputIndex: 1,
      };

      const repayResult = await createBatcherRepay(repayParams);

      // Assert that depositResult is defined
      expect(repayResult).toBeDefined();

      if (address === richAddress) {
        // For richAddress, we expect a successful transaction
        expect(repayResult.success).toBe(true);
        expect(repayResult.error).toBeUndefined();
        expect(repayResult.tx).toBeDefined();
        if (repayResult.tx) {
          expect(typeof repayResult.tx.toString).toBe("function");
        } else {
          fail("Expected depositResult.tx to be defined for richAddress");
        }
      } else if (address === emptyAddress) {
        // For emptyAddress, we expect an unsuccessful transaction
        expect(repayResult.success).toBe(false);
        expect(repayResult.error).toBe(
          "Missing input or output for some native asset"
        );
        expect(repayResult.tx).toBeUndefined();
      }
    });
  };

  // Run tests for both addresses
  testRepay(richAddress);
  testRepay(emptyAddress);
});
