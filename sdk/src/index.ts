import { decodeAccountID, encodeAccountID } from '@xrpl-commons/xrpl';
import { localRpc, validateContract, verifyNetwork, type LocalNetwork } from './network.js';
import { coinBytes, decodeRecord, normalizeName, normalizeTextKey, normalizeTld, readState, textBytes, tldStatus } from './state.js';
import { contractCall, submit, type Signer } from './transactions.js';
export type { LocalNetwork, Signer };
export { ContractTransactionError } from './transactions.js';

export class XRPNameClient {
    private readonly rpc;
    private readonly contract;

    constructor(network: LocalNetwork, private readonly signer?: Signer) {
        validateContract(network.contractAccount);
        this.contract = network.contractAccount;
        this.rpc = localRpc(network.rpcUrl);
    }

    async register(name: string) {
        return this.write('register', [Buffer.from(normalizeName(name))]);
    }

    async getOwner(name: string) {
        return (await this.readName(name))?.owner ?? null;
    }

    async setText(name: string, value: string): Promise<{ hash: string; ledgerIndex: number }>;
    async setText(name: string, key: string, value: string): Promise<{ hash: string; ledgerIndex: number }>;
    async setText(name: string, keyOrValue: string, value?: string) {
        const domain = Buffer.from(normalizeName(name));
        if (value === undefined) return this.write('set_text', [domain, textBytes(keyOrValue)]);
        return this.write('set_text_record', [domain, Buffer.from(normalizeTextKey(keyOrValue)), textBytes(value)]);
    }

    async getText(name: string, key = 'description') {
        const canonical = normalizeTextKey(key);
        return (await this.readName(name))?.texts.get(canonical) ?? null;
    }

    async clearText(name: string, key = 'description') {
        return this.write('clear_text', [Buffer.from(normalizeName(name)), Buffer.from(normalizeTextKey(key))]);
    }

    async setAddr(name: string, coinType: number, value: Uint8Array) {
        if (!(value instanceof Uint8Array) || !value.length || value.length > 128) {
            throw new Error('Address record must be 1–128 bytes');
        }
        return this.write('set_address', [Buffer.from(normalizeName(name)), coinBytes(coinType), Buffer.from(value)]);
    }

    async getAddr(name: string, coinType: number) {
        coinBytes(coinType);
        return (await this.readName(name))?.addresses.get(coinType) ?? null;
    }

    async clearAddr(name: string, coinType: number) {
        return this.write('clear_address', [Buffer.from(normalizeName(name)), coinBytes(coinType)]);
    }

    async setAddress(name: string, address: string) {
        validateContract(address);
        return this.setAddr(name, 144, decodeAccountID(address));
    }

    async getAddress(name: string) {
        const account = await this.getAddr(name, 144);
        if (account === null) return null;
        if (account.length !== 20) throw new Error('Malformed XRPL receiving address');
        return encodeAccountID(account);
    }

    async getRecordKeys(name: string) {
        const record = await this.readName(name);
        return { textKeys: [...(record?.texts.keys() ?? [])], coinTypes: [...(record?.addresses.keys() ?? [])] };
    }

    async addTld(tld: string) {
        return this.write('add_tld', [Buffer.from(normalizeTld(tld))]);
    }

    async setTldStatus(tld: string, enabled: boolean) {
        if (typeof enabled !== 'boolean') throw new Error('Expected a boolean TLD status');
        return this.write('set_tld_status', [Buffer.from(normalizeTld(tld)), Buffer.from([Number(enabled)])]);
    }

    async getTldStatus(tld: string) {
        const canonical = normalizeTld(tld);
        return tldStatus(await readState(this.rpc, this.contract), canonical);
    }

    async listTlds() {
        const state = await readState(this.rpc, this.contract);
        const tlds = new Set(['xrp']);
        for (const key of Object.keys(state)) {
            if (key.startsWith('tld:')) {
                const tld = key.slice(4);
                if (normalizeTld(tld) !== tld) throw new Error('Malformed TLD state key');
                tlds.add(tld);
            }
        }
        return [...tlds].sort().map(tld => ({ tld, enabled: tldStatus(state, tld) === true }));
    }

    private async readName(name: string) {
        const canonical = normalizeName(name);
        return decodeRecord(await readState(this.rpc, this.contract), canonical);
    }

    private async write(fn: string, values: Buffer[]) {
        if (!this.signer) throw new Error('A transaction signer is required');
        await verifyNetwork(this.rpc);
        const result = await submit(this.rpc, this.signer, {
            ...contractCall(this.contract, fn, values), Fee: '1000000',
        });
        return { hash: result.hash, ledgerIndex: result.ledgerIndex };
    }
}
