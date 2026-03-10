import { describe, expect, it } from "bun:test";
import {
  decodeFunctionResult,
  encodeFunction,
  encodeValueWord,
  functionSelector,
} from "../src/blockchain/abi-encoder";
import { EvmBlockchainGateway } from "../src/blockchain/evm-gateway";
import type { ContractAddresses } from "../src/blockchain/contract-abis";
import { MockRpcProvider } from "../src/infrastructure/blockchain/mock-rpc-provider";

const CONTRACT_ADDRESSES: ContractAddresses = {
  escrow: "0x1111111111111111111111111111111111111111",
  identitySBT: "0x2222222222222222222222222222222222222222",
  staking: "0x3333333333333333333333333333333333333333",
  payRouter: "0x4444444444444444444444444444444444444444",
};

describe("Contract bridge", () => {
  it("ABI encodes and decodes uint256 values", () => {
    const value = 123_456_789n;
    const encoded = encodeFunction("setValue", ["uint256"], [value]);
    const [decoded] = decodeFunctionResult(["uint256"], `0x${encoded.slice(10)}`);

    expect(decoded).toBe(value);
  });

  it("ABI encodes and decodes address values", () => {
    const address = "0x00000000000000000000000000000000000000a1";
    const encoded = encodeFunction("setAddress", ["address"], [address]);
    const [decoded] = decodeFunctionResult(["address"], `0x${encoded.slice(10)}`);

    expect(decoded).toBe(address);
  });

  it("generates Ethereum function selectors", () => {
    const selector = functionSelector("transfer", ["address", "uint256"]);
    expect(selector).toBe("0xa9059cbb");
  });

  it("MockRpcProvider returns configured responses", async () => {
    const mock = new MockRpcProvider();
    mock.setResponse("eth_chainId", [], "0x1");

    const chainId = await mock.request("eth_chainId", []);
    const calls = mock.getCalls("eth_chainId");

    expect(chainId).toBe("0x1");
    expect(calls.length).toBe(1);
    expect(calls[0]?.params).toEqual([]);
  });

  it("EvmBlockchainGateway.createEscrow sends expected RPC call", async () => {
    const mock = new MockRpcProvider();
    mock.setMethodResponse("eth_sendRawTransaction", "0xtx-create");

    const gateway = new EvmBlockchainGateway({
      rpcUrl: "http://localhost:8545",
      contractAddresses: CONTRACT_ADDRESSES,
      rpcProvider: mock,
    });

    const payer = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await gateway.createEscrow("7", payer, 5_000);

    const sendCalls = mock.getCalls("eth_sendRawTransaction");
    expect(sendCalls.length).toBe(1);

    const rawTx = sendCalls[0]?.params[0];
    expect(typeof rawTx).toBe("string");

    const payload = JSON.parse(Buffer.from(String(rawTx).slice(2), "hex").toString("utf8")) as {
      to: string;
      data: string;
    };

    expect(payload.to).toBe(CONTRACT_ADDRESSES.escrow);
    expect(payload.data).toBe(
      encodeFunction("createEscrow", ["uint256", "address", "uint256"], [7n, payer, 5_000n]),
    );
  });

  it("EvmBlockchainGateway.getEscrow decodes eth_call results", async () => {
    const mock = new MockRpcProvider();
    const payer = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const callResult = `0x${[
      encodeValueWord("address", payer),
      encodeValueWord("uint256", 9_999n),
      encodeValueWord("bool", false),
      encodeValueWord("bool", false),
    ].join("")}`;
    mock.setMethodResponse("eth_call", callResult);

    const gateway = new EvmBlockchainGateway({
      rpcUrl: "http://localhost:8545",
      contractAddresses: CONTRACT_ADDRESSES,
      rpcProvider: mock,
    });

    const escrow = await gateway.getEscrow("7");
    const call = mock.getCalls("eth_call")[0];

    expect(escrow).toEqual({
      taskId: "7",
      payerId: payer,
      amountCents: 9_999,
      released: false,
      releaseTxId: undefined,
    });
    expect(call?.params[0]).toEqual({
      to: CONTRACT_ADDRESSES.escrow,
      data: encodeFunction("getEscrow", ["uint256"], [7n]),
    });
    expect(call?.params[1]).toBe("latest");
  });

  it("rejects zero-address contract deployments", () => {
    expect(
      () =>
        new EvmBlockchainGateway({
          rpcUrl: "http://localhost:8545",
          contractAddresses: {
            ...CONTRACT_ADDRESSES,
            escrow: "0x0000000000000000000000000000000000000000",
          },
        }),
    ).toThrow("contract address escrow cannot be the zero address");
  });

  it("rejects duplicate contract addresses", () => {
    expect(
      () =>
        new EvmBlockchainGateway({
          rpcUrl: "http://localhost:8545",
          contractAddresses: {
            ...CONTRACT_ADDRESSES,
            payRouter: CONTRACT_ADDRESSES.escrow,
          },
        }),
    ).toThrow("contractAddresses must contain unique contract addresses");
  });
});
