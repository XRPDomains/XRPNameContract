# XRPL native name service

**Status** Draft for community review. The proposal defines a name service on XRPL native contracts. XRPName is an intended adopter. The existing standalone PoC verifies registration, owner lookup and one owner-controlled text record under a fixed suffix. The second standalone milestone implements dynamic TLD status, keyed text and separate address records. The rest of the lifecycle below is proposed. [Contract reference](contract-functions.md) [PoC evidence](../deployments/local.json) · [XLS-101 draft](https://xls.xrpl.org/xls/XLS-0101-smart-contracts.html)

## Names and namespaces

A root name is `<label>.<tld>`. Fold ASCII uppercase to lowercase before deriving identity. A label has 1–57 ASCII letters, digits or internal hyphens. Its endpoints are alphanumeric. A TLD has 2–8 ASCII letters or digits. Protocol calls require the complete name. Reject whitespace, Unicode, empty labels, extra dots and unconfigured TLDs. Applications may suggest a suffix and show the resulting full name before signing.

Within a registry instance, the canonical full name is the identity. The same label under different TLDs can have different owners and records. A deployment is identified by its network and contract account. A resolver must use the configured deployment because a different contract can register the same spelling. Subdomains are outside the initial protocol.

## Dynamic TLD management

The contract maintains a TLD table in ledger state. An authorized governance account can add a canonical suffix, pause new registrations and resume registrations. The SDK discovers the configured suffixes and their status from confirmed ledger data. Adding a suffix requires no code change. A case variant of an existing suffix is a duplicate.

A pause affects new registrations only. Existing names continue to resolve, and their owners can manage records and exercise the supported lifecycle. The contract retains paused TLD entries and the identities they contain. Removing a namespace with issued names would require an explicit migration specification. Record TLD and authority changes in ledger-visible history.

For review, define how governance keys are rotated, how actions are audited, and whether registration policy is global or per TLD. Reservation, pricing and payment assets should be explicit policy inputs. A suffix by itself carries no payment-asset semantics.

## Registration and ownership

Registration checks canonical identity, TLD status, applicable reservation and payment policy, and availability as part of the ledger transaction. Only one competing registration can succeed for a canonical name. Any rejected registration must leave the prior registry and payment state intact, subject to XRPL transaction fees. Publish application errors for invalid names, unavailable namespaces, reserved names, duplicates and unsuccessful payment or storage operations.

Each registered identity must have one authoritative owner. A deployment must specify where that authority lives and how ownership is verified. The standalone profile stores the submitting account directly. A deployment that uses an existing NFT as authority must specify the recognized issuer, token-to-name binding and the ledger evidence for current custody. Mutable metadata is insufficient authority.

## Records, resolution and primary names

- **Owner lookup** returns the authoritative XRPL account at a validated ledger, or no result for an unregistered name. Malformed or contradictory state is an error.
- **Records** are owner-controlled. Define supported keys, encodings, byte limits and deletion semantics. Start with bounded UTF-8 text and a distinct typed receiving-address record. An explicit missing receiving record returns no result. A payment adapter must document any rule that uses ownership to choose a receiving address.
- **Primary names** resolve a wallet address back to a name selected by that wallet. The resolver verifies the selection and current name ownership at the same validated ledger. Transfer or burn must clear a primary selection pointing to the affected name without clearing a newer selection.
- **Ledger consistency** requires multi-object resolution to use one validated ledger. Indexers may provide discovery and search. Ownership and payment-routing guarantees must identify the ledger and authority they rely on.

## Lifecycle and compatibility

The proposed transfer baseline changes ownership and clears previous-owner records and primary references. Burn clears ownership, records and primary references. Whether a burned name can be registered again is an open policy decision. If an implementation uses native token transactions with separate finalization, specify intermediate states, the reader behavior during inconsistency, and the recovery procedure. Expiry and renewal need separate policy and tests.

XRPName adoption needs a deployment profile covering authoritative existing registrations, ownership continuity, pending orders, resolver compatibility and cutover. Define that profile after agreement on the core rules. The protocol needs a versioned state layout, stable receipt and error semantics, storage-reserve policy and an upgrade procedure. A deployment must verify host ABI and ledger behavior against its intended node build.

## Conformance cases

| Case | Expected result |
| --- | --- |
| Add a valid TLD, then register a name under it | Succeeds without rebuilding the contract |
| Add a duplicate suffix or change its status from an unauthorized wallet | Fails without changing namespace state |
| Pause and resume a TLD with existing names | New registrations fail during pause and resume afterward. Existing names retain ownership and resolution |
| Register case variants or race two wallets for the same full name | Exactly one owner is recorded |
| Register the same label under distinct active TLDs | Both entries resolve independently |
| Update a record from a different wallet | Fails and the previous value remains visible on a validated ledger |
| Transfer or burn a name with records and a primary selection | Previous-owner records and affected primary references are cleared. Unrelated names and newer selections are preserved |
| Resolve missing data or conflicting ownership evidence | Missing data returns no result. Conflicting evidence fails resolution |

## Design references

XahauName provides the baseline for ASCII validation, duplicate guards, owner authorization, record cleanup, primary consistency and lifecycle recovery cases. ENS provides references for separating registry identity from resolution and specifying normalization, text, addresses and primary names independently. XRPL storage, transaction rules and migration need their own deployment-level specification. [XahauName compatibility notes](compatibility.md) · [ENS Improvement Proposals](https://docs.ens.domains/ensip/)

See also [the proposed XRPName adoption and migration profile](xrpname-migration.md).
