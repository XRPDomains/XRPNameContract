# XRPName Native Name Service Specification

**Status** Draft for community review. This document defines the proposed protocol for a future XRPName deployment on XRPL Mainnet. The **standalone v2** implementation verifies registration, ownership lookup, keyed text, receiving addresses and dynamic TLD administration on an experimental XLS-101 node. Primary names, lifecycle operations, paid issuance and adoption of existing NFTs are **proposed**. The production ABI and storage layout depend on the released runtime. [XLS-101](https://xls.xrpl.org/xls/XLS-0101-smart-contracts.html) · [Standalone ABI and storage](contract-functions.md) · [Validated evidence](../deployments/local-v2.json)

The words **must** and **must not** describe protocol requirements. Proposed function names below specify behavior. Their final transaction encodings will be published with the production deployment profile.

## 1. On-chain authority

Given the designated deployment and a validated XRPL ledger, a wallet must be able to determine a name's registration status, owner, records and verified primary selection using ledger data. Applications may build discovery, portfolio and search services over this state. An index may guide a lookup, but the returned identity or payment address must be verifiable at the stated ledger.

| Concern | Existing XRPName documented flow | Proposed native flow |
| --- | --- | --- |
| Name and registration | Checkout takes an XRPL payment, then an application order coordinates reservation, NFT mint and offer acceptance | The contract validates namespace, availability, authority and any applicable payment rule. For direct issuance, a single confirmed transaction commits the registration and payment or rejects both, subject to the XRPL transaction fee |
| Existing NFT ownership | Recognized XLS-20 NFT custody establishes ownership. The URI identifies the name under XRPName's rules | Preserve an explicit on-chain root-name-to-NFTokenID binding. Read current validated NFT custody from the same ledger as the binding |
| Address, text and primary lookup | XRPName clients retrieve records through SDK and API surfaces | Store canonical records and primary selections in contract state. Validate agreement with the owner before returning a verified result |
| Profile rendering and discovery | Product APIs, URI metadata and public profiles | These remain application services. When storing an avatar or content URI on-chain, ledger verification covers the reference. The referenced content has its own availability and integrity properties |

The current-service column describes the documented public flow. It makes no assertion about the storage location of every legacy record. [Existing XRPName technical reference](https://docs.xrpdomains.xyz/getting-started/technical) · [Legacy adoption profile](xrpname-migration.md)

## 2. Contract organization

A deployment publishes a manifest that identifies its XRPL network, contract account, accepted code and ABI versions, state schema, namespace policy and ownership modes. Clients select that deployment explicitly. Identical names can exist in separate deployments.

One logical registry owns the write path. The implementation may split data across ledger objects if the runtime preserves authorization and atomicity across all affected writes.

| Component | Responsibility | Principal state |
| --- | --- | --- |
| Namespace administration | Add a TLD, pause or resume issuance, apply explicit policy versions | Governance authority, TLD status, reservations and policy reference |
| Registry | Canonical identity, uniqueness, ownership and lifecycle | Name key, ownership mode and binding, lifecycle status, ownership revision |
| Resolver | Owner-authorized text and receiving-address records | Name key, ownership revision, typed keys and values |
| Reverse resolver | Account-selected verified primary | AccountID, name key, ownership revision |
| Adoption | Bind existing XRPName names to recognized NFT identity | Canonical name, recognized issuer, NFTokenID and migration provenance |

These are logical components. Standalone v2 puts a per-name record blob and TLD flags in a single global `ContractData` object. Production storage must support bounded lookup and mutation costs. Select the physical layout after measuring object limits, read amplification and reserve growth on the target build.

## 3. Name and namespace rules

A root name is `<label>.<tld>` with exactly one dot. Fold the ASCII letters A–Z to lowercase. Labels contain 1–57 ASCII letters, digits or hyphens, with alphanumeric endpoints. TLDs contain 2–8 ASCII letters or digits. Reject whitespace, non-ASCII input, empty components and extra dots. The protocol requires the full name. Wallets may offer a default suffix and show the full name before signing.

The full canonical name is unique within the deployment. A shared label across two TLDs creates separate names. A reserved name rejects public registration. Standalone v2 uses a compile-time reserved label list. A release must publish any reservation policy and define who can change it and when it takes effect.

A TLD has one of three externally observable states: unconfigured, active or paused. Governance can add an unconfigured TLD as active and change the status of an existing TLD. A case variant of a configured suffix is a duplicate. Pausing affects issuance only. Existing names, resolution and authorized lifecycle actions remain available. Preserve TLD identity across pause and resume. Removing a published namespace requires an explicit migration policy. A TLD does not imply a payment currency. Standalone v2 keeps an implicit active `xrp` default for v1 compatibility. A production deployment should publish an explicit genesis TLD table.

## 4. Ownership and lifecycle

### Direct registration

The contract validates the name, namespace, reservation and any payment rule in the transaction that grants the name. The transaction sender becomes owner of a direct registration. Two competing registrations for the same name cannot both succeed. Failed preconditions leave prior name and application-payment state unchanged, subject to XRPL transaction fees. Whether the first production profile charges for registration and which assets it accepts remain policy decisions.

### NFT-backed adoption

Bind the name to an authorized issuer and a unique NFTokenID. The adopted name's effective owner is the NFT holder at the ledger used for verification. A snapshot owner cannot authorize a later write. When authority cannot be verified during contract execution, the deployment must keep the legacy write path or disable native writes for that ownership mode. An absent or burned bound NFT must never reactivate eligibility for ordinary public registration on its own.

### Transfer, burn and record lifetime

For direct registration, the proposed transfer flow lets the owner create a recipient-bound offer with a ledger expiry. The owner may cancel it. The recipient accepts a live offer from the current ownership revision. Acceptance changes owner, invalidates the offer, clears previous-owner records and invalidates the affected primary selection atomically. Burn is owner-authorized and retires the name and its active records. A later specification may permit re-registration after burn with an explicit policy, fresh revision and empty records.

Every ownership change invalidates previous revisions, including when a former owner reacquires the same name. Clearing one name's primary selection must preserve a user's newer selection. An adopted NFT may transfer through the native market. Before enabling native record writes for adopted names, the release must define how it establishes a change of custody even when a name leaves and returns to the same wallet between two reads. Address equality alone cannot establish continuity.

## 5. Read interface

Readers operate at a validated ledger selected by hash or by validated tip and return the ledger identity used. Multi-object reads must use the same ledger hash. Missing data and unavailable evidence have distinct outcomes. A missing required object, malformed schema, conflicting binding or unavailable ledger must fail verification. An unregistered name is a normal lookup result when its absence can be verified.

| Logical read | Result and validation |
| --- | --- |
| `getNamespace(tld)` / `listNamespaces(cursor?)` | Canonical TLD, issuance status and applicable policy version. Paginate against the same ledger hash |
| `getName(name)` | Canonical name, status, ownership mode, verified owner when registered and ownership revision. Unknown and retired names are distinguishable |
| `getOwner(name)` | Verified XRPL account for an active registration, or no owner for an absent or retired name |
| `getText(name,key)` | Valid UTF-8 for the requested key or no record |
| `getAddress(name,coinType)` | Explicit receiving record in its specified encoding or no record. An absent payment record stays empty even if the owner is known |
| `getRecordKeys(name,cursor?)` | Enumerate text keys and address types at one validated ledger |
| `getPrimary(account)` | Canonical name only if the account selected it and the account still owns it at the same ledger |

The current SDK presents simpler results and queries `ledger_entry` on the pinned node. It does not expose the full production read contract, including ledger-pinned pagination.

## 6. Write interface

The contract derives caller identity from the XRPL transaction. The client specifies a deployment, function and typed parameters. A submitted transaction is pending until validation. A successful SDK receipt must bind to the signed hash and expected deployment, confirm execution success and include its validated ledger. A timeout preserves the hash so the caller can check status before attempting a fresh transaction.

| Operation | Caller and preconditions | Confirmed effect | Status |
| --- | --- | --- | --- |
| `register(name)` | Sender. Valid, active, available name | Create owner binding and empty records | Standalone v2, without application payment |
| `setText(name,key,value)` / `clearText(name,key)` | Verified current owner | Change or remove one text key under the current ownership revision | Standalone v2, direct ownership |
| `setAddress(name,coinType,value)` / `clearAddress(name,coinType)` | Verified current owner | Change or remove one receiving record under the current ownership revision | Standalone v2, direct ownership |
| `addNamespace(tld)` / `setNamespaceStatus(tld,status)` | Configured governance authority | Add or change issuance status | Standalone v2 as `add_tld` / `set_tld_status` |
| `setPrimary(name)` / `clearPrimary()` | Account setting its own selection. Setting requires verified ownership | Replace or clear one account's primary selection | Proposed |
| `offerTransfer(name,recipient,expiry)` / `cancelTransfer(name)` | Verified owner for direct registrations | Create or cancel an offer bound to the current revision | Proposed |
| `acceptTransfer(name,offerId)` | Intended recipient. Offer live and current | Change owner and invalidate old records and primary state | Proposed |
| `burn(name)` | Verified owner for direct registrations | Retire name and invalidate its records and primary state | Proposed |
| `bindLegacyName(name,tokenId,evidence)` | Authorized adoption path with recognized NFT and verified binding | Import the legacy identity once without rewriting existing custody | Proposed |

For standalone values, text keys are 1–40 ASCII letters, digits, dots, underscores or hyphens and normalize to lowercase. Text values contain 1–128 valid UTF‑8 bytes. Empty input requires an explicit clear operation. Receiving records are 1–128 bytes keyed by a uint16 coin type. A production profile must define typed address encoding and how it represents XRPL destination tags. Standalone coin type 144 encodes an untagged 20-byte classic AccountID in the typed helper. The wire ABI, errors and actual byte limits are documented separately. [Standalone function reference](contract-functions.md)

## 7. Mainnet release criteria

- Verify the enabled amendment, host functions, transaction codec and state-read RPCs on the target validator release. Match independent node readbacks at the same validated ledger.
- Test custody and lifecycle invariants. Include concurrent registration, owner changes before execution, unauthorized mutations, transfer expiry, reacquisition, burn, stale primary, and replay.
- Measure reserves per name and per record, full-namespace growth, lookup costs and behavior when storage limits or reserve fail mid-operation. Inspect both receipts and post-transaction state.
- Publish authority and upgrade rules. State who can change namespace policies or code, how keys rotate, how schema and resolver versions are negotiated, and how migration is verified. A rollout must keep resolving all previously accepted names.
- For XRPName adoption, rehearse legacy reservations, transfers during cutover, ownership continuity, mismatched records and recovery. [XRPName migration](xrpname-migration.md)

## 8. References

ENS specifications inform forward and reverse resolution and typed record interfaces. Historical XahauName vectors informed early validation and lifecycle test cases. [ENS Improvement Proposals](https://docs.ens.domains/ensip/) · [Conformance provenance](compatibility.md)
