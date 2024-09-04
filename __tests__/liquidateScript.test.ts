import {
  createLiquidation,
  LiquidateParams,
  LiquidateResult,
} from "./../src/core/CreatePoolLiquidate";

import { Blockfrost, Lucid } from "lucid-cardano";

import dotenv from "dotenv";
import { getValidityRange } from "../src/utils/helpers";
import { fetchUncachedTokenPrice } from "./borrowScript.test";

const richAddress =
  "addr1qxk5nch3qxw606df505w7wgu4zqcs7na4976p9mx8sfhgwk9rql5ks69jqvtrn47gmy5galr0jdyc6cknq3pqp567s4q33t2ey";
const emptyAddress =
  "addr1qxc7m9mn3tqk92leqyr0g5v7lx7fgt5mkdw3xw8lr2lfjnqa7awytlua5w7u9t60wjads0t40x9rpmwmk9qydgjms3yqnadgt5";
dotenv.config();

describe("LiquidateScript", () => {
  const testLiquidate = async (address: string) => {
    it(`should handle liquidate for address: ${address}`, async () => {
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

      const liquidateParams: LiquidateParams = {
        lucid,
        validityRange,
        poolTokenName:
          "7876ebac44945a88855442692b86400776e0a2987c5f54a19b457d86",
        loanTxHash:
          "f5fc37c67071904be218dcb727aba30065f95312e051f007b747b43495af9b92",
        loanTxOutputIndex: 1,
        loanTokenPrice,
        collateralTokenPrice,
      };

      const liquidateResult: LiquidateResult = await createLiquidation(
        liquidateParams
      );

      // Assert that depositResult is defined
      expect(liquidateResult).toBeDefined();

      if (address === richAddress) {
        // For richAddress, we expect a successful transaction
        expect(liquidateResult.success).toBe(true);
        expect(liquidateResult.error).toBeUndefined();
        expect(liquidateResult.tx).toBeDefined();
        if (liquidateResult.tx) {
          expect(typeof liquidateResult.tx.toString).toBe("function");
        } else {
          fail("Expected repayResult.tx to be defined for richAddress");
        }
      } else if (address === emptyAddress) {
        // For emptyAddress, we expect an unsuccessful transaction
        expect(liquidateResult.success).toBe(false);
        expect(liquidateResult.error).toBe(
          "Missing input or output for some native asset"
        );
        expect(liquidateResult.tx).toBeUndefined();
      }
    });
  };

  // Liquidation tests on mainnet are only possible when undercollaterized loans are available
  // testLiquidate(richAddress);
  // testLiquidate(emptyAddress);
});
