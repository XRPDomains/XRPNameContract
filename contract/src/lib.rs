#![cfg_attr(target_arch = "wasm32", no_std)]

mod records;

use xrpl_wasm_macros::wasm_export;
use xrpl_wasm_std::core::type_codes::{STI_ACCOUNT, STI_VL};
use xrpl_wasm_std::host::{
    cache_ledger_obj, compute_sha512_half, error_codes, function_param, get_data_object_field,
    get_tx_field, instance_param, set_data_object_field,
};

const INVALID_RECORD: i32 = -3;
const INVALID_NAME: i32 = -10;
const NOT_FOUND: i32 = -11;
const NOT_OWNER: i32 = -12;
const STATE_ERROR: i32 = -20;
const DUPLICATE: i32 = -31;
const TLD_INACTIVE: i32 = -33;
const INVALID_TLD: i32 = -36;
const NOT_ADMIN: i32 = -40;
const RECORDS_FULL: i32 = -62;
const MAX_NAME: usize = 66;
const MAX_TLD: usize = 8;
type Account = [u8; 20];
type Outcome = Result<(), i32>;

fn argument(index: i32, buffer: &mut [u8], error: i32) -> Result<&mut [u8], i32> {
    let len = unsafe { function_param(index, STI_VL.into(), buffer.as_mut_ptr(), buffer.len()) };
    if len <= 0 || len as usize > buffer.len() {
        return Err(error);
    }
    Ok(&mut buffer[..len as usize])
}

fn valid_tld(tld: &[u8]) -> bool {
    (2..=MAX_TLD).contains(&tld.len()) && tld.iter().all(u8::is_ascii_alphanumeric)
}

fn name(buffer: &mut [u8; MAX_NAME]) -> Result<(&[u8], &[u8]), i32> {
    let full = argument(0, buffer, INVALID_NAME)?;
    full.make_ascii_lowercase();
    let dot = full
        .iter()
        .position(|byte| *byte == b'.')
        .ok_or(INVALID_NAME)?;
    let label = &full[..dot];
    let tld = &full[dot + 1..];
    if !(1..=57).contains(&label.len())
        || !label[0].is_ascii_alphanumeric()
        || !label[label.len() - 1].is_ascii_alphanumeric()
        || !label
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
        || matches!(label, b"xahau" | b"treasury" | b"admin" | b"root" | b"www")
        || !valid_tld(tld)
    {
        return Err(INVALID_NAME);
    }
    Ok((full, tld))
}

struct Call {
    sender: Account,
    contract: Account,
    has_state: bool,
}

impl Call {
    fn load() -> Result<Self, i32> {
        let sender = Self::account((8 << 16) | 1)?;
        // ContractAccount is AccountID field 27 on the pinned node.
        let contract = Self::account((8 << 16) | 27)?;
        let mut input = [0; 42];
        input[1] = b'b';
        input[2..22].copy_from_slice(&contract);
        input[22..].copy_from_slice(&contract);
        let mut index = [0; 32];
        if unsafe { compute_sha512_half(input.as_ptr(), input.len(), index.as_mut_ptr(), 32) } != 32
        {
            return Err(STATE_ERROR);
        }
        let has_state = match unsafe { cache_ledger_obj(index.as_ptr(), 32, 0) } {
            error_codes::LEDGER_OBJ_NOT_FOUND => false,
            slot if slot > 0 => true,
            _ => return Err(STATE_ERROR),
        };
        Ok(Self {
            sender,
            contract,
            has_state,
        })
    }

    fn account(field: i32) -> Result<Account, i32> {
        let mut account = [0; 20];
        if unsafe { get_tx_field(field, account.as_mut_ptr(), 20) } != 20 {
            return Err(STATE_ERROR);
        }
        Ok(account)
    }

    fn require_admin(&self) -> Outcome {
        // Instance parameter 0 funds reserve. Parameter 1 is the governance AccountID.
        let mut admin = [0; 20];
        let len = unsafe { instance_param(1, STI_ACCOUNT.into(), admin.as_mut_ptr(), 20) };
        if len != 20 || admin != self.sender {
            return Err(NOT_ADMIN);
        }
        Ok(())
    }

    fn read<'a>(&self, key: &[u8], bytes: &'a mut [u8]) -> Result<Option<&'a [u8]>, i32> {
        if !self.has_state {
            return Ok(None);
        }
        let len = unsafe {
            get_data_object_field(
                self.contract.as_ptr(),
                20,
                key.as_ptr(),
                key.len(),
                bytes.as_mut_ptr(),
                bytes.len(),
            )
        };
        if len == error_codes::INVALID_FIELD {
            return Ok(None);
        }
        if len <= 0 || len as usize > bytes.len() {
            return Err(STATE_ERROR);
        }
        let encoded = &bytes[..len as usize];
        let (prefix, length) = match encoded {
            [n @ 0..=192, ..] => (1, *n as usize),
            [hi @ 193..=240, lo, ..] => (2, 193 + ((*hi as usize - 193) << 8) + *lo as usize),
            _ => return Err(STATE_ERROR),
        };
        if encoded.len() != prefix + length {
            return Err(STATE_ERROR);
        }
        Ok(Some(&encoded[prefix..]))
    }

    fn write(&self, key: &[u8], payload: &[u8]) -> Outcome {
        let mut encoded = [0; 3 + records::MAX_PAYLOAD];
        encoded[0] = STI_VL;
        let start = if payload.len() <= 192 {
            encoded[1] = payload.len() as u8;
            2
        } else {
            let size = payload.len() - 193;
            encoded[1] = 193 + (size >> 8) as u8;
            encoded[2] = size as u8;
            3
        };
        let end = start + payload.len();
        encoded[start..end].copy_from_slice(payload);
        let result = unsafe {
            set_data_object_field(
                self.contract.as_ptr(),
                20,
                key.as_ptr(),
                key.len(),
                encoded.as_ptr(),
                end,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(STATE_ERROR)
        }
    }

    fn tld_status(&self, suffix: &[u8]) -> Result<Option<bool>, i32> {
        let mut key = [0; 4 + MAX_TLD];
        let mut bytes = [0; 4];
        match self.read(tld_key(suffix, &mut key), &mut bytes)? {
            Some([1, 0]) => Ok(Some(false)),
            Some([1, 1]) => Ok(Some(true)),
            Some(_) => Err(STATE_ERROR),
            // Preserve registration compatibility for v1 deployments.
            None if suffix == b"xrp" => Ok(Some(true)),
            None => Ok(None),
        }
    }
}

fn tld_key<'a>(suffix: &[u8], key: &'a mut [u8; 4 + MAX_TLD]) -> &'a [u8] {
    key[..4].copy_from_slice(b"tld:");
    key[4..4 + suffix.len()].copy_from_slice(suffix);
    &key[..4 + suffix.len()]
}

fn update_tld(status: Option<bool>) -> Outcome {
    let call = Call::load()?;
    call.require_admin()?;
    let mut input = [0; MAX_TLD];
    let suffix = argument(0, &mut input, INVALID_TLD)?;
    if !valid_tld(suffix) {
        return Err(INVALID_TLD);
    }
    suffix.make_ascii_lowercase();
    let existing = call.tld_status(suffix)?;
    let enabled = match (existing, status) {
        (Some(_), None) => return Err(DUPLICATE),
        (None, Some(_)) => return Err(TLD_INACTIVE),
        (_, value) => value.unwrap_or(true),
    };
    let mut key = [0; 4 + MAX_TLD];
    call.write(tld_key(suffix, &mut key), &[1, u8::from(enabled)])
}

fn register_name() -> Outcome {
    let mut full = [0; MAX_NAME];
    let (key, tld) = name(&mut full)?;
    let call = Call::load()?;
    if call.tld_status(tld)? != Some(true) {
        return Err(TLD_INACTIVE);
    }
    let mut bytes = [0; 2 + records::MAX_PAYLOAD];
    if let Some(existing) = call.read(key, &mut bytes)? {
        records::validate(existing)?;
        return Err(DUPLICATE);
    }
    let mut payload = [0; records::HEADER];
    payload[0] = 2;
    payload[1..].copy_from_slice(&call.sender);
    call.write(key, &payload)
}

fn change_record(kind: u8, named: bool, clear: bool) -> Outcome {
    let mut full = [0; MAX_NAME];
    let (name, _) = name(&mut full)?;
    let mut key_buffer = [0; 40];
    let key = if named {
        let key = argument(1, &mut key_buffer, INVALID_RECORD)?;
        if kind == records::TEXT {
            key.make_ascii_lowercase();
        }
        key
    } else {
        b"description".as_slice()
    };
    if !records::valid_key(kind, key) {
        return Err(INVALID_RECORD);
    }
    let mut input = [0; 128];
    let value = if clear {
        None
    } else {
        let value = argument(if named { 2 } else { 1 }, &mut input, INVALID_RECORD)?;
        if !records::valid_value(kind, value) {
            return Err(INVALID_RECORD);
        }
        Some(&*value)
    };
    let call = Call::load()?;
    let mut bytes = [0; 2 + records::MAX_PAYLOAD];
    let data = call.read(name, &mut bytes)?.ok_or(NOT_FOUND)?;
    let mut updated = [0; records::MAX_PAYLOAD];
    let end = records::change(data, &call.sender, kind, key, value, &mut updated)?;
    if data == &updated[..end] {
        Ok(())
    } else {
        call.write(name, &updated[..end])
    }
}

/// @xrpl-function register
/// @param name VL - Full root name
#[wasm_export]
fn register() -> i32 {
    register_name().err().unwrap_or(0)
}

/// @xrpl-function set_text
/// @param name VL - Full root name
/// @param value VL - UTF-8 description
#[wasm_export]
fn set_text() -> i32 {
    change_record(records::TEXT, false, false)
        .err()
        .unwrap_or(0)
}

/// @xrpl-function set_text_record
/// @param name VL - Full root name
/// @param key VL - Text record key
/// @param value VL - UTF-8 text
#[wasm_export]
fn set_text_record() -> i32 {
    change_record(records::TEXT, true, false).err().unwrap_or(0)
}

/// @xrpl-function clear_text
/// @param name VL - Full root name
/// @param key VL - Text record key
#[wasm_export]
fn clear_text() -> i32 {
    change_record(records::TEXT, true, true).err().unwrap_or(0)
}

/// @xrpl-function set_address
/// @param name VL - Full root name
/// @param coin VL - UInt16 coin type in network byte order
/// @param value VL - Binary receiving address
#[wasm_export]
fn set_address() -> i32 {
    change_record(records::ADDRESS, true, false)
        .err()
        .unwrap_or(0)
}

/// @xrpl-function clear_address
/// @param name VL - Full root name
/// @param coin VL - UInt16 coin type in network byte order
#[wasm_export]
fn clear_address() -> i32 {
    change_record(records::ADDRESS, true, true)
        .err()
        .unwrap_or(0)
}

/// @xrpl-function add_tld
/// @param suffix VL - TLD without its leading dot
#[wasm_export]
fn add_tld() -> i32 {
    update_tld(None).err().unwrap_or(0)
}

/// @xrpl-function set_tld_status
/// @param suffix VL - TLD without its leading dot
/// @param enabled VL - One byte 00 or 01
#[wasm_export]
fn set_tld_status() -> i32 {
    let mut buffer = [0; 1];
    let status = match argument(1, &mut buffer, INVALID_TLD) {
        Ok([0]) => false,
        Ok([1]) => true,
        _ => return INVALID_TLD,
    };
    update_tld(Some(status)).err().unwrap_or(0)
}
