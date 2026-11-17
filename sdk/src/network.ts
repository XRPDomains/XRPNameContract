import { isValidClassicAddress } from '@xrpl-commons/xrpl';

export type LocalNetwork = { rpcUrl: string; contractAccount: string };
export type Json = Record<string, unknown>;

export function object(value: unknown): Json {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an RPC object');
    }
    return value as Json;
}

export class RpcError extends Error {
    constructor(readonly code: string, message: string) {
        super(message);
    }
}

export function localRpc(endpoint: string) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('Expected a loopback HTTP RPC endpoint');
    }
    return async (method: string, params: Json = {}) => {
        const response = await fetch(url, {
            method: 'POST',
            redirect: 'error',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method, params: [{ ...params, api_version: 1 }] }),
            signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const result = object(object(await response.json()).result);
        if (typeof result.error === 'string') {
            throw new RpcError(result.error, String(result.error_message ?? result.error));
        }
        if (result.status !== 'success') throw new Error(`Unexpected ${method} status`);
        return result;
    };
}

export type Rpc = ReturnType<typeof localRpc>;

const NETWORK_ID = 100;

export async function verifyNetwork(rpc: Rpc) {
    const info = object((await rpc('server_info')).info);
    if (info.network_id !== NETWORK_ID || info.build_version !== '3.2.0-b0') {
        throw new Error('Expected xrpld 3.2.0-b0 on standalone network 100');
    }
    return info;
}

export function validateContract(account: string) {
    if (!isValidClassicAddress(account)) throw new Error('Invalid contract account');
}
