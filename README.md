# XRPName-Contract

XRPName-Contract prepares XRPName for XRPL native smart contracts under the XLS-101 draft. The goal is to make registration, ownership, payment records and verified primary names independently verifiable from the ledger. The current code is a standalone implementation of registration, dynamic TLDs, text and receiving-address records.

- [Protocol specification](docs/SPEC.md) covers contract organization, on-chain authority, lifecycle, read/write semantics and release criteria.
- [Community review](docs/community-review.md) lists questions and conformance cases.
- [Standalone function reference](docs/contract-functions.md) documents the compiled ABI and actual storage format.
- [XRPName migration](docs/xrpname-migration.md) covers existing names and XLS-20 ownership.

## Build and test

Use Ubuntu WSL on x86-64 with Rust 1.89.0 and Node.js 20.20.2 or a compatible later Node.js release. The Cargo and npm lockfiles pin the contract and SDK dependencies.

```sh
rustup toolchain install 1.89.0 --profile minimal --target wasm32v1-none
cargo +1.89.0 build --manifest-path contract/Cargo.toml --locked --release --target wasm32v1-none
npm ci
npm test
bedrock abi inspect contract/build/abi.json
bedrock doc --output .local/abi-doc
```

The deployable binary is `contract/target/wasm32v1-none/release/xrpname_contract.wasm`. The offline suite instantiates it with host stubs, checks the exports against the ABI, runs normalization, authority and storage boundary vectors, exercises the pinned transaction codec, and checks the SDK's validated-ledger read path with a loopback fixture.

[Bedrock](https://github.com/XRPL-Commons/bedrock) revision `ff657ad24e5e4956f8eb2a7b63233551f2698f5a` generates the ABI reference from Rust annotations and inspects the checked-in ABI. Its `build` command selects `wasm32-unknown-unknown` for contracts. The tested node rejected that artifact during module loading. The commands above select the WebAssembly MVP target explicitly. The Rust host bindings come from [Craft](https://github.com/Transia-RnD/craft/tree/ffbe88da26df27e59a72b6202883f42f696933cc) revision `ffbe88da26df27e59a72b6202883f42f696933cc`. The transaction codec comes from `@xrpl-commons/xrpl@4.6.0`.

For coding agents, Bedrock provides a [tooling reference](https://github.com/XRPL-Commons/bedrock/blob/main/llms.txt) and [agent workflow instructions](https://github.com/XRPL-Commons/bedrock/blob/main/CLAUDE.md). Those references track upstream. Use this repository's pinned build, standalone network and receipt checks when reproducing this PoC.

## Start a standalone node

Use the amd64 image digest in the local profile. The image contains `/usr/local/bin/rippled`, which can run directly on Ubuntu 24.04 WSL with `libgmp10` installed. With a working Docker daemon, extract it without starting a container.

```sh
mkdir -p .local
image=$(node -p "require('./networks/local.json').nodeImage")
container=$(docker create --platform linux/amd64 "$image")
docker cp "$container:/usr/local/bin/rippled" .local/rippled
docker rm "$container"
chmod +x .local/rippled
bash scripts/start-local.sh .local/rippled run-1
```

If the extracted binary from the first run is already present, use `.local/image/usr/local/bin/rippled` as the argument to `scripts/start-local.sh`.

The node binds HTTP to `127.0.0.1:5005` and WebSocket to `127.0.0.1:6006`. Use a fresh work directory name to start with a clean ledger. In a second WSL terminal, close an initial ledger, confirm the build and amendment, and run the PoC.

```sh
curl -fsS -H 'Content-Type: application/json' -d '{"method":"ledger_accept"}' http://127.0.0.1:5005
npm run probe
read -rs -p 'Disposable standalone genesis seed: ' XRPNAME_LOCAL_GENESIS_SEED; printf '\n'
export XRPNAME_LOCAL_GENESIS_SEED
npm run poc
unset XRPNAME_LOCAL_GENESIS_SEED
```

Use the public standalone genesis fixture for account `rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh` from the pinned Bedrock deploy module. The script creates two ephemeral wallets in memory. It closes ledgers, funds the wallets, deploys the contract, and runs both positive and negative transactions. The deployment uses a `tfSendAmount` instance parameter to fund contract storage reserves from the deployer. A direct Payment to the pseudo-account returned `tecNO_PERMISSION` on the pinned node. After all assertions pass, the script writes public addresses, transaction hashes and validated ledger indices to [deployments/local-v2.json](deployments/local-v2.json), including record readback, TLD changes and the result of two wallets competing for one name. Re-running it replaces that report. Set `XRPNAME_RPC` to use another HTTP port on `127.0.0.1`.

## SDK and storage

Create an `XRPNameClient` with `{ rpcUrl, contractAccount }` and an optional `Signer`. A signer supplies a classic address and signs the prepared transaction. Serialize writes per signing account so each can use the next ledger sequence.

The SDK exposes registration, ownership, text and receiving-address lookup, record updates and clearing, and TLD discovery and administration. The [function reference](docs/contract-functions.md) lists the full SDK, ABI, state layout, deployment parameter order and errors. The contract derives owner authority from transaction Account. Writes use the pinned local fee, computation allowance and wrapped Parameters STArray elements.

Reads request ledger_entry at the validated ledger and verify the identity of ContractData. The original standalone run is available in [deployments/local.json](deployments/local.json), and the current milestone has a separate evidence file.

## Before mainnet

Confirm the finalized amendment, WASM host ABI, transaction/metadata codecs, and validated read semantics against the intended validator build and independent nodes. The local proof uses one standalone node. Stress-test competing submissions, replays, reserve exhaustion, rollback under host and finalization errors, data size limits, and long-term growth of the global object. Define deployment authority, storage funding, upgrade/migration, and failure recovery before production. NFT identity, transfer, burn, primary names, and indexing are future milestones.
