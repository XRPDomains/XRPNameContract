import { createHash } from 'node:crypto';
import { decodeAccountID, encodeAccountID } from '@xrpl-commons/xrpl';
import { object, RpcError, type Json, type Rpc } from './network.js';

export function normalizeTld(input: string): string {
    if (typeof input !== 'string' || input.length < 2 || input.length > 8 || /[^A-Za-z0-9]/.test(input)) {
        throw new Error('Invalid TLD');
    }
    return input.toLowerCase();
}

export function normalizeName(input: string): string {
    if (typeof input !== 'string' || /[^A-Za-z0-9.-]/.test(input)) {
        throw new Error('Invalid root name');
    }
    const parts = input.toLowerCase().split('.');
    const [label, tld] = parts;
    if (parts.length !== 2 || !/^[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/.test(label) ||
        ['xahau', 'treasury', 'admin', 'root', 'www'].includes(label)) {
        throw new Error('Invalid root name');
    }
    return `${label}.${normalizeTld(tld)}`;
}

export function normalizeTextKey(key: string): string {
    if (typeof key !== 'string' || key.length < 1 || key.length > 40 || /[^A-Za-z0-9._-]/.test(key)) {
        throw new Error('Invalid text key');
    }
    return key.toLowerCase();
}

export function textBytes(text: string): Buffer {
    if (typeof text !== 'string') throw new Error('Invalid text');
    const bytes = Buffer.from(text, 'utf8');
    if (!bytes.length || bytes.length > 128 || bytes.toString('utf8') !== text) {
        throw new Error('Text must be 1–128 valid UTF-8 bytes');
    }
    return bytes;
}

export function coinBytes(coinType: number): Buffer {
    if (!Number.isInteger(coinType) || coinType < 0 || coinType > 65535) {
        throw new Error('Coin type must be a uint16');
    }
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(coinType);
    return buffer;
}

export async function readState(rpc: Rpc, contract: string): Promise<Json> {
    const account = Buffer.from(decodeAccountID(contract));
    const index = createHash('sha512').update(Buffer.from([0, 0x62]))
        .update(account).update(account).digest().subarray(0, 32).toString('hex').toUpperCase();
    let result;
    try {
        result = await rpc('ledger_entry', { index, ledger_index: 'validated' });
    } catch (error) {
        if (!(error instanceof RpcError) || error.code !== 'entryNotFound') throw error;
        const result = await rpc('account_info', { account: contract, ledger_index: 'validated' });
        const accountData = object(result.account_data);
        if (result.validated !== true || accountData.Account !== contract ||
            typeof accountData.ContractID !== 'string' || !/^[0-9A-F]{64}$/i.test(accountData.ContractID)) {
            throw new Error('Expected a validated contract pseudo-account');
        }
        return {};
    }
    const node = object(result.node);
    if (result.validated !== true || result.index !== index ||
        node.LedgerEntryType !== 'ContractData' || node.Owner !== contract || node.ContractAccount !== contract) {
        throw new Error('Expected ContractData from the validated ledger');
    }
    return object(node.ContractJson);
}

function bytes(hex: unknown) {
    if (typeof hex !== 'string' || hex.length % 2 || /[^a-f0-9]/i.test(hex)) {
        throw new Error('Malformed registry state');
    }
    return Buffer.from(hex, 'hex');
}

export function tldStatus(state: Json, tld: string): boolean | null {
    const key = 'tld:' + tld;
    if (!Object.hasOwn(state, key)) return tld === 'xrp' ? true : null;
    const value = bytes(state[key]);
    if (value.length !== 2 || value[0] !== 1 || value[1] > 1) throw new Error('Malformed TLD state');
    return value[1] === 1;
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function decodeRecord(state: Json, name: string) {
    if (!Object.hasOwn(state, name)) return null;
    const data = bytes(state[name]);
    if (data.length < 21 || data.length > 4093) throw new Error('Malformed registry state');
    const owner = encodeAccountID(data.subarray(1, 21));
    const texts = new Map<string, string>();
    const addresses = new Map<number, Buffer>();
    if (data[0] === 1) {
        const text = data.subarray(21);
        if (text.length > 128) throw new Error('Malformed registry state');
        if (text.length) texts.set('description', decoder.decode(text));
        return { owner, texts, addresses };
    }
    if (data[0] !== 2) throw new Error('Unsupported registry state version');

    let previousKind = 0;
    let previousKey = Buffer.alloc(0);
    for (let offset = 21; offset < data.length;) {
        const kind = data[offset];
        const keyLength = data[offset + 1];
        const length = data[offset + 2];
        const start = offset + 3 + keyLength;
        const end = start + length;
        const key = data.subarray(offset + 3, start);
        const value = data.subarray(start, end);
        if (!(length >= 1 && length <= 128 && end <= data.length) ||
            kind < previousKind || (kind === previousKind && key.compare(previousKey) <= 0)) {
            throw new Error('Malformed registry record');
        }
        if (kind === 1) {
            const textKey = key.toString('latin1');
            if (normalizeTextKey(textKey) !== textKey || texts.size === 15) {
                throw new Error('Malformed text record');
            }
            texts.set(textKey, decoder.decode(value));
        } else if (kind === 2 && key.length === 2 && addresses.size < 15) {
            addresses.set(key.readUInt16BE(), Buffer.from(value));
        } else {
            throw new Error('Malformed registry record');
        }
        offset = end;
        previousKind = kind;
        previousKey = Buffer.from(key);
    }
    return { owner, texts, addresses };
}
