# Contract function reference

This reference covers the second standalone milestone. The [protocol specification](SPEC.md) covers the production design and proposed operations. The [migration profile](xrpname-migration.md) covers how XRPName could adopt it for existing XLS-20 names. Use the [ABI](../contract/build/abi.json) for transaction signing and the [README](../README.md) for node setup and tests.

## Names and authority

Supply a complete root name, such as `alice.xrp` or `alice.dev`. The contract folds ASCII uppercase to lowercase. Labels contain 1–57 ASCII letters, digits or internal hyphens, with alphanumeric endpoints. Suffixes contain 2–8 ASCII letters or digits. The reserved labels are `admin`, `root`, `treasury`, `www`, and `xahau`. Each full canonical name is unique in a deployment. A single label can have different owners under different suffixes.

The sender of a successful registration becomes owner. Existing names remain readable and owners can change records when a suffix is paused. Registration checks the suffix status on-chain. A governance account, set as deployment instance parameter 1, can add a suffix or change its status. The preceding instance parameter funds the pseudo-account reserve using `tfSendAmount`. For compatibility, `xrp` is initially enabled by default and can be overridden by a stored status. All other suffixes must be added explicitly.

## Writes

Every function is called through `ContractCall`. Parameters are type `VL` and have parameter flag zero. The SDK encodes function names and parameter bytes as uppercase hex for the pinned transaction codec. It returns `{ hash, ledgerIndex }` after validating `tesSUCCESS` and WASM return code zero.

| ABI function | SDK method | Parameters and behavior | Authority |
| --- | --- | --- | --- |
| `register(name)` | `register(name)` | Register a full canonical name under an active suffix | Transaction sender becomes owner |
| `set_text(name,value)` | `setText(name,value)` | Replace the `description` record. This signature remains compatible with PoC v1 | Owner |
| `set_text_record(name,key,value)` | `setText(name,key,value)` | Store or replace a named UTF-8 record | Owner |
| `clear_text(name,key)` | `clearText(name,key?)` | Remove a text record. A missing key is an idempotent clear when the name exists | Owner |
| `set_address(name,coin,value)` | `setAddr(name,coinType,bytes)` | Store a binary receiving address. Coin type is two bytes, unsigned big-endian | Owner |
| `clear_address(name,coin)` | `clearAddr(name,coinType)` | Remove one receiving record. A missing record is an idempotent clear when the name exists | Owner |
| `add_tld(suffix)` | `addTld(tld)` | Add and enable a canonical suffix. Send the suffix without its dot | Governance account |
| `set_tld_status(suffix,enabled)` | `setTldStatus(tld,enabled)` | Pause or resume an existing suffix with byte `00` or `01` | Governance account |

Text keys are 1–40 ASCII letters, digits, dots, underscores or hyphens and normalize to lowercase. Text values are 1–128 valid UTF-8 bytes. Address records contain 1–128 bytes and use coin types 0–65535. The typed `setAddress(name,address)` helper encodes a classic XRPL address as 20 bytes under coin type 144. The raw `setAddr` API enforces byte bounds, and applications validate chain-specific formats. Each mutation updates one ledger field atomically.

## Reads

These SDK methods use `ledger_entry` at a validated ledger. All results for a single name lookup come from one state object.

| SDK method | Result |
| --- | --- |
| `getOwner(name)` | Classic XRPL owner address or `null` |
| `getText(name,key?)` | Strict UTF-8 text or `null`. The default key is `description` |
| `getAddr(name,coinType)` | Binary receiving address or `null` |
| `getAddress(name)` | Classic XRPL receiving address at coin type 144 or `null`. A malformed stored XRPL record fails decoding |
| `getRecordKeys(name)` | `{ textKeys, coinTypes }`. Both lists are empty for an unregistered name |
| `getTldStatus(tld)` | `true` for enabled, `false` for paused, `null` for unconfigured |
| `listTlds()` | Sorted `{ tld, enabled }` entries from one validated ledger view |

Owner lookup and receiving-address lookup have independent semantics. An unset receiving record returns `null` even when the name is registered.

## State layout

The pinned node stores global `ContractData` at SHA512Half of `u16be(0x62) || pseudoAccountID20 || pseudoAccountID20`. The SDK verifies the node type and identity before decoding `ContractJson`.

| Object field | Value |
| --- | --- |
| `tld:<suffix>` | `01 || enabledByte`. Missing `tld:xrp` means enabled. Other absent TLDs are unconfigured |
| `<full-name>` v1 | `01 || owner20 || optional UTF-8 description` |
| `<full-name>` v2 | `02 || owner20 || zero or more packed records` |

A v2 record uses `kind:u8 || keyLength:u8 || valueLength:u8 || key || value`. Kind 1 is text with an ASCII key. Kind 2 is an address with a two-byte coin key. Records sort by kind and then by raw key bytes, with unique keys per kind. A new registration stores an empty v2 list. The SDK can read v1, and a successful record mutation rewrites that entry to v2 while preserving owner and existing description. This state-layer compatibility is covered by the offline harness. In-place `ContractModify` has its own deployment and ABI requirements.

There can be up to 15 text and 15 address records per name, with a combined value limit of 4,093 bytes including the header and record framing. This bound accommodates the pinned host's 4,096-byte parameter limit for the serialized field. Maximal entries can reach the byte limit before all slots are used. Clearing a record removes its bytes from the field.

## WASM return codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `-3` | Invalid record argument |
| `-10` | Invalid or reserved root name |
| `-11` | Name unregistered |
| `-12` | Sender is not the name owner |
| `-20` | Storage failure or malformed state |
| `-31` | Name or TLD already exists |
| `-33` | TLD is unconfigured or registration is paused |
| `-36` | Malformed suffix or status |
| `-40` | Sender lacks TLD administration authority |
| `-62` | Record count or serialized capacity exhausted |

## Deployment scope

XLS-20 ownership adoption, primary, transfer, burn, paid issuance, profile batching and reconciliation belong to future milestones. Global `ContractData` size, reserve exhaustion and in-place deployment upgrades need further testing before production.
