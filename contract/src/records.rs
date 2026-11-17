use crate::{Account, NOT_OWNER, RECORDS_FULL, STATE_ERROR};

pub const TEXT: u8 = 1;
pub const ADDRESS: u8 = 2;
pub const HEADER: usize = 21;
const MAX_PER_KIND: usize = 15;
// The pinned host limits set_data_object_field input to 4096 bytes, including type and VL length.
pub const MAX_PAYLOAD: usize = 4096 - 3;

pub fn valid_key(kind: u8, key: &[u8]) -> bool {
    match kind {
        TEXT => {
            (1..=40).contains(&key.len())
                && key.iter().all(|b| {
                    b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'-')
                })
        }
        ADDRESS => key.len() == 2,
        _ => false,
    }
}

pub fn valid_value(kind: u8, value: &[u8]) -> bool {
    (1..=128).contains(&value.len()) && (kind != TEXT || core::str::from_utf8(value).is_ok())
}

fn scan(mut data: &[u8], mut visit: impl FnMut(u8, &[u8], &[u8], &[u8])) -> Result<(), i32> {
    if !(HEADER..=MAX_PAYLOAD).contains(&data.len()) {
        return Err(STATE_ERROR);
    }
    let version = data[0];
    data = &data[HEADER..];
    if version == 1 {
        if !data.is_empty() {
            if !valid_value(TEXT, data) {
                return Err(STATE_ERROR);
            }
            visit(TEXT, b"description", data, &[]);
        }
        return Ok(());
    }
    if version != 2 {
        return Err(STATE_ERROR);
    }

    let mut counts = [0; 2];
    let mut previous: Option<(u8, &[u8])> = None;
    while !data.is_empty() {
        let [kind, key_len, value_len, ..] = data else {
            return Err(STATE_ERROR);
        };
        let key_end = 3 + *key_len as usize;
        let end = key_end + *value_len as usize;
        let Some(entry) = data.get(..end) else {
            return Err(STATE_ERROR);
        };
        let key = &entry[3..key_end];
        let value = &entry[key_end..];
        if !valid_key(*kind, key)
            || !valid_value(*kind, value)
            || previous.is_some_and(|ordered| ordered >= (*kind, key))
        {
            return Err(STATE_ERROR);
        }
        counts[*kind as usize - 1] += 1;
        if counts[*kind as usize - 1] > MAX_PER_KIND {
            return Err(STATE_ERROR);
        }
        previous = Some((*kind, key));
        visit(*kind, key, value, entry);
        data = &data[end..];
    }
    Ok(())
}

pub fn validate(data: &[u8]) -> Result<(), i32> {
    scan(data, |_, _, _, _| {})
}

fn append(out: &mut [u8], end: &mut usize, kind: u8, key: &[u8], value: &[u8]) -> Result<(), i32> {
    let next = *end + 3 + key.len() + value.len();
    let entry = out.get_mut(*end..next).ok_or(RECORDS_FULL)?;
    entry[..3].copy_from_slice(&[kind, key.len() as u8, value.len() as u8]);
    entry[3..3 + key.len()].copy_from_slice(key);
    entry[3 + key.len()..].copy_from_slice(value);
    *end = next;
    Ok(())
}

pub fn change(
    data: &[u8],
    sender: &Account,
    kind: u8,
    key: &[u8],
    mut value: Option<&[u8]>,
    out: &mut [u8; MAX_PAYLOAD],
) -> Result<usize, i32> {
    validate(data)?;
    if &data[1..HEADER] != sender {
        return Err(NOT_OWNER);
    }
    out[0] = 2;
    out[1..HEADER].copy_from_slice(sender);
    let mut end = HEADER;
    let mut count = 0;
    let mut result = Ok(());
    scan(data, |entry_kind, entry_key, entry_value, entry_bytes| {
        if result.is_err() {
            return;
        }
        if (entry_kind, entry_key) >= (kind, key) {
            if let Some(new_value) = value.take() {
                result = append(out, &mut end, kind, key, new_value);
                count += 1;
                if result.is_err() {
                    return;
                }
            }
        }
        if (entry_kind, entry_key) != (kind, key) {
            count += usize::from(entry_kind == kind);
            if entry_bytes.is_empty() {
                result = append(out, &mut end, entry_kind, entry_key, entry_value);
            } else {
                let next = end + entry_bytes.len();
                if let Some(destination) = out.get_mut(end..next) {
                    destination.copy_from_slice(entry_bytes);
                    end = next;
                } else {
                    result = Err(RECORDS_FULL);
                }
            }
        }
    })?;
    result?;
    if let Some(new_value) = value {
        count += 1;
        append(out, &mut end, kind, key, new_value)?;
    }
    if count > MAX_PER_KIND {
        return Err(RECORDS_FULL);
    }
    Ok(end)
}
