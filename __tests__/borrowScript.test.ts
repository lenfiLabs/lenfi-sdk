import { TokenPrice } from "./../src/types";
import {
  BorrowParams,
  BorrowResult,
  createLoan,
} from "./../src/core/CreatePoolBorrow";
import { Blockfrost, Lucid } from "lucid-cardano";

import dotenv from "dotenv";
import { getValidityRange } from "../src/utils/helpers";

const richAddress =
  "addr1qxk5nch3qxw606df505w7wgu4zqcs7na4976p9mx8sfhgwk9rql5ks69jqvtrn47gmy5galr0jdyc6cknq3pqp567s4q33t2ey";
const emptyAddress =
  "addr1qxc7m9mn3tqk92leqyr0g5v7lx7fgt5mkdw3xw8lr2lfjnqa7awytlua5w7u9t60wjads0t40x9rpmwmk9qydgjms3yqnadgt5";
dotenv.config();

describe("BorrowScript", () => {
  const testLoanCreation = async (address: string) => {
    it(`should handle borrow for address: ${address}`, async () => {
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

      const loanToken = {
        policyId: "",
        assetName: "",
      };

      const loanTokenPrice = await fetchUncachedTokenPrice(
        loanToken.policyId + loanToken.assetName
      );

      const collateralToken = {
        policyId: "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587",
        assetName: "41414441",
      };

      const collateralTokenPrice = await fetchUncachedTokenPrice(
        collateralToken.policyId + collateralToken.assetName
      );

      const validityRange = getValidityRange(lucid);

      const borrowParams: BorrowParams = {
        lucid,
        validityRange,
        loanAmount: 51_000_000n,
        collateralAmount: 200_000_000n,
        poolTokenName:
          "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
        collateralTokenPrice,
        loanTokenPrice,
      };

      const borrowResult: BorrowResult = await createLoan(borrowParams);

      // Assert that depositResult is defined
      expect(borrowResult).toBeDefined();

      if (address === richAddress) {
        // For richAddress, we expect a successful transaction
        expect(borrowResult.success).toBe(true);
        expect(borrowResult.error).toBeUndefined();
        expect(borrowResult.tx).toBeDefined();
        if (borrowResult.tx) {
          expect(typeof borrowResult.tx.toString).toBe("function");
        } else {
          fail("Expected borrowResult.tx to be defined for richAddress");
        }
      } else if (address === emptyAddress) {
        // For emptyAddress, we expect an unsuccessful transaction
        expect(borrowResult.success).toBe(false);
        expect(borrowResult.error).toBe(
          "Missing input or output for some native asset"
        );
        expect(borrowResult.tx).toBeUndefined();
      }
    });
  };

  // Run tests for both addresses
  testLoanCreation(richAddress);
  testLoanCreation(emptyAddress);
});

//
export async function fetchUncachedTokenPrice(
  tokenId: string
): Promise<TokenPrice | undefined> {
  try {
    // If tokenId is provided, fetch the specific token price

    const response: TokenPrice = {
      accepted_as_collateral: true,
      accepted_as_loan: true,
      amount_in_exchange: 976411396236,
      decimals: "6",
      initial_collateral_ratio: 2200000,
      liquidation_threshold: 2000000,
      lovelaces: 1328657010255,
      token_id:
        "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f6958741414441",
      token_name: "41414441",
      token_nice_name: "LENFI",
      token_policy: "8fef2d34078659493ce161a6c7fba4b56afefa8535296a5743f69587",
    };

    return response;
  } catch (error) {
    console.error("Error fetching uncached token price:", error);
    throw error;
  }
}
