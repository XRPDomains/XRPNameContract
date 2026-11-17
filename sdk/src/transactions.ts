import { setTimeout as delay } from 'node:timers/promises';
import { object, RpcError, type Json, type Rpc } from './network.js';

export type Signer = {
    address: string;
    signTransaction(tx: Json): { tx_blob: string; hash: string };
};

export class ContractTransactionError extends Error {
    constructor(readonly hash: string, readonly result: string, readonly returnCode: number | null) {
        super(`${result} for ${hash}${returnCode === null ? '' : ` (WASM ${returnCode})`}`);
    }
}

export function contractCall(contract: string, fn: string, values: Buffer[]): Json {
    return {
        TransactionType: 'ContractCall',
        ContractAccount: contract,
        FunctionName: Buffer.from(fn).toString('hex').toUpperCase(),
        ComputationAllowance: 1_000_000,
        Parameters: values.map(value => ({
            Parameter: {
                ParameterFlag: 0,
                ParameterValue: { type: 'VL', value: value.toString('hex').toUpperCase() },
            },
        })),
    };
}

export async function submit(rpc: Rpc, signer: Signer, tx: Json) {
    const account = await rpc('account_info', {
        account: signer.address, ledger_index: 'current', queue: true,
    });
    const sequence = object(account.account_data).Sequence;
    const ledger = account.ledger_current_index;
    if (typeof sequence !== 'number' || typeof ledger !== 'number' ||
        (account.queue_data !== undefined && object(account.queue_data).txn_count !== 0)) {
        throw new Error('Expected an open ledger and an account with no queued transactions');
    }
    const signed = signer.signTransaction({
        ...tx, Account: signer.address, Sequence: sequence, LastLedgerSequence: ledger + 20,
    });

    try {
        const result = await rpc('submit', { tx_blob: signed.tx_blob });
        if (typeof result.engine_result !== 'string') throw new Error('Submit result missing');
        if (!/^(?:tes|tec|terQUEUED)/.test(result.engine_result)) {
            throw new ContractTransactionError(signed.hash, result.engine_result, null);
        }
        for (let attempt = 0; attempt < 40; attempt++) {
            const receipt = await rpc('tx', { transaction: signed.hash }).catch(error => {
                if (error instanceof RpcError && error.code === 'txnNotFound') return null;
                throw error;
            });
            if (receipt?.validated === true) {
                if (receipt.hash !== signed.hash || typeof receipt.ledger_index !== 'number') {
                    throw new Error('Receipt does not match transaction');
                }
                const meta = object(receipt.meta);
                const raw = meta.WasmReturnCode;
                const returnCode = typeof raw === 'number' && Number.isInteger(raw) ? raw : null;
                if (meta.TransactionResult !== 'tesSUCCESS' ||
                    (tx.TransactionType === 'ContractCall' && returnCode !== 0)) {
                    throw new ContractTransactionError(signed.hash, String(meta.TransactionResult), returnCode);
                }
                return { hash: signed.hash, ledgerIndex: receipt.ledger_index, meta };
            }
            await delay(500);
        }
        throw new Error('Validation timed out');
    } catch (error) {
        if (error instanceof ContractTransactionError) throw error;
        throw new Error(`Resolve transaction ${signed.hash} before retrying`, { cause: error });
    }
}
