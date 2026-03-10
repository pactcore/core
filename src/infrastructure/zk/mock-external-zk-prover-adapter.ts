import { DeterministicLocalZKProverAdapter, type DeterministicLocalZKProverAdapterOptions } from "./deterministic-local-zk-prover-adapter";

export class MockExternalZKProverAdapter extends DeterministicLocalZKProverAdapter {
  constructor(options: DeterministicLocalZKProverAdapterOptions | string = "mock-external-zk-prover") {
    super(options);
  }
}
