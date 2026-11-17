# XRPName adoption and migration

**Status** Proposed deployment profile for the [XRPName Native Name Service Specification](SPEC.md).

## Preserve identity and wallet semantics

The existing XRPName model associates a name with an XLS-20 NFTokenID and derives the name from the token URI. A buyer obtains ownership when the offer is accepted. Preserve each existing name's binding to a recognized issuer and NFTokenID. Resolve owner from current validated NFT custody. An owner captured during import will become stale after a transfer. Preserve metadata URIs and marketplace behavior as part of compatibility. [XRPName technical reference](https://docs.xrpdomains.xyz/getting-started/technical)

Keep three independent relationships in the resolver.

| Relationship | Meaning |
| --- | --- |
| Full name → owner | Current verified NFT owner for existing names. Authority for newly issued names is declared by the deployment profile |
| Full name → receiving address | Explicit payment record for the requested network or asset. Preserve documented legacy endpoint behavior in a compatibility adapter |
| Wallet → primary name | Selected reverse name, returned as verified only when the wallet still owns it at the same validated ledger |

## Rollout

1. Inventory recognized issuers, token collections, parser and normalization versions, and current API outputs. Reconcile paid orders, minted-but-unaccepted names and pending transfers. Pin a validated ledger for the inventory. Keep an explicit exception list for ambiguous URI variants and canonical collisions. The legacy technical guide describes UTS-46 and its parser; test actual historical data before mapping any name to the new ASCII rules.
2. Reserve all verified legacy names and unresolved paid reservations against new issuance. Import verified name-to-token bindings in resumable batches and replay relevant events from the snapshot to the cutover ledger. Do not let a missing or failed lookup mark a legacy name available. Disable legacy issuance for each namespace before enabling contract-backed issuance for that namespace, or enforce a shared reservation authority during overlap.
3. Run the compatibility resolver in shadow mode. Compare owner, explicit payment records, reverse lookup and missing/error behavior at a pinned validated ledger. Verify an NFT transfer or burn between inventory and cutover. A transferred NFT resolves to the current holder. A burned or ambiguous NFT cannot authorize a write or silently fall through to a new registration.
4. Switch reads after discrepancies are resolved. For an adopted name, a contract record update must verify current NFT custody during execution and bind the record to an ownership epoch so stale records cannot regain authority after reacquisition. If the released runtime cannot verify custody and ownership changes reliably, keep writes for existing NFT names on the legacy path. Preserve record provenance and define when an explicit deletion suppresses fallback. Keep a rollback route for reads that can still resolve names issued by both systems.

An explicit migration to contract-only ownership is a separate option. It requires a holder-authorized transaction and a proven mechanism that prevents the legacy token from continuing to convey the same name independently. The first rollout can keep NFT custody authoritative for existing names and avoid asking holders to re-register or pay again.
