# XRPName native contracts — community review

XRPName proposes an XRPL native registry whose canonical names, ownership evidence, receiving addresses, text records and verified primary selections can be read from a validated ledger. For direct issuance, the contract would enforce availability and registration policy in the transaction that assigns ownership. Existing XRPName NFTs can keep their current custody model through verified on-chain bindings. [Protocol specification](SPEC.md) · [XRPName migration draft](xrpname-migration.md)

Standalone v2 verifies dynamic TLDs, unique registration, owner-only text and receiving-address writes, and validated-ledger reads. Primary names, transfer and burn, paid issuance and NFT adoption remain proposed. [Function reference](contract-functions.md) · [Standalone evidence](../deployments/local-v2.json)

## Questions for reviewers

1. Which operations and ownership modes should the first production deployment enable?
2. How should protocol governance authorize changes to code, namespace policies and reserved names? How will authority handoffs be visible to clients?
3. How should an XRPL payment record represent a destination tag, and what should clients return when an explicit receiving record is missing or stale?
4. How should storage reserves be funded as the registry grows? Which measured limits would warrant splitting state into several ledger objects?
5. What ledger evidence should an adoption profile require to preserve legacy NFT ownership and invalidate records after every custody change?

## Conformance cases

| Case | Expected result |
| --- | --- |
| Competing registrations and case variants | One canonical name and one owner |
| Same label under different active suffixes | Independent ownership and records |
| TLD added, paused and resumed | Enrollment changes without a code rebuild. Existing names stay resolvable |
| Unauthorized mutation or failed persistence | Previous confirmed state is preserved |
| Transfer, burn or reacquisition | Records and primary selections from the previous ownership revision lose authority |
| Missing receiving record | Wallet resolution reports no explicit receiving address |
| Unavailable ledger or conflicting ownership evidence | Verification fails |
| Legacy NFT moves during adoption | Resolver returns validated current custody. The legacy name remains reserved against duplicate issuance |
